// Human: Framework-agnostic collab client — WS-first, base_seq OT, pending rebase, presence.
// Agent: USED by useDocumentCollab / useSpreadsheetCollab; domain-agnostic op fan-in/out.

import {
  collabWsUrl,
  getCollabSession,
  getPublicCollabSession,
  heartbeatCollabSession,
  heartbeatPublicCollabSession,
  joinCollabSession,
  joinPublicCollabSession,
  listCollabOps,
  listPublicCollabOps,
  postCollabOp,
  postPublicCollabOp,
} from "./api";
import { transformReplace, type TextReplace } from "./ot/text";
import type {
  CollabOp,
  CollabParticipant,
  CollabSession,
  CollabTransportMode,
  DomainSnapshot,
  PublicShareAuth,
  RoomKind,
} from "./types";

export type CollabClientOptions = {
  roomKind: RoomKind;
  fileId: string;
  displayName?: string;
  localUserId?: string | null;
  publicShare?: PublicShareAuth | null;
  seed?: Record<string, unknown>;
  onSession?: (session: CollabSession) => void;
  onParticipants?: (participants: CollabParticipant[]) => void;
  onOp?: (op: CollabOp, meta: { isLocalEcho: boolean }) => void;
  onSnapshot?: (snapshot: DomainSnapshot) => void;
  onTransport?: (mode: CollabTransportMode) => void;
  onError?: (message: string, code?: string) => void;
  /** Human: Used to auto-retry format_commit after text_mismatch once sync catches up. */
  getFormatCommitPayload?: () => { html: string; text: string } | null;
};

type PendingOp = {
  clientOpId: string;
  baseSeq: number;
  opType: string;
  payload: Record<string, unknown>;
  /** Human: True after HTTP post started or WS send accepted. */
  inFlight: boolean;
};

function newClientOpId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseReplacePayload(payload: Record<string, unknown>): TextReplace | null {
  const index = Number(payload.index);
  const del = Number(payload.delete ?? 0);
  const insert = typeof payload.insert === "string" ? payload.insert : "";
  if (!Number.isFinite(index) || !Number.isFinite(del)) return null;
  if (del === 0 && !insert) return null;
  return { index, delete: del, insert };
}

function replaceToPayload(op: TextReplace): Record<string, unknown> {
  return { index: op.index, delete: op.delete, insert: op.insert };
}

export class CollabClient {
  private opts: CollabClientOptions;
  private sessionId: string | null = null;
  private latestSeq = 0;
  private socket: WebSocket | null = null;
  private transport: CollabTransportMode = "poll";
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pollTimer: number | null = null;
  private presenceTimer: number | null = null;
  private pendingPresence: Record<string, unknown> | null = null;
  private pendingOps: PendingOp[] = [];
  private snapshot: DomainSnapshot | null = null;
  private formatRetryTimer: number | null = null;
  private formatRetryArmed = false;

  constructor(opts: CollabClientOptions) {
    this.opts = opts;
  }

  /** Human: Update options that change over the session (callbacks, seed getters). */
  updateOptions(partial: Partial<CollabClientOptions>): void {
    this.opts = { ...this.opts, ...partial };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getLatestSeq(): number {
    return this.latestSeq;
  }

  getTransport(): CollabTransportMode {
    return this.transport;
  }

  getSnapshot(): DomainSnapshot | null {
    return this.snapshot;
  }

  /** Exposed for tests — pending replace ops after remote rebase. */
  getPendingOpsForTests(): ReadonlyArray<PendingOp> {
    return this.pendingOps;
  }

  async start(): Promise<CollabSession | null> {
    this.closed = false;
    const share = this.opts.publicShare;
    try {
      const session = share
        ? await joinPublicCollabSession(share, {
            file_id: this.opts.fileId,
            display_name: this.opts.displayName,
            seed: this.opts.seed,
            room_kind: this.opts.roomKind,
          })
        : await joinCollabSession({
            room_kind: this.opts.roomKind,
            file_id: this.opts.fileId,
            display_name: this.opts.displayName,
            seed: this.opts.seed,
          });
      this.applySession(session);
      this.connectWs();
      return session;
    } catch {
      this.opts.onError?.("Live co-editing unavailable");
      return null;
    }
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.presenceTimer != null) {
      window.clearTimeout(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.formatRetryTimer != null) {
      window.clearTimeout(this.formatRetryTimer);
      this.formatRetryTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.pendingOps = [];
  }

  submitOp(opType: string, payload: Record<string, unknown>): string {
    const clientOpId = newClientOpId();
    const baseSeq = this.latestSeq;
    const pending: PendingOp = {
      clientOpId,
      baseSeq,
      opType,
      payload: { ...payload },
      inFlight: false,
    };
    this.pendingOps.push(pending);

    if (
      this.wsSend({
        type: "op",
        base_seq: baseSeq,
        op_type: opType,
        payload: pending.payload,
        client_op_id: clientOpId,
      })
    ) {
      pending.inFlight = true;
      return clientOpId;
    }

    pending.inFlight = true;
    void this.postOpHttp(pending);
    return clientOpId;
  }

  updatePresence(presence: Record<string, unknown>): void {
    this.pendingPresence = { ...this.pendingPresence, ...presence };
    if (this.wsSend({ type: "heartbeat", presence: this.pendingPresence })) {
      this.pendingPresence = null;
      return;
    }
    if (this.presenceTimer != null) window.clearTimeout(this.presenceTimer);
    this.presenceTimer = window.setTimeout(() => {
      this.presenceTimer = null;
      void this.flushPresenceHttp();
    }, 50);
  }

  requestSync(): void {
    if (this.wsSend({ type: "sync", after_seq: this.latestSeq })) return;
    void this.pollOpsOnce();
  }

  private applySession(session: CollabSession): void {
    this.sessionId = session.id;
    this.latestSeq = Math.max(this.latestSeq, session.latest_seq ?? 0);
    this.snapshot = session.snapshot ?? this.snapshot;
    this.opts.onSession?.(session);
    this.opts.onParticipants?.(session.participants ?? []);
    if (session.snapshot) this.opts.onSnapshot?.(session.snapshot);
  }

  private setTransport(mode: CollabTransportMode): void {
    if (this.transport === mode) return;
    this.transport = mode;
    this.opts.onTransport?.(mode);
    if (mode === "poll") this.startPollFallback();
    else this.stopPollFallback();
  }

  private connectWs(): void {
    if (this.closed || !this.sessionId) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(collabWsUrl(this.sessionId, this.opts.publicShare));
    } catch {
      this.setTransport("poll");
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.closed) return;
      this.reconnectAttempt = 0;
      this.setTransport("ws");
      this.wsSend({ type: "sync", after_seq: this.latestSeq });
      this.wsSend({ type: "ping" });
      // Resubmit any pending that never went in-flight after reconnect
      for (const pending of this.pendingOps) {
        if (pending.inFlight) continue;
        pending.baseSeq = this.latestSeq;
        if (
          this.wsSend({
            type: "op",
            base_seq: pending.baseSeq,
            op_type: pending.opType,
            payload: pending.payload,
            client_op_id: pending.clientOpId,
          })
        ) {
          pending.inFlight = true;
        }
      }
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      this.setTransport("poll");
      this.reconnectAttempt += 1;
      const delay = Math.min(4000, 400 * this.reconnectAttempt);
      this.reconnectTimer = window.setTimeout(() => this.connectWs(), delay);
    };

    socket.onerror = () => {
      /* onclose handles fallback */
    };

    socket.onmessage = (event) => {
      try {
        this.handleServerMessage(JSON.parse(String(event.data)));
      } catch {
        /* ignore */
      }
    };
  }

  /** Package-private for unit tests. */
  handleServerMessage(data: {
    type?: string;
    op?: CollabOp;
    ops?: CollabOp[];
    session?: CollabSession;
    snapshot?: DomainSnapshot;
    client_op_id?: string;
    seq?: number;
    code?: string;
    message?: string;
    participants?: CollabParticipant[];
  }): void {
    if (data.type === "hello") return;

    if (data.type === "ack" && data.seq != null) {
      this.latestSeq = Math.max(this.latestSeq, data.seq);
      const wasMine =
        Boolean(data.client_op_id) &&
        this.pendingOps.some((p) => p.clientOpId === data.client_op_id);
      if (data.client_op_id) {
        this.pendingOps = this.pendingOps.filter((p) => p.clientOpId !== data.client_op_id);
      }
      if (data.op) {
        this.ingestOp(data.op, wasMine);
      }
      return;
    }

    if (data.type === "op" && data.op) {
      this.ingestOp(data.op, false);
      if (data.session) this.applySession(data.session);
      else if (data.snapshot) {
        this.snapshot = data.snapshot;
        this.opts.onSnapshot?.(data.snapshot);
      }
      return;
    }

    if (data.type === "ops" && Array.isArray(data.ops)) {
      for (const op of data.ops) this.ingestOp(op, false);
      if (data.session) this.applySession(data.session);
      else if (data.snapshot) {
        this.snapshot = data.snapshot;
        this.opts.onSnapshot?.(data.snapshot);
      }
      return;
    }

    if (data.type === "presence") {
      if (data.session) this.applySession(data.session);
      else if (data.participants) this.opts.onParticipants?.(data.participants);
      return;
    }

    if (data.type === "error") {
      if (data.client_op_id) {
        this.pendingOps = this.pendingOps.filter((p) => p.clientOpId !== data.client_op_id);
      }
      if (data.code === "text_mismatch") {
        this.requestSync();
        this.scheduleFormatCommitRetry();
        return;
      }
      if (data.code === "locked") {
        this.requestSync();
        // Soft signal — do not flip the presence strip to "offline".
        this.opts.onError?.(data.message ?? "Range locked", data.code);
        return;
      }
      // Human: Invalid ops (e.g. empty lock) must not look like co-editing went offline.
      if (
        data.code === "invalid_op" ||
        data.code === "client_message" ||
        /invalid op|lock range/i.test(data.message ?? "")
      ) {
        return;
      }
      if (data.message) this.opts.onError?.(data.message, data.code);
    }
  }

  private ingestOp(op: CollabOp, fromAck: boolean): void {
    if (typeof op.seq !== "number") return;
    if (op.seq <= this.latestSeq && !fromAck) return;

    const isLocal =
      Boolean(this.opts.localUserId && op.user_id === this.opts.localUserId) ||
      Boolean(op.client_op_id && this.pendingOps.some((p) => p.clientOpId === op.client_op_id));

    // Clear matching pending before rebase so we don't transform against our own op.
    if (op.client_op_id) {
      this.pendingOps = this.pendingOps.filter((p) => p.clientOpId !== op.client_op_id);
    }

    let delivery = op;
    if (!isLocal && !fromAck) {
      delivery = this.rebaseRemoteAgainstPending(op);
      this.rebasePendingThroughRemote(op);
    }

    this.latestSeq = Math.max(this.latestSeq, op.seq);
    this.opts.onOp?.(delivery, { isLocalEcho: isLocal || fromAck });
  }

  /**
   * Human: DOM already has optimistic pending replaces — transform remote so it applies after them.
   */
  private rebaseRemoteAgainstPending(op: CollabOp): CollabOp {
    if (op.op_type !== "replace") return op;
    let remote = parseReplacePayload(op.payload as Record<string, unknown>);
    if (!remote) return op;
    for (const pending of this.pendingOps) {
      if (pending.opType !== "replace") continue;
      const local = parseReplacePayload(pending.payload);
      if (!local) continue;
      remote = transformReplace(remote, local);
    }
    return {
      ...op,
      payload: replaceToPayload(remote),
    };
  }

  /**
   * Human: Keep unacked local payloads aligned with server-applied remote ops (re-send safety).
   */
  private rebasePendingThroughRemote(remoteOp: CollabOp): void {
    if (remoteOp.op_type !== "replace") return;
    const remote = parseReplacePayload(remoteOp.payload as Record<string, unknown>);
    if (!remote) return;
    for (const pending of this.pendingOps) {
      if (pending.opType !== "replace") continue;
      const local = parseReplacePayload(pending.payload);
      if (!local) continue;
      pending.payload = replaceToPayload(transformReplace(local, remote));
      // Not yet in-flight: raise base to remote seq so next send is correct.
      if (!pending.inFlight) {
        pending.baseSeq = Math.max(pending.baseSeq, remoteOp.seq);
      }
    }
  }

  private scheduleFormatCommitRetry(): void {
    if (this.formatRetryArmed || this.closed) return;
    this.formatRetryArmed = true;
    if (this.formatRetryTimer != null) window.clearTimeout(this.formatRetryTimer);
    this.formatRetryTimer = window.setTimeout(() => {
      this.formatRetryTimer = null;
      this.formatRetryArmed = false;
      if (this.closed) return;
      const payload = this.opts.getFormatCommitPayload?.();
      if (!payload) return;
      this.submitOp("format_commit", { html: payload.html, text: payload.text });
    }, 120);
  }

  private wsSend(payload: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private async postOpHttp(pending: PendingOp): Promise<void> {
    if (!this.sessionId) return;
    try {
      const share = this.opts.publicShare;
      const body = {
        base_seq: pending.baseSeq,
        op_type: pending.opType,
        payload: pending.payload,
        client_op_id: pending.clientOpId,
      };
      const op = share
        ? await postPublicCollabOp(share, this.sessionId, body)
        : await postCollabOp(this.sessionId, body);
      this.ingestOp(op, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/text diverged|text_mismatch|conflict/i.test(message) && pending.opType === "format_commit") {
        this.requestSync();
        this.scheduleFormatCommitRetry();
      }
      // Keep pending for reconnect resubmit when not inFlight recovery — mark for retry
      pending.inFlight = false;
    }
  }

  private async flushPresenceHttp(): Promise<void> {
    if (!this.sessionId || !this.pendingPresence) return;
    const body = this.pendingPresence;
    this.pendingPresence = null;
    try {
      const share = this.opts.publicShare;
      const session = share
        ? await heartbeatPublicCollabSession(share, this.sessionId, body)
        : await heartbeatCollabSession(this.sessionId, body);
      this.applySession(session);
    } catch {
      /* best-effort */
    }
  }

  private startPollFallback(): void {
    if (this.pollTimer != null || this.closed) return;
    this.pollTimer = window.setInterval(() => {
      void this.pollOpsOnce();
      void this.pollSessionOnce();
    }, 1000);
    void this.pollOpsOnce();
  }

  private stopPollFallback(): void {
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOpsOnce(): Promise<void> {
    if (!this.sessionId || this.closed) return;
    try {
      const share = this.opts.publicShare;
      const ops = share
        ? await listPublicCollabOps(share, this.sessionId, this.latestSeq)
        : await listCollabOps(this.sessionId, this.latestSeq);
      for (const op of ops) this.ingestOp(op, false);
    } catch {
      /* ignore */
    }
  }

  private async pollSessionOnce(): Promise<void> {
    if (!this.sessionId || this.closed) return;
    try {
      const share = this.opts.publicShare;
      const session = share
        ? await getPublicCollabSession(share, this.sessionId)
        : await getCollabSession(this.sessionId);
      this.applySession(session);
    } catch {
      /* ignore */
    }
  }
}
