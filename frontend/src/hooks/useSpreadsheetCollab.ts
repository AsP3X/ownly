// Human: Spreadsheet collab — CollabClient adapter with idle state_commit for late joiners.
// Agent: USED by ExcelSpreadsheetDialog; WS-first ops + presence + workbook snapshot.

import { useCallback, useEffect, useRef, useState } from "react";
import { CollabClient } from "@/lib/collab/client";
import type {
  CollabOp,
  CollabParticipant,
  CollabSession,
  CollabTransportMode,
} from "@/lib/collab/types";
import { cellAddressLabel } from "@/lib/spreadsheet/cells";
import type { CellAddress, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

export type SpreadsheetCollabOp = CollabOp;
export type SpreadsheetCollabParticipant = CollabParticipant;
export type SpreadsheetCollabSession = CollabSession;

const STATE_COMMIT_IDLE_MS = 1500;

type UseSpreadsheetCollabOptions = {
  fileId: string | null | undefined;
  enabled: boolean;
  activeCell: CellAddress | null;
  sheetName: string | null;
  displayName?: string;
  localUserId?: string | null;
  /** Human: Snapshot for late joiners after op log prune. */
  getWorkbook?: () => SpreadsheetWorkbook | null;
  onApplyRemoteOps?: (ops: SpreadsheetCollabOp[]) => void;
  onPresence?: (participants: SpreadsheetCollabParticipant[]) => void;
  onRemoteWorkbook?: (workbook: SpreadsheetWorkbook) => void;
};

export function useSpreadsheetCollab({
  fileId,
  enabled,
  activeCell,
  sheetName,
  displayName,
  localUserId,
  getWorkbook,
  onApplyRemoteOps,
  onPresence,
  onRemoteWorkbook,
}: UseSpreadsheetCollabOptions) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);
  const [recentOps, setRecentOps] = useState<CollabOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<CollabTransportMode>("poll");

  const clientRef = useRef<CollabClient | null>(null);
  const localUserIdRef = useRef(localUserId);
  const onApplyRemoteOpsRef = useRef(onApplyRemoteOps);
  const onPresenceRef = useRef(onPresence);
  const onRemoteWorkbookRef = useRef(onRemoteWorkbook);
  const getWorkbookRef = useRef(getWorkbook);
  const stateCommitTimerRef = useRef<number | null>(null);

  localUserIdRef.current = localUserId;
  onApplyRemoteOpsRef.current = onApplyRemoteOps;
  onPresenceRef.current = onPresence;
  onRemoteWorkbookRef.current = onRemoteWorkbook;
  getWorkbookRef.current = getWorkbook;

  useEffect(() => {
    if (!enabled || !fileId) {
      clientRef.current?.stop();
      clientRef.current = null;
      setSession(null);
      setParticipants([]);
      setError(null);
      return;
    }

    const client = new CollabClient({
      roomKind: "spreadsheet",
      fileId,
      displayName,
      localUserId,
      onSession: (next) => {
        setSession(next);
        const wb = next.snapshot?.data?.workbook;
        if (wb && typeof wb === "object" && wb !== null) {
          onRemoteWorkbookRef.current?.(wb as SpreadsheetWorkbook);
        }
      },
      onParticipants: (next) => {
        setParticipants(next);
        onPresenceRef.current?.(next);
      },
      onTransport: setTransport,
      onError: setError,
      onOp: (op, { isLocalEcho }) => {
        setRecentOps((prev) => [...prev, op].slice(-80));
        if (op.op_type === "state_commit" && !isLocalEcho) {
          const wb = op.payload?.workbook;
          if (wb && typeof wb === "object") {
            onRemoteWorkbookRef.current?.(wb as SpreadsheetWorkbook);
          }
          return;
        }
        if (!isLocalEcho) {
          onApplyRemoteOpsRef.current?.([op]);
        }
      },
      onSnapshot: (snap) => {
        const wb = snap.data?.workbook;
        if (wb && typeof wb === "object" && wb !== null) {
          onRemoteWorkbookRef.current?.(wb as SpreadsheetWorkbook);
        }
      },
    });
    clientRef.current = client;
    void client.start();

    return () => {
      if (stateCommitTimerRef.current != null) {
        window.clearTimeout(stateCommitTimerRef.current);
        stateCommitTimerRef.current = null;
      }
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [displayName, enabled, fileId, localUserId]);

  useEffect(() => {
    if (!enabled || !clientRef.current) return;
    clientRef.current.updatePresence({
      active_cell: activeCell ? cellAddressLabel(activeCell) : null,
      sheet_name: sheetName ?? null,
    });
  }, [activeCell, enabled, sheetName]);

  const scheduleStateCommit = useCallback(() => {
    if (!enabled || !clientRef.current) return;
    if (stateCommitTimerRef.current != null) {
      window.clearTimeout(stateCommitTimerRef.current);
    }
    stateCommitTimerRef.current = window.setTimeout(() => {
      stateCommitTimerRef.current = null;
      const workbook = getWorkbookRef.current?.();
      if (!workbook || !clientRef.current) return;
      clientRef.current.submitOp("state_commit", { workbook });
    }, STATE_COMMIT_IDLE_MS);
  }, [enabled]);

  const publishOp = useCallback(
    async (opType: string, payload: Record<string, unknown>) => {
      if (!enabled || !clientRef.current) return;
      clientRef.current.submitOp(opType, payload);
      if (opType !== "state_commit") {
        scheduleStateCommit();
      }
    },
    [enabled, scheduleStateCommit],
  );

  const publishStateCommit = useCallback(() => {
    const workbook = getWorkbookRef.current?.();
    if (!workbook || !clientRef.current) return;
    clientRef.current.submitOp("state_commit", { workbook });
  }, []);

  return {
    session,
    participants,
    recentOps,
    error,
    transport,
    publishOp,
    publishStateCommit,
  };
}
