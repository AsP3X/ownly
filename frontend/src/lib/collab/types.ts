// Human: Shared collab wire types (protocol v1).
// Agent: USED by CollabClient + API helpers + editor adapters.

export type RoomKind = "document" | "spreadsheet";

export type CollabParticipant = {
  user_id: string;
  display_name: string;
  color: string;
  last_seen: number;
  presence?: Record<string, unknown>;
  selection_start?: number | null;
  selection_end?: number | null;
  lock_start?: number | null;
  lock_end?: number | null;
  active_cell?: string | null;
  sheet_name?: string | null;
};

export type DomainSnapshot = {
  snapshot_seq: number;
  data: Record<string, unknown>;
};

export type CollabOp = {
  id: string;
  seq: number;
  user_id: string;
  ts: number;
  base_seq: number;
  op_type: string;
  payload: Record<string, unknown>;
  client_op_id?: string | null;
};

export type CollabSession = {
  id: string;
  room_kind: RoomKind;
  file_id: string;
  participants: CollabParticipant[];
  latest_seq: number;
  snapshot: DomainSnapshot;
  document_html?: string | null;
  document_text?: string | null;
};

export type PublicShareAuth = {
  token: string;
  sharePassword?: string | null;
  guestId: string;
};

export type CollabTransportMode = "ws" | "poll";
