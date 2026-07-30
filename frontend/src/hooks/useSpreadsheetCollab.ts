// Human: Spreadsheet collab — thin adapter over shared CollabClient (server total-order ops).
// Agent: USED by ExcelSpreadsheetDialog; WS-first publish + presence.

import { useCallback, useEffect, useRef, useState } from "react";
import { CollabClient } from "@/lib/collab/client";
import type {
  CollabOp,
  CollabParticipant,
  CollabSession,
  CollabTransportMode,
} from "@/lib/collab/types";
import { cellAddressLabel } from "@/lib/spreadsheet/cells";
import type { CellAddress } from "@/lib/spreadsheet/types";

/** Wire-compatible op shape for existing applyCollabOpToWorkbook. */
export type SpreadsheetCollabOp = CollabOp;
export type SpreadsheetCollabParticipant = CollabParticipant;
export type SpreadsheetCollabSession = CollabSession;

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
  const [session, setSession] = useState<CollabSession | null>(null);
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);
  const [recentOps, setRecentOps] = useState<CollabOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<CollabTransportMode>("poll");

  const clientRef = useRef<CollabClient | null>(null);
  const localUserIdRef = useRef(localUserId);
  const onApplyRemoteOpsRef = useRef(onApplyRemoteOps);
  const onPresenceRef = useRef(onPresence);
  localUserIdRef.current = localUserId;
  onApplyRemoteOpsRef.current = onApplyRemoteOps;
  onPresenceRef.current = onPresence;

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
      onSession: setSession,
      onParticipants: (next) => {
        setParticipants(next);
        onPresenceRef.current?.(next);
      },
      onTransport: setTransport,
      onError: setError,
      onOp: (op, { isLocalEcho }) => {
        setRecentOps((prev) => [...prev, op].slice(-80));
        if (!isLocalEcho) {
          onApplyRemoteOpsRef.current?.([op]);
        }
      },
    });
    clientRef.current = client;
    void client.start();

    return () => {
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [displayName, enabled, fileId, localUserId]);

  // Presence: active cell / sheet over WS heartbeat (throttled by client)
  useEffect(() => {
    if (!enabled || !clientRef.current) return;
    clientRef.current.updatePresence({
      active_cell: activeCell ? cellAddressLabel(activeCell) : null,
      sheet_name: sheetName ?? null,
    });
  }, [activeCell, enabled, sheetName]);

  const publishOp = useCallback(
    async (opType: string, payload: Record<string, unknown>) => {
      if (!enabled || !clientRef.current) return;
      clientRef.current.submitOp(opType, payload);
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
