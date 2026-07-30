import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CollabClient } from "./client";
import type { CollabOp, CollabSession } from "./types";

const joinMock = vi.fn();
const listMock = vi.fn();

vi.mock("./api", () => ({
  joinCollabSession: (...args: unknown[]) => joinMock(...args),
  joinPublicCollabSession: vi.fn(),
  getCollabSession: vi.fn(),
  getPublicCollabSession: vi.fn(),
  heartbeatCollabSession: vi.fn(),
  heartbeatPublicCollabSession: vi.fn(),
  listCollabOps: (...args: unknown[]) => listMock(...args),
  listPublicCollabOps: vi.fn(),
  postCollabOp: vi.fn(),
  postPublicCollabOp: vi.fn(),
  collabWsUrl: () => "ws://test/collab",
}));

describe("CollabClient", () => {
  beforeEach(() => {
    joinMock.mockReset();
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins and tracks latest_seq from session", async () => {
    const session: CollabSession = {
      id: "s1",
      room_kind: "document",
      file_id: "f1",
      participants: [],
      latest_seq: 3,
      snapshot: { snapshot_seq: 0, data: { text: "hi", html: "<p>hi</p>" } },
      document_text: "hi",
      document_html: "<p>hi</p>",
    };
    joinMock.mockResolvedValue(session);

    // Prevent real WebSocket
    const wsCtor = vi.fn(() => {
      throw new Error("no ws in unit test");
    });
    vi.stubGlobal("WebSocket", wsCtor);

    const onSession = vi.fn();
    const client = new CollabClient({
      roomKind: "document",
      fileId: "f1",
      onSession,
    });
    const result = await client.start();
    expect(result?.id).toBe("s1");
    expect(client.getLatestSeq()).toBe(3);
    expect(onSession).toHaveBeenCalled();
    client.stop();
  });

  it("dedupes ops by seq", async () => {
    joinMock.mockResolvedValue({
      id: "s1",
      room_kind: "document",
      file_id: "f1",
      participants: [],
      latest_seq: 0,
      snapshot: { snapshot_seq: 0, data: {} },
    } satisfies CollabSession);

    vi.stubGlobal("WebSocket", vi.fn(() => {
      throw new Error("no ws");
    }));

    const ops: CollabOp[] = [];
    const client = new CollabClient({
      roomKind: "document",
      fileId: "f1",
      localUserId: "u1",
      onOp: (op) => ops.push(op),
    });
    await client.start();

    const op: CollabOp = {
      id: "1",
      seq: 1,
      user_id: "u2",
      ts: 1,
      base_seq: 0,
      op_type: "replace",
      payload: { index: 0, delete: 0, insert: "a" },
    };

    // Access private via any for unit coverage of ingest path through message handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal = client as any;
    internal.handleServerMessage({ type: "op", op });
    internal.handleServerMessage({ type: "op", op });
    expect(ops).toHaveLength(1);
    expect(client.getLatestSeq()).toBe(1);
    client.stop();
  });
});
