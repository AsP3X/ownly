// Human: Live RTF/document collab — WS + poll, sentence locks, throttled doc_html ops.
// Agent: USED by RtfEditorDialog; RELIABLE publish (retry on failure); presence/lock sync for highlights.

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

/** Human: Coalesce typing into doc_html publishes — keep low for live feel. */
const PUBLISH_DEBOUNCE_MS = 90;
/** Human: Min gap between presence heartbeats (selection/cursor/lock). */
const HEARTBEAT_MIN_INTERVAL_MS = 100;
/** Human: Ops gap-fill when WebSocket is healthy. */
const OPS_POLL_WS_MS = 2_000;
/** Human: Ops gap-fill when falling back to HTTP-only transport. */
const OPS_POLL_HTTP_MS = 700;
/** Human: Presence/lock snapshot poll. */
const SESSION_POLL_WS_MS = 1_500;
const SESSION_POLL_HTTP_MS = 800;

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
  publicShare?: PublicShareCollab | null;
  getSeed?: () => { html: string; text: string };
  onRemoteDocument?: (html: string, text: string, fromUserId: string) => void;
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
  const pendingPublishRef = useRef<{ html: string; text: string } | null>(null);
  const lastPublishedHtmlRef = useRef<string | null>(null);
  const lastLockRef = useRef<{ start: number; end: number } | null>(null);
  const lastHeartbeatAtRef = useRef(0);
  const heartbeatInFlightRef = useRef(false);
  const pendingHeartbeatRef = useRef<HeartbeatBody | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const publishInFlightRef = useRef(false);

  localUserIdRef.current = localUserId;
  publicShareRef.current = publicShare;
  onRemoteDocumentRef.current = onRemoteDocument;
  onPresenceRef.current = onPresence;
  getSeedRef.current = getSeed;

  const applySession = useCallback((next: DocumentCollabSession) => {
    setSession(next);
    setParticipants(Array.isArray(next.participants) ? next.participants : []);
    onPresenceRef.current?.(next.participants ?? []);
  }, []);

  const ingestOps = useCallback((ops: DocumentCollabOp[]) => {
    if (ops.length === 0) return;
    latestSeqRef.current = Math.max(latestSeqRef.current, ...ops.map((entry) => entry.seq));
    for (const op of ops) {
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
              return { ...person, lock_start: start, lock_end: end };
            });
            if (!found) {
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
        if (html) {
          lastPublishedHtmlRef.current = html;
          onRemoteDocumentRef.current?.(html, text, op.user_id);
        }
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
        // Human: Only adopt remote seed when the session already has content from another peer.
        // Agent: AVOIDS clobbering the local open document with an empty session seed.
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

  // WebSocket live channel
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
        return;
      }

      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        setTransport("ws");
      };
      socket.onerror = () => {
        /* onclose handles fallback */
      };
      socket.onclose = () => {
        if (closed) return;
        setTransport("poll");
        attempt += 1;
        const delay = Math.min(8_000, 1_500 * attempt);
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
      socket?.close();
    };
  }, [applySession, enabled, ingestOps, session?.id]);

  // Poll ops (document sync) and session (presence/locks) on separate cadences.
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
    // One warm poll so a late joiner catches remote content/locks quickly.
    const warm = window.setTimeout(() => {
      pollOps();
      pollSession();
    }, 200);
    return () => {
      window.clearInterval(opsId);
      window.clearInterval(sessionIdTimer);
      window.clearTimeout(warm);
    };
  }, [applySession, enabled, ingestOps, session?.id, transport]);

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
    async (body: HeartbeatBody) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;

      pendingHeartbeatRef.current = {
        ...pendingHeartbeatRef.current,
        ...body,
      };

      // Human: Lock changes should reach peers ASAP; selection can wait the min interval.
      const urgent =
        body.lock_start != null ||
        body.lock_end != null ||
        body.clear_lock === true;

      const elapsed = Date.now() - lastHeartbeatAtRef.current;
      if (
        (urgent || elapsed >= HEARTBEAT_MIN_INTERVAL_MS) &&
        !heartbeatInFlightRef.current
      ) {
        await flushHeartbeat();
        return;
      }

      if (heartbeatTimerRef.current !== null) {
        window.clearTimeout(heartbeatTimerRef.current);
      }
      const wait = urgent
        ? 0
        : Math.max(0, HEARTBEAT_MIN_INTERVAL_MS - elapsed);
      heartbeatTimerRef.current = window.setTimeout(() => {
        heartbeatTimerRef.current = null;
        void flushHeartbeat();
      }, wait);
    },
    [enabled, flushHeartbeat],
  );

  const flushPublish = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const pending = pendingPublishRef.current;
    if (!sessionId || !enabled || !pending || publishInFlightRef.current) return;
    if (pending.html === lastPublishedHtmlRef.current) {
      pendingPublishRef.current = null;
      return;
    }

    publishInFlightRef.current = true;
    const { html, text } = pending;
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
      // Only clear pending if nothing newer arrived while in flight
      if (pendingPublishRef.current?.html === html) {
        pendingPublishRef.current = null;
      }
    } catch {
      // Human: Leave pending so the next debounce/tick retries a failed publish.
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
  }, [enabled]);

  const publishDocument = useCallback(
    (html: string, text: string) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;
      if (html === lastPublishedHtmlRef.current && !pendingPublishRef.current) return;

      pendingPublishRef.current = { html, text };
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
      }
      publishTimerRef.current = window.setTimeout(() => {
        publishTimerRef.current = null;
        void flushPublish();
      }, PUBLISH_DEBOUNCE_MS);
    },
    [enabled, flushPublish],
  );

  const acquireSentenceLock = useCallback(
    async (text: string, caretStart: number, caretEnd: number) => {
      const range = sentenceRangeAround(text, caretStart, caretEnd);
      const prev = lastLockRef.current;
      if (prev && prev.start === range.start && prev.end === range.end) {
        await updatePresence({
          selection_start: caretStart,
          selection_end: caretEnd,
        });
        return range;
      }
      lastLockRef.current = { start: range.start, end: range.end };

      // Optimistic local lock so peers see us quickly after our heartbeat returns
      if (localUserIdRef.current) {
        setParticipants((current) =>
          current.map((person) =>
            person.user_id === localUserIdRef.current
              ? { ...person, lock_start: range.start, lock_end: range.end }
              : person,
          ),
        );
      }

      await updatePresence({
        selection_start: caretStart,
        selection_end: caretEnd,
        lock_start: range.start,
        lock_end: range.end,
      });

      const sessionId = sessionIdRef.current;
      if (sessionId) {
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
                op_type: "lock",
                payload: { start: range.start, end: range.end },
              },
            )
          : postDocumentCollabOp(sessionId, {
              op_type: "lock",
              payload: { start: range.start, end: range.end },
            });
        void postPromise
          .then((op) => {
            latestSeqRef.current = Math.max(latestSeqRef.current, op.seq);
          })
          .catch(() => undefined);
      }
      return range;
    },
    [updatePresence],
  );

  const releaseLock = useCallback(async () => {
    lastLockRef.current = null;
    await updatePresence({ clear_lock: true });
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      const share = publicShareRef.current;
      const postPromise = share
        ? postPublicDocumentCollabOp(
            {
              token: share.token,
              sharePassword: share.sharePassword,
              guestId: share.guestId,
            },
            sessionId,
            { op_type: "unlock", payload: {} },
          )
        : postDocumentCollabOp(sessionId, { op_type: "unlock", payload: {} });
      void postPromise.catch(() => undefined);
    }
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
