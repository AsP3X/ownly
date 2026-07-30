// Human: Document collab hook — thin adapter over CollabClient (replace + format_commit + locks).
// Agent: USED by RtfEditorDialog; server-authoritative OT with pending rebase.

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
      seed: seed ? { html: seed.html, text: seed.text } : undefined,
      getFormatCommitPayload: () => ({
        html: lastHtmlRef.current,
        text: lastPlainRef.current,
      }),
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
      onError: (message, code) => {
        // Human: Soft op errors must not paint the strip as offline.
        if (
          code === "locked" ||
          code === "invalid_op" ||
          code === "text_mismatch" ||
          code === "client_message"
        ) {
          return;
        }
        setError(message);
      },
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

  // Keep format-commit retry payload getters fresh without restarting the session.
  useEffect(() => {
    clientRef.current?.updateOptions({
      getFormatCommitPayload: () => ({
        html: lastHtmlRef.current,
        text: lastPlainRef.current,
      }),
      localUserId: localUserId ?? null,
    });
  }, [localUserId]);

  function handleRemoteOp(op: CollabOp, isLocalEcho: boolean): void {
    if (isLocalEcho) return;

    if (op.op_type === "replace") {
      const index = Number(op.payload.index ?? 0);
      const del = Number(op.payload.delete ?? 0);
      const insert = typeof op.payload.insert === "string" ? op.payload.insert : "";
      if (!Number.isFinite(index)) return;
      const replace: TextReplace = { index, delete: del, insert };
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
    }
  }

  const publishTextOp = useCallback(
    (op: { index: number; delete: number; insert: string }) => {
      clientRef.current?.submitOp("replace", {
        index: op.index,
        delete: op.delete,
        insert: op.insert,
      });
    },
    [],
  );

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
      // Human: Empty docs / collapsed caret yield end<=start — never send lock (server rejects).
      const hasRange = range.end > range.start;
      const prev = lastLockRef.current;
      const lockChanged = hasRange
        ? !(prev && prev.start === range.start && prev.end === range.end)
        : prev != null;

      if (hasRange) {
        if (lockChanged) {
          lastLockRef.current = { start: range.start, end: range.end };
          clientRef.current?.submitOp("lock", {
            start: range.start,
            end: range.end,
          });
        }
        await updatePresence({
          selection_start: caretStart,
          selection_end: caretEnd,
          ...(lockChanged
            ? { lock_start: range.start, lock_end: range.end }
            : {}),
        });
      } else {
        // Empty document: presence only; drop any prior exclusive lock.
        if (prev != null) {
          lastLockRef.current = null;
          clientRef.current?.submitOp("unlock", {});
        }
        await updatePresence({
          selection_start: caretStart,
          selection_end: caretEnd,
          ...(prev != null ? { clear_lock: true } : {}),
        });
      }
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
