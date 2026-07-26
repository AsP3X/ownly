// Human: Spreadsheet co-editing — join, heartbeat, poll ops, apply remote cell_edit locally.
// Agent: USED by ExcelSpreadsheetDialog; LAST-WRITE-WINS apply via onApplyRemoteOps.

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
  /** Human: Local user id so remote apply can skip echo of our own ops. */
  localUserId?: string | null;
  /** Human: Apply remote ops into the editor workbook (without re-publishing). */
  onApplyRemoteOps?: (ops: SpreadsheetCollabOp[]) => void;
};

export function useSpreadsheetCollab({
  fileId,
  enabled,
  activeCell,
  sheetName,
  displayName,
  localUserId,
  onApplyRemoteOps,
}: UseSpreadsheetCollabOptions) {
  const [session, setSession] = useState<SpreadsheetCollabSession | null>(null);
  const [participants, setParticipants] = useState<SpreadsheetCollabParticipant[]>([]);
  const [recentOps, setRecentOps] = useState<SpreadsheetCollabOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestSeqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const localUserIdRef = useRef(localUserId);
  const onApplyRemoteOpsRef = useRef(onApplyRemoteOps);
  localUserIdRef.current = localUserId;
  onApplyRemoteOpsRef.current = onApplyRemoteOps;

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
        })
        .catch(() => undefined);

      void listSpreadsheetCollabOps(sessionId, latestSeqRef.current)
        .then((ops) => {
          if (ops.length === 0) return;
          latestSeqRef.current = Math.max(
            latestSeqRef.current,
            ...ops.map((entry) => entry.seq),
          );
          setRecentOps((prev) => [...prev, ...ops].slice(-40));
          const remote = ops.filter(
            (entry) => !localUserIdRef.current || entry.user_id !== localUserIdRef.current,
          );
          if (remote.length > 0) {
            onApplyRemoteOpsRef.current?.(remote);
          }
        })
        .catch(() => undefined);
    };

    tick();
    const id = window.setInterval(tick, 2500);
    return () => window.clearInterval(id);
  }, [activeCell, enabled, session?.id, sheetName]);

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
