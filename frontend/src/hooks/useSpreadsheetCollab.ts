// Human: Spreadsheet co-editing — join, WS push + poll fallback, apply multi-type remote ops.
// Agent: USED by ExcelSpreadsheetDialog; CENTRALIZED SEQ ORDER = sequential OT total order.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  API_BASE,
  heartbeatSpreadsheetCollabSession,
  joinSpreadsheetCollabSession,
  listSpreadsheetCollabOps,
  postSpreadsheetCollabOp,
  type SpreadsheetCollabOp,
  type SpreadsheetCollabParticipant,
  type SpreadsheetCollabSession,
} from "@/api/client";
import { cellAddressLabel } from "@/lib/spreadsheet/cells";
import type { CellAddress } from "@/lib/spreadsheet/types";

type UseSpreadsheetCollabOptions = {
  fileId: string | null | undefined;
  enabled: boolean;
  activeCell: CellAddress | null;
  sheetName: string | null;
  displayName?: string;
  localUserId?: string | null;
  onApplyRemoteOps?: (ops: SpreadsheetCollabOp[]) => void;
  onPresence?: (participants: SpreadsheetCollabParticipant[]) => void;
};

function collabWsUrl(sessionId: string): string {
  const base =
    typeof window !== "undefined" && API_BASE.startsWith("http")
      ? API_BASE
      : `${window.location.origin}${API_BASE.startsWith("/") ? API_BASE : `/${API_BASE}`}`;
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/spreadsheet/sessions/${encodeURIComponent(sessionId)}/ws`;
}

export function useSpreadsheetCollab({
  fileId,
  enabled,
  activeCell,
  sheetName,
  displayName,
  localUserId,
  onApplyRemoteOps,
  onPresence,
}: UseSpreadsheetCollabOptions) {
  const [session, setSession] = useState<SpreadsheetCollabSession | null>(null);
  const [participants, setParticipants] = useState<SpreadsheetCollabParticipant[]>([]);
  const [recentOps, setRecentOps] = useState<SpreadsheetCollabOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"ws" | "poll">("poll");
  const latestSeqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const localUserIdRef = useRef(localUserId);
  const onApplyRemoteOpsRef = useRef(onApplyRemoteOps);
  const onPresenceRef = useRef(onPresence);
  localUserIdRef.current = localUserId;
  onApplyRemoteOpsRef.current = onApplyRemoteOps;
  onPresenceRef.current = onPresence;

  const ingestOps = useCallback((ops: SpreadsheetCollabOp[]) => {
    if (ops.length === 0) return;
    latestSeqRef.current = Math.max(latestSeqRef.current, ...ops.map((entry) => entry.seq));
    setRecentOps((prev) => [...prev, ...ops].slice(-80));
    const remote = ops.filter(
      (entry) => !localUserIdRef.current || entry.user_id !== localUserIdRef.current,
    );
    if (remote.length > 0) onApplyRemoteOpsRef.current?.(remote);
  }, []);

  useEffect(() => {
    if (!enabled || !fileId) {
      setSession(null);
      setParticipants([]);
      sessionIdRef.current = null;
      latestSeqRef.current = 0;
      return;
    }

    let cancelled = false;
    void joinSpreadsheetCollabSession({
      file_id: fileId,
      display_name: displayName,
    })
      .then((joined) => {
        if (cancelled) return;
        setSession(joined);
        setParticipants(joined.participants);
        sessionIdRef.current = joined.id;
        latestSeqRef.current = joined.latest_seq;
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Co-editing session unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [displayName, enabled, fileId]);

  // WebSocket live channel
  useEffect(() => {
    if (!enabled || !session?.id) return;
    const sessionId = session.id;
    let socket: WebSocket | null = null;
    let closed = false;

    try {
      socket = new WebSocket(collabWsUrl(sessionId));
    } catch {
      setTransport("poll");
      return;
    }

    socket.onopen = () => {
      if (!closed) setTransport("ws");
    };
    socket.onerror = () => {
      if (!closed) setTransport("poll");
    };
    socket.onclose = () => {
      if (!closed) setTransport("poll");
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          op?: SpreadsheetCollabOp;
          session?: SpreadsheetCollabSession;
        };
        if (data.type === "op" && data.op) {
          ingestOps([data.op]);
        }
        if (data.type === "presence" && data.session) {
          setSession(data.session);
          setParticipants(data.session.participants);
          onPresenceRef.current?.(data.session.participants);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      closed = true;
      socket?.close();
    };
  }, [enabled, ingestOps, session?.id]);

  // Heartbeat + poll fallback (also fills gaps if WS drops messages)
  useEffect(() => {
    if (!enabled || !session?.id) return;
    const sessionId = session.id;
    sessionIdRef.current = sessionId;

    const tick = () => {
      void heartbeatSpreadsheetCollabSession(sessionId, {
        active_cell: activeCell ? cellAddressLabel(activeCell) : undefined,
        sheet_name: sheetName ?? undefined,
      })
        .then((next) => {
          setSession(next);
          setParticipants(next.participants);
          onPresenceRef.current?.(next.participants);
        })
        .catch(() => undefined);

      void listSpreadsheetCollabOps(sessionId, latestSeqRef.current)
        .then((ops) => ingestOps(ops))
        .catch(() => undefined);
    };

    tick();
    const intervalMs = transport === "ws" ? 8000 : 2000;
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [activeCell, enabled, ingestOps, session?.id, sheetName, transport]);

  const publishOp = useCallback(
    async (opType: string, payload: Record<string, unknown>) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;
      try {
        const op = await postSpreadsheetCollabOp(sessionId, { op_type: opType, payload });
        latestSeqRef.current = Math.max(latestSeqRef.current, op.seq);
        setRecentOps((prev) => [...prev, op].slice(-80));
      } catch {
        /* best-effort */
      }
    },
    [enabled],
  );

  return {
    session,
    participants,
    recentOps,
    error,
    transport,
    publishOp,
  };
}
