import { describe, expect, it, vi, beforeEach } from "vitest";
import { CollabClient } from "./client";
import type { CollabOp, CollabSession } from "./types";

const joinMock = vi.fn();

vi.mock("./api", () => ({
  joinCollabSession: (...args: unknown[]) => joinMock(...args),
  joinPublicCollabSession: vi.fn(),
  getCollabSession: vi.fn(),
  getPublicCollabSession: vi.fn(),
  heartbeatCollabSession: vi.fn(),
  heartbeatPublicCollabSession: vi.fn(),
  listCollabOps: vi.fn(),
  listPublicCollabOps: vi.fn(),
  postCollabOp: vi.fn(),
  postPublicCollabOp: vi.fn(),
  collabWsUrl: () => "ws://test/collab",
}));

function emptySession(overrides: Partial<CollabSession> = {}): CollabSession {
  return {
    id: "s1",
    room_kind: "document",
    file_id: "f1",
    participants: [],
    latest_seq: 0,
    snapshot: { snapshot_seq: 0, data: { text: "hello", html: "<p>hello</p>" } },
    ...overrides,
  };
}

describe("CollabClient", () => {
  beforeEach(() => {
    joinMock.mockReset();
    vi.stubGlobal("WebSocket", vi.fn(() => {
      throw new Error("no ws in unit test");
    }));
  });

  it("joins and tracks latest_seq from session", async () => {
    joinMock.mockResolvedValue(emptySession({ latest_seq: 3 }));
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
    joinMock.mockResolvedValue(emptySession());
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
    client.handleServerMessage({ type: "op", op });
    client.handleServerMessage({ type: "op", op });
    expect(ops).toHaveLength(1);
    expect(client.getLatestSeq()).toBe(1);
    client.stop();
  });

  it("rebases remote replace against optimistic pending for DOM", async () => {
    joinMock.mockResolvedValue(emptySession());
    const delivered: CollabOp[] = [];
    const client = new CollabClient({
      roomKind: "document",
      fileId: "f1",
      localUserId: "u1",
      onOp: (op, meta) => {
        if (!meta.isLocalEcho) delivered.push(op);
      },
    });
    await client.start();

    // Optimistic local insert at start (pending, in-flight via HTTP path after failed WS)
    client.submitOp("replace", { index: 0, delete: 0, insert: "X" });
    expect(client.getPendingOpsForTests().length).toBe(1);

    // Concurrent remote insert at end of base "hello" (index 5)
    const remote: CollabOp = {
      id: "r1",
      seq: 1,
      user_id: "u2",
      ts: 1,
      base_seq: 0,
      op_type: "replace",
      payload: { index: 5, delete: 0, insert: "Y" },
    };
    client.handleServerMessage({ type: "op", op: remote });

    expect(delivered).toHaveLength(1);
    // After pending X at 0, remote Y at 5 becomes Y at 6 for DOM
    expect(delivered[0].payload).toEqual({ index: 6, delete: 0, insert: "Y" });
    // Pending local payload should shift for bookkeeping
    const pending = client.getPendingOpsForTests();
    expect(pending.length).toBe(1);
    expect(pending[0].payload).toEqual({ index: 0, delete: 0, insert: "X" });
    client.stop();
  });

  it("ignores invalid_op errors so the strip stays online", async () => {
    joinMock.mockResolvedValue(emptySession());
    const onError = vi.fn();
    const client = new CollabClient({
      roomKind: "document",
      fileId: "f1",
      onError,
    });
    await client.start();
    client.handleServerMessage({
      type: "error",
      code: "invalid_op",
      message: "invalid op: lock range must be non-empty",
    });
    client.handleServerMessage({
      type: "error",
      code: "client_message",
      message: "invalid op: lock range must be non-empty",
    });
    expect(onError).not.toHaveBeenCalled();
    client.stop();
  });

  it("schedules format_commit retry on text_mismatch", async () => {
    vi.useFakeTimers();
    joinMock.mockResolvedValue(emptySession());
    const getFormat = vi.fn(() => ({ html: "<p>hi</p>", text: "hi" }));
    const client = new CollabClient({
      roomKind: "document",
      fileId: "f1",
      getFormatCommitPayload: getFormat,
    });
    await client.start();
    const submitSpy = vi.spyOn(client, "submitOp");
    client.handleServerMessage({
      type: "error",
      code: "text_mismatch",
      message: "diverged",
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(getFormat).toHaveBeenCalled();
    expect(submitSpy).toHaveBeenCalledWith("format_commit", {
      html: "<p>hi</p>",
      text: "hi",
    });
    client.stop();
    vi.useRealTimers();
  });
});
