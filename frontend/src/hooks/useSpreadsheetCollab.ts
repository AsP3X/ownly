// Human: Spreadsheet co-editing presence — join session, heartbeat, poll participants/ops.
// Agent: USED by ExcelSpreadsheetDialog; FOUNDATION only (no CRDT merge of remote edits yet).

import { useCallback, useEffect, useRef, useState } from "react";
import {
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
};

export function useSpreadsheetCollab({
  fileId,
  enabled,
  activeCell,
  sheetName,
  displayName,
}: UseSpreadsheetCollabOptions) {
  const [session, setSession] = useState<SpreadsheetCollabSession | null>(null);
  const [participants, setParticipants] = useState<SpreadsheetCollabParticipant[]>([]);
  const [recentOps, setRecentOps] = useState<SpreadsheetCollabOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestSeqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !fileId) {
      setSession(null);
      setParticipants([]);
      sessionIdRef.current = null;
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

  useEffect(() => {
    if (!enabled || !sessionIdRef.current) return;
    const sessionId = sessionIdRef.current;
    const tick = () => {
      void heartbeatSpreadsheetCollabSession(sessionId, {
        active_cell: activeCell ? cellAddressLabel(activeCell) : undefined,
        sheet_name: sheetName ?? undefined,
      })
        .then((next) => {
          setSession(next);
          setParticipants(next.participants);
        })
        .catch(() => {
          /* session may expire — join effect re-runs on file change */
        });

      void listSpreadsheetCollabOps(sessionId, latestSeqRef.current)
        .then((ops) => {
          if (ops.length === 0) return;
          latestSeqRef.current = Math.max(...ops.map((op) => op.seq));
          setRecentOps((prev) => [...prev, ...ops].slice(-40));
        })
        .catch(() => undefined);
    };

    tick();
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [activeCell, enabled, sheetName, session?.id]);

  const publishOp = useCallback(
    async (opType: string, payload: Record<string, unknown>) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !enabled) return;
      try {
        const op = await postSpreadsheetCollabOp(sessionId, { op_type: opType, payload });
        latestSeqRef.current = Math.max(latestSeqRef.current, op.seq);
        setRecentOps((prev) => [...prev, op].slice(-40));
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
    publishOp,
  };
}
