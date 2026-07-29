// Human: Live RTF collab — bidirectional WebSocket for ops + presence; HTTP fallback only.
// Agent: USED by RtfEditorDialog; WS-first publish/heartbeat for near-zero latency carets/sync.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  API_BASE,
  getDocumentCollabSession,
  getPublicDocumentCollabSession,
  heartbeatDocumentCollabSession,
  heartbeatPublicDocumentCollabSession,
  joinDocumentCollabSession,
  joinPublicDocumentCollabSession,
  listDocumentCollabOps,
  listPublicDocumentCollabOps,
  postDocumentCollabOp,
  postPublicDocumentCollabOp,
  type DocumentCollabOp,
  type DocumentCollabParticipant,
  type DocumentCollabSession,
} from "@/api/client";
import { rangesOverlap, sentenceRangeAround } from "@/lib/rtf/sentence-range";
import {
  transformOffsetThroughReplace,
  type TextReplaceOp,
} from "@/lib/rtf/text-ops";

/** Human: Coalesce typing into doc_html — fire next animation frame. */
const PUBLISH_DEBOUNCE_MS = 0;
/** Human: Coalesce caret presence when falling back to HTTP. */
const PRESENCE_DEBOUNCE_MS = 0;
/** Human: Ops gap-fill when WebSocket is healthy (backup only). */
const OPS_POLL_WS_MS = 1_500;
/** Human: Ops gap-fill when falling back to HTTP-only transport. */
const OPS_POLL_HTTP_MS = 300;
/** Human: Presence snapshot poll (backup). */
const SESSION_POLL_WS_MS = 1_000;
const SESSION_POLL_HTTP_MS = 300;

type PublicShareCollab = {
  token: string;
  sharePassword?: string | null;
  guestId: string;
};

export type RemoteTextOp = {
  opType: "text_insert" | "text_delete";
  index: number;
  text?: string;
  length?: number;
  fromUserId: string;
};

type UseDocumentCollabOptions = {
  fileId: string | null | undefined;
  enabled: boolean;
  displayName?: string;
  localUserId?: string | null;
  publicShare?: PublicShareCollab | null;
  getSeed?: () => { html: string; text: string };
  onRemoteDocument?: (html: string, text: string, fromUserId: string) => void;
  /** Human: Live concurrent typing — apply insert/delete without full HTML replace. */
  onRemoteTextOp?: (op: RemoteTextOp) => void;
  onPresence?: (participants: DocumentCollabParticipant[]) => void;
};

type HeartbeatBody = {
  selection_start?: number;
  selection_end?: number;
  lock_start?: number;
  lock_end?: number;
  clear_lock?: boolean;
};

function collabWsUrl(sessionId: string, publicShare?: PublicShareCollab | null): string {
  const base =
    typeof window !== "undefined" && API_BASE.startsWith("http")
      ? API_BASE
      : `${window.location.origin}${API_BASE.startsWith("/") ? API_BASE : `/${API_BASE}`}`;
  const wsBase = base.replace(/^http/, "ws");
  if (publicShare?.token) {
    const params = new URLSearchParams({ guest_id: publicShare.guestId });
    if (publicShare.sharePassword) {
      params.set("password", publicShare.sharePassword);
    }
    return `${wsBase}/public/shares/${encodeURIComponent(publicShare.token)}/document/sessions/${encodeURIComponent(sessionId)}/ws?${params.toString()}`;
  }
  return `${wsBase}/document/sessions/${encodeURIComponent(sessionId)}/ws`;
}

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
  const [session, setSession] = useState<DocumentCollabSession | null>(null);
  const [participants, setParticipants] = useState<DocumentCollabParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"ws" | "poll">("poll");
  const latestSeqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const localUserIdRef = useRef(localUserId);
  const publicShareRef = useRef(publicShare);
  const onRemoteDocumentRef = useRef(onRemoteDocument);
  const onRemoteTextOpRef = useRef(onRemoteTextOp);
  const onPresenceRef = useRef(onPresence);
  const getSeedRef = useRef(getSeed);
  const publishTimerRef = useRef<number | null>(null);
  const pendingPublishRef = useRef<{ html: string; text: string } | null>(null);
  const lastPublishedHtmlRef = useRef<string | null>(null);
  const lastLockRef = useRef<{ start: number; end: number } | null>(null);
  const presenceTimerRef = useRef<number | null>(null);
  const pendingHeartbeatRef = useRef<HeartbeatBody | null>(null);
  const publishInFlightRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const transportRef = useRef<"ws" | "poll">("poll");

  localUserIdRef.current = localUserId;
  publicShareRef.current = publicShare;
  onRemoteDocumentRef.current = onRemoteDocument;
  onRemoteTextOpRef.current = onRemoteTextOp;
  onPresenceRef.current = onPresence;
  getSeedRef.current = getSeed;
  transportRef.current = transport;

  const applySession = useCallback((next: DocumentCollabSession) => {
    setSession(next);
    setParticipants(Array.isArray(next.participants) ? next.participants : []);
    onPresenceRef.current?.(next.participants ?? []);
  }, []);

  const wsSend = useCallback((payload: Record<string, unknown>): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  const ingestOps = useCallback((ops: DocumentCollabOp[]) => {
    if (ops.length === 0) return;
    // Human: Dedupe WS + HTTP poll — re-applying text_insert doubles characters and breaks sync.
    // Agent: ONLY process seq > latestSeqRef; apply in order.
    const fresh = ops
      .filter((op) => typeof op.seq === "number" && op.seq > latestSeqRef.current)
      .sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;

    for (const op of fresh) {
      latestSeqRef.current = Math.max(latestSeqRef.current, op.seq);

      if (op.op_type === "lock") {
        const start =
          typeof op.payload.start === "number"
            ? op.payload.start
            : Number(op.payload.start);
        const end =
          typeof op.payload.end === "number" ? op.payload.end : Number(op.payload.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          setParticipants((current) => {
            let found = false;
            const next = current.map((person) => {
              if (person.user_id !== op.user_id) return person;
              found = true;
              return {
                ...person,
                lock_start: start,
                lock_end: end,
                selection_start: person.selection_start ?? start,
                selection_end: person.selection_end ?? start,
              };
            });
            if (!found) {
              next.push({
                user_id: op.user_id,
                display_name: "Collaborator",
                color: "#2563EB",
                last_seen: Date.now(),
                selection_start: start,
                selection_end: start,
                lock_start: start,
                lock_end: end,
              });
            }
            onPresenceRef.current?.(next);
            return next;
          });
        }
      } else if (op.op_type === "unlock") {
        setParticipants((current) => {
          const next = current.map((person) =>
            person.user_id === op.user_id
              ? { ...person, lock_start: null, lock_end: null }
              : person,
          );
          onPresenceRef.current?.(next);
          return next;
        });
      }

      if (localUserIdRef.current && op.user_id === localUserIdRef.current) {
        if (op.op_type === "doc_html") {
          const html = typeof op.payload.html === "string" ? op.payload.html : "";
          if (html) lastPublishedHtmlRef.current = html;
        }
        continue;
      }

      if (op.op_type === "text_insert") {
        const index =
          typeof op.payload.index === "number"
            ? op.payload.index
            : Number(op.payload.index);
        const text =
          typeof op.payload.text === "string" ? op.payload.text : String(op.payload.text ?? "");
        if (Number.isFinite(index) && text) {
          const replace: TextReplaceOp = {
            index,
            deleteCount: 0,
            insertText: text,
          };
          shiftParticipantsThroughReplace(replace);
          onRemoteTextOpRef.current?.({
            opType: "text_insert",
            index,
            text,
            fromUserId: op.user_id,
          });
        }
      } else if (op.op_type === "text_delete") {
        const index =
          typeof op.payload.index === "number"
            ? op.payload.index
            : Number(op.payload.index);
        const length =
          typeof op.payload.length === "number"
            ? op.payload.length
            : Number(op.payload.length);
        if (Number.isFinite(index) && Number.isFinite(length) && length > 0) {
          const replace: TextReplaceOp = {
            index,
            deleteCount: length,
            insertText: "",
          };
          shiftParticipantsThroughReplace(replace);
          onRemoteTextOpRef.current?.({
            opType: "text_delete",
            index,
            length,
            fromUserId: op.user_id,
          });
        }
      } else if (op.op_type === "doc_html") {
        const html = typeof op.payload.html === "string" ? op.payload.html : "";
        const text = typeof op.payload.text === "string" ? op.payload.text : "";
        if (html) {
          lastPublishedHtmlRef.current = html;
          onRemoteDocumentRef.current?.(html, text, op.user_id);
        }
      }
    }

    function shiftParticipantsThroughReplace(replace: TextReplaceOp) {
      setParticipants((current) => {
        const next = current.map((person) => {
          const shift = (value: number | null | undefined) =>
            value == null
              ? null
              : transformOffsetThroughReplace(Number(value), replace);
          const selection_start = shift(person.selection_start);
          const selection_end = shift(person.selection_end);
          let lock_start = shift(person.lock_start);
          let lock_end = shift(person.lock_end);
          if (
            lock_start != null &&
            lock_end != null &&
            lock_end <= lock_start
          ) {
            lock_start = null;
            lock_end = null;
          }
          return {
            ...person,
            selection_start,
            selection_end,
            lock_start,
            lock_end,
          };
        });
        onPresenceRef.current?.(next);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled || !fileId) {
      setSession(null);
      setParticipants([]);
      sessionIdRef.current = null;
      latestSeqRef.current = 0;
      lastPublishedHtmlRef.current = null;
      lastLockRef.current = null;
      pendingPublishRef.current = null;
      return;
    }

    let cancelled = false;
    const seed = getSeedRef.current?.();
    const share = publicShareRef.current;
    const joinPromise = share
      ? joinPublicDocumentCollabSession(
          {
            token: share.token,
            sharePassword: share.sharePassword,
            guestId: share.guestId,
          },
          {
            file_id: fileId,
            display_name: displayName,
            initial_html: seed?.html,
            initial_text: seed?.text,
          },
        )
      : joinDocumentCollabSession({
          file_id: fileId,
          display_name: displayName,
          initial_html: seed?.html,
          initial_text: seed?.text,
        });

    void joinPromise
      .then((joined) => {
        if (cancelled) return;
        applySession(joined);
        sessionIdRef.current = joined.id;
        latestSeqRef.current = joined.latest_seq;
        lastPublishedHtmlRef.current = joined.document_html || seed?.html || null;
        setError(null);
        if (
          joined.document_html &&
          joined.document_html !== seed?.html &&
          joined.participants.length > 1
        ) {
          onRemoteDocumentRef.current?.(joined.document_html, joined.document_text, "session");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Live co-editing unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [applySession, displayName, enabled, fileId, publicShare?.token, publicShare?.guestId]);

  // WebSocket live channel (bidirectional)
  useEffect(() => {
    if (!enabled || !session?.id) return;
    const sessionId = session.id;
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(collabWsUrl(sessionId, publicShareRef.current));
      } catch {
        setTransport("poll");
        socketRef.current = null;
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        setTransport("ws");
        // Warm presence so peers know we are here immediately
        wsSend({ type: "ping" });
      };
      socket.onerror = () => {
        /* onclose handles fallback */
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        setTransport("poll");
        attempt += 1;
        const delay = Math.min(4_000, 400 * attempt);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: string;
            op?: DocumentCollabOp;
            session?: DocumentCollabSession;
            document_html?: string;
            document_text?: string;
          };
          if (data.type === "op" && data.op) {
            ingestOps([data.op]);
            if (data.session) applySession(data.session);
            else if (
              data.document_html &&
              data.op.user_id !== localUserIdRef.current
            ) {
              lastPublishedHtmlRef.current = data.document_html;
              onRemoteDocumentRef.current?.(
                data.document_html,
                data.document_text ?? "",
                data.op.user_id,
              );
            }
          }
          if (data.type === "presence" && data.session) {
            applySession(data.session);
          }
        } catch {
          /* ignore */
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socketRef.current = null;
      socket?.close();
    };
  }, [applySession, enabled, ingestOps, session?.id, wsSend]);

  // HTTP poll backup only
  useEffect(() => {
    if (!enabled || !session?.id) return;
    const sessionId = session.id;
    sessionIdRef.current = sessionId;

    const shareAuth = () => {
      const share = publicShareRef.current;
      return share
        ? {
            token: share.token,
            sharePassword: share.sharePassword,
            guestId: share.guestId,
          }
        : null;
    };

    const pollOps = () => {
      const auth = shareAuth();
      const listPromise = auth
        ? listPublicDocumentCollabOps(auth, sessionId, latestSeqRef.current)
        : listDocumentCollabOps(sessionId, latestSeqRef.current);
      void listPromise.then((ops) => ingestOps(ops)).catch(() => undefined);
    };

    const pollSession = () => {
      const auth = shareAuth();
      const sessionPromise = auth
        ? getPublicDocumentCollabSession(auth, sessionId)
        : getDocumentCollabSession(sessionId);
      void sessionPromise.then((snap) => applySession(snap)).catch(() => undefined);
    };

    const opsMs = transport === "ws" ? OPS_POLL_WS_MS : OPS_POLL_HTTP_MS;
    const sessionMs = transport === "ws" ? SESSION_POLL_WS_MS : SESSION_POLL_HTTP_MS;
    const opsId = window.setInterval(pollOps, opsMs);
    const sessionIdTimer = window.setInterval(pollSession, sessionMs);
    const warm = window.setTimeout(() => {
      pollOps();
      pollSession();
    }, 100);
    return () => {
      window.clearInterval(opsId);
      window.clearInterval(sessionIdTimer);
      window.clearTimeout(warm);
    };
  }, [applySession, enabled, ingestOps, session?.id, transport]);

  const flushPresenceHttp = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const body = pendingHeartbeatRef.current;
    if (!sessionId || !enabled || !body) return;
    pendingHeartbeatRef.current = null;
    try {
      const share = publicShareRef.current;
      const next = share
        ? await heartbeatPublicDocumentCollabSession(
            {
              token: share.token,
              sharePassword: share.sharePassword,
              guestId: share.guestId,
            },
            sessionId,
            body,
          )
        : await heartbeatDocumentCollabSession(sessionId, body);
      applySession(next);
    } catch {
      /* best-effort */
    }
  }, [applySession, enabled]);

  const updatePresence = useCallback(
    async (body: HeartbeatBody) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;

      // Optimistic local presence so our own UI stays consistent
      if (localUserIdRef.current) {
        setParticipants((current) =>
          current.map((person) => {
            if (person.user_id !== localUserIdRef.current) return person;
            return {
              ...person,
              selection_start:
                body.selection_start ?? person.selection_start ?? null,
              selection_end: body.selection_end ?? person.selection_end ?? null,
              lock_start:
                body.clear_lock === true
                  ? null
                  : (body.lock_start ?? person.lock_start ?? null),
              lock_end:
                body.clear_lock === true
                  ? null
                  : (body.lock_end ?? person.lock_end ?? null),
            };
          }),
        );
      }

      // Prefer WebSocket — no HTTP latency
      if (
        wsSend({
          type: "heartbeat",
          selection_start: body.selection_start,
          selection_end: body.selection_end,
          lock_start: body.lock_start,
          lock_end: body.lock_end,
          clear_lock: body.clear_lock,
        })
      ) {
        return;
      }

      // HTTP fallback
      pendingHeartbeatRef.current = {
        ...pendingHeartbeatRef.current,
        ...body,
      };
      if (presenceTimerRef.current !== null) {
        window.clearTimeout(presenceTimerRef.current);
      }
      presenceTimerRef.current = window.setTimeout(() => {
        presenceTimerRef.current = null;
        void flushPresenceHttp();
      }, PRESENCE_DEBOUNCE_MS);
    },
    [enabled, flushPresenceHttp, wsSend],
  );

  const flushPublish = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const pending = pendingPublishRef.current;
    if (!sessionId || !enabled || !pending || publishInFlightRef.current) return;
    if (pending.html === lastPublishedHtmlRef.current) {
      pendingPublishRef.current = null;
      return;
    }

    const { html, text } = pending;

    // Prefer WebSocket for live document sync
    if (
      wsSend({
        type: "op",
        op_type: "doc_html",
        payload: { html, text },
      })
    ) {
      lastPublishedHtmlRef.current = html;
      if (pendingPublishRef.current?.html === html) {
        pendingPublishRef.current = null;
      }
      return;
    }

    publishInFlightRef.current = true;
    try {
      const share = publicShareRef.current;
      const op = share
        ? await postPublicDocumentCollabOp(
            {
              token: share.token,
              sharePassword: share.sharePassword,
              guestId: share.guestId,
            },
            sessionId,
            { op_type: "doc_html", payload: { html, text } },
          )
        : await postDocumentCollabOp(sessionId, {
            op_type: "doc_html",
            payload: { html, text },
          });
      latestSeqRef.current = Math.max(latestSeqRef.current, op.seq);
      lastPublishedHtmlRef.current = html;
      if (pendingPublishRef.current?.html === html) {
        pendingPublishRef.current = null;
      }
    } catch {
      /* retry via pending */
    } finally {
      publishInFlightRef.current = false;
      if (
        pendingPublishRef.current &&
        pendingPublishRef.current.html !== lastPublishedHtmlRef.current
      ) {
        if (publishTimerRef.current !== null) {
          window.clearTimeout(publishTimerRef.current);
        }
        publishTimerRef.current = window.setTimeout(() => {
          publishTimerRef.current = null;
          void flushPublish();
        }, PUBLISH_DEBOUNCE_MS);
      }
    }
  }, [enabled, wsSend]);

  const publishDocument = useCallback(
    (html: string, text: string) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;
      if (html === lastPublishedHtmlRef.current && !pendingPublishRef.current) return;

      pendingPublishRef.current = { html, text };

      // Human: WS path sends immediately; HTTP path still micro-batches on rAF.
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        if (publishTimerRef.current !== null) {
          window.clearTimeout(publishTimerRef.current);
          publishTimerRef.current = null;
        }
        void flushPublish();
        return;
      }

      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
      }
      publishTimerRef.current = window.setTimeout(() => {
        publishTimerRef.current = null;
        void flushPublish();
      }, Math.max(PUBLISH_DEBOUNCE_MS, 32));
    },
    [enabled, flushPublish],
  );

  // Human: Live concurrent typing — text_insert / text_delete (does not clobber peer locks).
  // Agent: WS-first op; HTTP fallback postDocumentCollabOp.
  const publishTextOp = useCallback(
    (op: {
      opType: "text_insert" | "text_delete";
      index: number;
      text?: string;
      length?: number;
    }) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;

      const payload =
        op.opType === "text_insert"
          ? { index: op.index, text: op.text ?? "" }
          : { index: op.index, length: op.length ?? 0 };

      if (
        wsSend({
          type: "op",
          op_type: op.opType,
          payload,
        })
      ) {
        return;
      }

      const share = publicShareRef.current;
      void (share
        ? postPublicDocumentCollabOp(
            {
              token: share.token,
              sharePassword: share.sharePassword,
              guestId: share.guestId,
            },
            sessionId,
            { op_type: op.opType, payload },
          )
        : postDocumentCollabOp(sessionId, { op_type: op.opType, payload })
      )
        .then((result) => {
          latestSeqRef.current = Math.max(latestSeqRef.current, result.seq);
        })
        .catch(() => undefined);
    },
    [enabled, wsSend],
  );

  const acquireSentenceLock = useCallback(
    async (text: string, caretStart: number, caretEnd: number) => {
      const range = sentenceRangeAround(text, caretStart, caretEnd);
      const prev = lastLockRef.current;
      const lockChanged = !(prev && prev.start === range.start && prev.end === range.end);
      if (lockChanged) {
        lastLockRef.current = { start: range.start, end: range.end };
      }

      await updatePresence({
        selection_start: caretStart,
        selection_end: caretEnd,
        ...(lockChanged
          ? { lock_start: range.start, lock_end: range.end }
          : {}),
      });

      // Lock op over WS for poll clients / store consistency
      if (lockChanged) {
        if (
          !wsSend({
            type: "op",
            op_type: "lock",
            payload: { start: range.start, end: range.end },
          })
        ) {
          const sessionId = sessionIdRef.current;
          if (sessionId) {
            const share = publicShareRef.current;
            void (share
              ? postPublicDocumentCollabOp(
                  {
                    token: share.token,
                    sharePassword: share.sharePassword,
                    guestId: share.guestId,
                  },
                  sessionId,
                  {
                    op_type: "lock",
                    payload: { start: range.start, end: range.end },
                  },
                )
              : postDocumentCollabOp(sessionId, {
                  op_type: "lock",
                  payload: { start: range.start, end: range.end },
                })
            ).catch(() => undefined);
          }
        }
      }
      return range;
    },
    [updatePresence, wsSend],
  );

  const releaseLock = useCallback(async () => {
    lastLockRef.current = null;
    await updatePresence({ clear_lock: true });
    if (
      !wsSend({
        type: "op",
        op_type: "unlock",
        payload: {},
      })
    ) {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        const share = publicShareRef.current;
        void (share
          ? postPublicDocumentCollabOp(
              {
                token: share.token,
                sharePassword: share.sharePassword,
                guestId: share.guestId,
              },
              sessionId,
              { op_type: "unlock", payload: {} },
            )
          : postDocumentCollabOp(sessionId, { op_type: "unlock", payload: {} })
        ).catch(() => undefined);
      }
    }
  }, [updatePresence, wsSend]);

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

  useEffect(() => {
    return () => {
      if (publishTimerRef.current !== null) window.clearTimeout(publishTimerRef.current);
      if (presenceTimerRef.current !== null) window.clearTimeout(presenceTimerRef.current);
    };
  }, []);

  return {
    session,
    participants,
    error,
    transport,
    publishDocument,
    publishTextOp,
    updatePresence,
    acquireSentenceLock,
    releaseLock,
    isRangeLockedByOther,
  };
}
