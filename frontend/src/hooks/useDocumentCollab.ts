// Human: Live RTF/document collab — WS push + sparse poll, exclusive sentence locks, doc_html ops.
// Agent: USED by RtfEditorDialog; THROTTLES HTTP so nginx/API are not flooded by keystrokes.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  API_BASE,
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

/** Human: Coalesce full-document publish while typing (ms). */
const PUBLISH_DEBOUNCE_MS = 280;
/** Human: Min gap between presence/lock heartbeats (ms). */
const HEARTBEAT_MIN_INTERVAL_MS = 800;
/** Human: Poll gap-fill when WebSocket is healthy. */
const POLL_WS_MS = 12_000;
/** Human: Poll when falling back to HTTP-only transport. */
const POLL_HTTP_MS = 3_000;

type PublicShareCollab = {
  token: string;
  sharePassword?: string | null;
  guestId: string;
};

type UseDocumentCollabOptions = {
  fileId: string | null | undefined;
  enabled: boolean;
  displayName?: string;
  localUserId?: string | null;
  /** Human: When set, use anonymous public-share collab APIs instead of JWT sessions. */
  publicShare?: PublicShareCollab | null;
  /** Human: Seed shared document when this client creates the session. */
  getSeed?: () => { html: string; text: string };
  onRemoteDocument?: (html: string, text: string, fromUserId: string) => void;
  onPresence?: (participants: DocumentCollabParticipant[]) => void;
};

function collabWsUrl(sessionId: string, publicShare?: PublicShareCollab | null): string {
  const base =
    typeof window !== "undefined" && API_BASE.startsWith("http")
      ? API_BASE
      : `${window.location.origin}${API_BASE.startsWith("/") ? API_BASE : `/${API_BASE}`}`;
  const wsBase = base.replace(/^http/, "ws");
  if (publicShare?.token) {
    const params = new URLSearchParams({ guest_id: publicShare.guestId });
    // Human: Browser WebSocket cannot set X-Share-Password — pass password as query for protected links.
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
  const onPresenceRef = useRef(onPresence);
  const getSeedRef = useRef(getSeed);
  const publishTimerRef = useRef<number | null>(null);
  const lastPublishedHtmlRef = useRef<string | null>(null);
  const lastLockRef = useRef<{ start: number; end: number } | null>(null);
  const lastHeartbeatAtRef = useRef(0);
  const heartbeatInFlightRef = useRef(false);
  const pendingHeartbeatRef = useRef<{
    selection_start?: number;
    selection_end?: number;
    lock_start?: number;
    lock_end?: number;
    clear_lock?: boolean;
  } | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  localUserIdRef.current = localUserId;
  publicShareRef.current = publicShare;
  onRemoteDocumentRef.current = onRemoteDocument;
  onPresenceRef.current = onPresence;
  getSeedRef.current = getSeed;

  const applySession = useCallback((next: DocumentCollabSession) => {
    setSession(next);
    setParticipants(next.participants);
    onPresenceRef.current?.(next.participants);
  }, []);

  const ingestOps = useCallback((ops: DocumentCollabOp[]) => {
    if (ops.length === 0) return;
    latestSeqRef.current = Math.max(latestSeqRef.current, ...ops.map((entry) => entry.seq));
    for (const op of ops) {
      // Human: Poll fallback does not receive presence frames — apply lock ops to local participants.
      if (op.op_type === "lock") {
        const start =
          typeof op.payload.start === "number"
            ? op.payload.start
            : Number(op.payload.start);
        const end =
          typeof op.payload.end === "number" ? op.payload.end : Number(op.payload.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          setParticipants((current) => {
            const next = current.map((person) =>
              person.user_id === op.user_id
                ? { ...person, lock_start: start, lock_end: end }
                : person,
            );
            if (!next.some((person) => person.user_id === op.user_id)) {
              next.push({
                user_id: op.user_id,
                display_name: "Collaborator",
                color: "#2563EB",
                last_seen: Date.now(),
                selection_start: null,
                selection_end: null,
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

      if (localUserIdRef.current && op.user_id === localUserIdRef.current) continue;
      if (op.op_type === "doc_html") {
        const html = typeof op.payload.html === "string" ? op.payload.html : "";
        const text = typeof op.payload.text === "string" ? op.payload.text : "";
        if (html) onRemoteDocumentRef.current?.(html, text, op.user_id);
      }
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
        if (joined.document_html) {
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

  // WebSocket live channel
  useEffect(() => {
    if (!enabled || !session?.id) return;
    const sessionId = session.id;
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(collabWsUrl(sessionId, publicShareRef.current));
      } catch {
        setTransport("poll");
        return;
      }

      socket.onopen = () => {
        if (!closed) setTransport("ws");
      };
      socket.onerror = () => {
        // Human: onclose handles fallback; avoid double setTransport chatter.
      };
      socket.onclose = () => {
        if (closed) return;
        setTransport("poll");
        // Human: Gentle reconnect so a brief proxy blip does not stick us on HTTP poll forever.
        reconnectTimer = window.setTimeout(connect, 4_000);
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
      socket?.close();
    };
  }, [applySession, enabled, ingestOps, session?.id]);

  // Sparse poll gap-fill (WS is primary; HTTP poll is backup only)
  useEffect(() => {
    if (!enabled || !session?.id) return;
    const sessionId = session.id;
    sessionIdRef.current = sessionId;

    const tick = () => {
      const share = publicShareRef.current;
      const listPromise = share
        ? listPublicDocumentCollabOps(
            {
              token: share.token,
              sharePassword: share.sharePassword,
              guestId: share.guestId,
            },
            sessionId,
            latestSeqRef.current,
          )
        : listDocumentCollabOps(sessionId, latestSeqRef.current);
      void listPromise.then((ops) => ingestOps(ops)).catch(() => undefined);
    };

    // Human: Skip immediate tick on mount when WS will deliver ops — reduces join storm.
    const intervalMs = transport === "ws" ? POLL_WS_MS : POLL_HTTP_MS;
    const id = window.setInterval(tick, intervalMs);
    if (transport === "poll") {
      tick();
    }
    return () => window.clearInterval(id);
  }, [enabled, ingestOps, session?.id, transport]);

  // Human: Coalesce presence heartbeats so selection churn does not open a request per caret move.
  // Agent: QUEUES latest body; FLUSHES at most once per HEARTBEAT_MIN_INTERVAL_MS.
  const flushHeartbeat = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const body = pendingHeartbeatRef.current;
    if (!sessionId || !enabled || !body || heartbeatInFlightRef.current) return;

    pendingHeartbeatRef.current = null;
    heartbeatInFlightRef.current = true;
    lastHeartbeatAtRef.current = Date.now();
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
    } finally {
      heartbeatInFlightRef.current = false;
      if (pendingHeartbeatRef.current) {
        void flushHeartbeat();
      }
    }
  }, [applySession, enabled]);

  const updatePresence = useCallback(
    async (body: {
      selection_start?: number;
      selection_end?: number;
      lock_start?: number;
      lock_end?: number;
      clear_lock?: boolean;
    }) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;

      pendingHeartbeatRef.current = {
        ...pendingHeartbeatRef.current,
        ...body,
      };

      const elapsed = Date.now() - lastHeartbeatAtRef.current;
      if (elapsed >= HEARTBEAT_MIN_INTERVAL_MS && !heartbeatInFlightRef.current) {
        await flushHeartbeat();
        return;
      }

      if (heartbeatTimerRef.current !== null) {
        window.clearTimeout(heartbeatTimerRef.current);
      }
      const wait = Math.max(0, HEARTBEAT_MIN_INTERVAL_MS - elapsed);
      heartbeatTimerRef.current = window.setTimeout(() => {
        heartbeatTimerRef.current = null;
        void flushHeartbeat();
      }, wait);
    },
    [enabled, flushHeartbeat],
  );

  // Human: Debounced full-document publish — skip no-op posts when HTML is unchanged.
  // Agent: SCHEDULES postDocumentCollabOp doc_html; PUBLISH_DEBOUNCE_MS coalesce under typing.
  const publishDocument = useCallback(
    (html: string, text: string) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;
      if (html === lastPublishedHtmlRef.current) return;

      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
      }
      publishTimerRef.current = window.setTimeout(() => {
        publishTimerRef.current = null;
        if (html === lastPublishedHtmlRef.current) return;
        lastPublishedHtmlRef.current = html;
        const share = publicShareRef.current;
        const postPromise = share
          ? postPublicDocumentCollabOp(
              {
                token: share.token,
                sharePassword: share.sharePassword,
                guestId: share.guestId,
              },
              sessionId,
              {
                op_type: "doc_html",
                payload: { html, text },
              },
            )
          : postDocumentCollabOp(sessionId, {
              op_type: "doc_html",
              payload: { html, text },
            });
        void postPromise
          .then((op) => {
            latestSeqRef.current = Math.max(latestSeqRef.current, op.seq);
          })
          .catch(() => undefined);
      }, PUBLISH_DEBOUNCE_MS);
    },
    [enabled],
  );

  // Human: Sentence lock via heartbeat only — no separate lock op (was doubling HTTP traffic).
  // Agent: SKIPS when sentence range unchanged; THROTTLED by updatePresence.
  const acquireSentenceLock = useCallback(
    async (text: string, caretStart: number, caretEnd: number) => {
      const range = sentenceRangeAround(text, caretStart, caretEnd);
      const prev = lastLockRef.current;
      if (prev && prev.start === range.start && prev.end === range.end) {
        // Same sentence — only refresh selection caret occasionally via presence.
        await updatePresence({
          selection_start: caretStart,
          selection_end: caretEnd,
        });
        return range;
      }
      lastLockRef.current = { start: range.start, end: range.end };
      await updatePresence({
        selection_start: caretStart,
        selection_end: caretEnd,
        lock_start: range.start,
        lock_end: range.end,
      });
      return range;
    },
    [updatePresence],
  );

  const releaseLock = useCallback(async () => {
    lastLockRef.current = null;
    await updatePresence({ clear_lock: true });
  }, [updatePresence]);

  // Human: True when a plain-text range is exclusively locked by someone else.
  // Agent: SCANS participants except local user.
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
      if (heartbeatTimerRef.current !== null) window.clearTimeout(heartbeatTimerRef.current);
    };
  }, []);

  return {
    session,
    participants,
    error,
    transport,
    publishDocument,
    updatePresence,
    acquireSentenceLock,
    releaseLock,
    isRangeLockedByOther,
  };
}
