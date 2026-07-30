// Human: Document collab hook — thin adapter over shared CollabClient + document domain ops.
// Agent: USED by RtfEditorDialog; WS-first replace/format_commit/lock with server-authoritative OT.

import { useCallback, useEffect, useRef, useState } from "react";
import { CollabClient } from "@/lib/collab/client";
import type {
  CollabOp,
  CollabParticipant,
  CollabSession,
  CollabTransportMode,
  PublicShareAuth,
} from "@/lib/collab/types";
import { diffPlainText, transformRange, type TextReplace } from "@/lib/collab/ot/text";
import { rangesOverlap, sentenceRangeAround } from "@/lib/rtf/sentence-range";

export type RemoteTextOp = {
  opType: "replace";
  index: number;
  delete: number;
  insert: string;
  fromUserId: string;
};

type UseDocumentCollabOptions = {
  fileId: string | null | undefined;
  enabled: boolean;
  displayName?: string;
  localUserId?: string | null;
  publicShare?: PublicShareAuth | null;
  getSeed?: () => { html: string; text: string };
  onRemoteDocument?: (html: string, text: string, fromUserId: string) => void;
  onRemoteTextOp?: (op: RemoteTextOp) => void;
  onPresence?: (participants: CollabParticipant[]) => void;
};

export function useDocumentCollab({
  fileId,
  enabled,
  displayName,
  localUserId,
  publicShare,
  getSeed,
  onRemoteDocument,
  onRemoteTextOp,
  onPresence,
}: UseDocumentCollabOptions) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<CollabTransportMode>("poll");

  const clientRef = useRef<CollabClient | null>(null);
  const localUserIdRef = useRef(localUserId);
  const onRemoteDocumentRef = useRef(onRemoteDocument);
  const onRemoteTextOpRef = useRef(onRemoteTextOp);
  const onPresenceRef = useRef(onPresence);
  const getSeedRef = useRef(getSeed);
  const lastLockRef = useRef<{ start: number; end: number } | null>(null);
  const lastPlainRef = useRef<string>("");
  const lastHtmlRef = useRef<string>("");

  localUserIdRef.current = localUserId;
  onRemoteDocumentRef.current = onRemoteDocument;
  onRemoteTextOpRef.current = onRemoteTextOp;
  onPresenceRef.current = onPresence;
  getSeedRef.current = getSeed;

  useEffect(() => {
    if (!enabled || !fileId) {
      clientRef.current?.stop();
      clientRef.current = null;
      setSession(null);
      setParticipants([]);
      setError(null);
      return;
    }

    const seed = getSeedRef.current?.();
    if (seed) {
      lastPlainRef.current = seed.text;
      lastHtmlRef.current = seed.html;
    }

    const client = new CollabClient({
      roomKind: "document",
      fileId,
      displayName,
      localUserId,
      publicShare,
      seed: seed
        ? { html: seed.html, text: seed.text }
        : undefined,
      onSession: (next) => {
        setSession(next);
        if (next.document_text != null) lastPlainRef.current = next.document_text;
        if (next.document_html != null) lastHtmlRef.current = next.document_html;
      },
      onParticipants: (next) => {
        setParticipants(next);
        onPresenceRef.current?.(next);
      },
      onTransport: setTransport,
      onError: setError,
      onOp: (op, { isLocalEcho }) => {
        handleRemoteOp(op, isLocalEcho);
      },
      onSnapshot: (snap) => {
        const text = typeof snap.data?.text === "string" ? snap.data.text : "";
        const html = typeof snap.data?.html === "string" ? snap.data.html : "";
        if (html && html !== lastHtmlRef.current) {
          lastHtmlRef.current = html;
          lastPlainRef.current = text;
          onRemoteDocumentRef.current?.(html, text, "snapshot");
        }
      },
    });

    clientRef.current = client;
    void client.start().then((joined) => {
      if (!joined) return;
      // Late-join HTML when peers already edited
      if (
        joined.document_html &&
        seed?.html &&
        joined.document_html !== seed.html &&
        (joined.participants?.length ?? 0) > 1
      ) {
        onRemoteDocumentRef.current?.(
          joined.document_html,
          joined.document_text ?? "",
          "session",
        );
      }
    });

    return () => {
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart on identity/file only
  }, [enabled, fileId, displayName, localUserId, publicShare?.token, publicShare?.guestId]);

  function handleRemoteOp(op: CollabOp, isLocalEcho: boolean): void {
    if (isLocalEcho) {
      if (op.op_type === "replace") {
        // Local already applied in editor
        return;
      }
      return;
    }

    if (op.op_type === "replace") {
      const index = Number(op.payload.index ?? 0);
      const del = Number(op.payload.delete ?? 0);
      const insert = typeof op.payload.insert === "string" ? op.payload.insert : "";
      if (!Number.isFinite(index)) return;
      const replace: TextReplace = { index, delete: del, insert };
      // Shift local lock tracking
      if (lastLockRef.current) {
        const shifted = transformRange(
          lastLockRef.current.start,
          lastLockRef.current.end,
          replace,
        );
        lastLockRef.current = shifted;
      }
      onRemoteTextOpRef.current?.({
        opType: "replace",
        index,
        delete: del,
        insert,
        fromUserId: op.user_id,
      });
      return;
    }

    if (op.op_type === "format_commit") {
      const html = typeof op.payload.html === "string" ? op.payload.html : "";
      const text = typeof op.payload.text === "string" ? op.payload.text : "";
      if (html) {
        lastHtmlRef.current = html;
        lastPlainRef.current = text;
        onRemoteDocumentRef.current?.(html, text, op.user_id);
      }
      return;
    }

    if (op.op_type === "lock" || op.op_type === "unlock") {
      // Presence fan-out updates locks; no content apply.
      clientRef.current?.requestSync();
    }
  }

  const publishTextOp = useCallback(
    (op: { opType: "text_insert" | "text_delete" | "replace"; index: number; text?: string; length?: number; delete?: number; insert?: string }) => {
      const client = clientRef.current;
      if (!client) return;

      let replace: TextReplace;
      if (op.opType === "replace") {
        replace = {
          index: op.index,
          delete: op.delete ?? 0,
          insert: op.insert ?? op.text ?? "",
        };
      } else if (op.opType === "text_insert") {
        replace = { index: op.index, delete: 0, insert: op.text ?? "" };
      } else {
        replace = { index: op.index, delete: op.length ?? 0, insert: "" };
      }

      client.submitOp("replace", {
        index: replace.index,
        delete: replace.delete,
        insert: replace.insert,
      });
    },
    [],
  );

  /** Human: Publish local plain-text change as OT replace (from before→after). */
  const publishPlainChange = useCallback((before: string, after: string) => {
    const diff = diffPlainText(before, after);
    if (!diff) return;
    lastPlainRef.current = after;
    clientRef.current?.submitOp("replace", {
      index: diff.index,
      delete: diff.delete,
      insert: diff.insert,
    });
  }, []);

  const publishDocument = useCallback((html: string, text: string) => {
    lastHtmlRef.current = html;
    lastPlainRef.current = text;
    clientRef.current?.submitOp("format_commit", { html, text });
  }, []);

  const updatePresence = useCallback(async (body: {
    selection_start?: number;
    selection_end?: number;
    lock_start?: number;
    lock_end?: number;
    clear_lock?: boolean;
  }) => {
    const presence: Record<string, unknown> = {};
    if (body.selection_start != null) presence.selection_start = body.selection_start;
    if (body.selection_end != null) presence.selection_end = body.selection_end;
    if (body.clear_lock) {
      presence.lock_start = null;
      presence.lock_end = null;
    } else {
      if (body.lock_start != null) presence.lock_start = body.lock_start;
      if (body.lock_end != null) presence.lock_end = body.lock_end;
    }
    clientRef.current?.updatePresence(presence);
  }, []);

  const acquireSentenceLock = useCallback(
    async (text: string, caretStart: number, caretEnd: number) => {
      const range = sentenceRangeAround(text, caretStart, caretEnd);
      const prev = lastLockRef.current;
      const lockChanged = !(prev && prev.start === range.start && prev.end === range.end);
      if (lockChanged) {
        lastLockRef.current = { start: range.start, end: range.end };
        clientRef.current?.submitOp("lock", { start: range.start, end: range.end });
      }
      await updatePresence({
        selection_start: caretStart,
        selection_end: caretEnd,
        ...(lockChanged ? { lock_start: range.start, lock_end: range.end } : {}),
      });
      return range;
    },
    [updatePresence],
  );

  const releaseLock = useCallback(async () => {
    lastLockRef.current = null;
    clientRef.current?.submitOp("unlock", {});
    await updatePresence({ clear_lock: true });
  }, [updatePresence]);

  const isRangeLockedByOther = useCallback(
    (start: number, end: number) => {
      for (const person of participants) {
        if (localUserId && person.user_id === localUserId) continue;
        const ls = person.lock_start;
        const le = person.lock_end;
        if (ls == null || le == null || le <= ls) continue;
        if (rangesOverlap(start, Math.max(end, start + 1), ls, le)) return true;
      }
      return false;
    },
    [localUserId, participants],
  );

  return {
    session,
    participants,
    error,
    transport,
    publishDocument,
    publishTextOp,
    publishPlainChange,
    updatePresence,
    acquireSentenceLock,
    releaseLock,
    isRangeLockedByOther,
  };
}
