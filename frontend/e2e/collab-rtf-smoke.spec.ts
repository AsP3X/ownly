// Human: Collab smoke — open RTF editor, WS presence, local typing op, remote replace apply.
// Agent: MOCKS drive + collab HTTP/WS; DUAL browser contexts share one in-memory session.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const NOW = "2026-07-30T12:00:00Z";
const FILE_ID = "rtf-collab-1";
const SESSION_ID = "sess-collab-smoke";

/** Minimal RTF accepted by the in-app converter. */
const SEED_RTF =
  "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 Hello collab\\par}";

type Participant = {
  user_id: string;
  display_name: string;
  color: string;
  last_seen: number;
  selection_start?: number | null;
  selection_end?: number | null;
  lock_start?: number | null;
  lock_end?: number | null;
};

type CollabOp = {
  id: string;
  seq: number;
  user_id: string;
  ts: number;
  base_seq: number;
  op_type: string;
  payload: Record<string, unknown>;
  client_op_id?: string;
};

type SharedCollabState = {
  nextSeq: number;
  text: string;
  html: string;
  participants: Map<string, Participant>;
  ops: CollabOp[];
  sockets: Set<{
    userId: string;
    send: (data: string) => void;
  }>;
  receivedClientOps: CollabOp[];
};

function createSharedState(): SharedCollabState {
  return {
    nextSeq: 1,
    text: "Hello collab",
    html: "<p>Hello collab</p>",
    participants: new Map(),
    ops: [],
    sockets: new Set(),
    receivedClientOps: [],
  };
}

function sessionView(state: SharedCollabState) {
  return {
    id: SESSION_ID,
    room_kind: "document",
    file_id: FILE_ID,
    participants: Array.from(state.participants.values()),
    latest_seq: state.nextSeq - 1,
    snapshot: {
      snapshot_seq: 0,
      data: { text: state.text, html: state.html },
    },
    document_text: state.text,
    document_html: state.html,
  };
}

function applyReplace(text: string, index: number, del: number, insert: string): string {
  const chars = [...text];
  const i = Math.min(index, chars.length);
  const end = Math.min(i + del, chars.length);
  return chars.slice(0, i).join("") + insert + chars.slice(end).join("");
}

function broadcast(state: SharedCollabState, message: unknown, exceptUserId?: string) {
  const raw = JSON.stringify(message);
  for (const socket of state.sockets) {
    if (exceptUserId && socket.userId === exceptUserId) continue;
    try {
      socket.send(raw);
    } catch {
      /* closed */
    }
  }
}

async function mockDriveAndCollab(
  page: Page,
  state: SharedCollabState,
  user: { id: string; email: string; name: string; color: string },
) {
  await page.route("**/api/v1/setup/status", (route) =>
    route.fulfill({ json: { setup_complete: true } }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ json: { csrf_token: "test-csrf", expires_in_seconds: 3600 } }),
  );
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: { id: user.id, email: user.email, role: "admin", enabled: true },
    }),
  );
  await page.route("**/api/v1/me/permissions", (route) =>
    route.fulfill({ json: { permissions: ["admin"] } }),
  );
  await page.route("**/api/v1/dashboard", (route) =>
    route.fulfill({
      json: {
        instance_name: "Ownly",
        file_count: 1,
        used_bytes: 1024,
        quota_bytes: 107_374_182_400,
      },
    }),
  );
  await page.route("**/api/v1/admin/maintenance/**", (route) =>
    route.fulfill({ json: { run: null } }),
  );
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/v1/folders*", (route) =>
    route.fulfill({ json: { folders: [], folder_count: 0, has_more: false } }),
  );

  const rtfFile = {
    id: FILE_ID,
    name: "collab-notes.rtf",
    mime_type: "application/rtf",
    size_bytes: SEED_RTF.length,
    folder_id: null,
    created_at: NOW,
    updated_at: NOW,
    hls_ready: false,
    hls_encode_status: null,
    conversion_progress: 0,
    image_thumbnail_ready: false,
    document_thumbnail_ready: false,
    video_thumbnail_ready: false,
  };

  await page.route("**/api/v1/files/batch", (route) =>
    route.fulfill({ json: { files: [rtfFile] } }),
  );
  await page.route("**/api/v1/files*", (route) => {
    const url = route.request().url();
    if (url.includes("/download")) {
      return route.fulfill({
        status: 200,
        contentType: "application/rtf",
        body: SEED_RTF,
      });
    }
    if (url.includes("/files/") && !url.includes("?")) {
      return route.fulfill({ json: { file: rtfFile } });
    }
    return route.fulfill({
      json: {
        files: [rtfFile],
        total_bytes: SEED_RTF.length,
        file_count: 1,
        has_more: false,
      },
    });
  });
  await page.route("**/api/v1/files/*/**", async (route) => {
    if (route.request().url().includes("/download")) {
      await route.fulfill({
        status: 200,
        contentType: "application/rtf",
        body: SEED_RTF,
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  // Collab HTTP
  await page.route("**/api/v1/collab/sessions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    state.participants.set(user.id, {
      user_id: user.id,
      display_name: user.name,
      color: user.color,
      last_seen: Date.now(),
    });
    await route.fulfill({ json: sessionView(state) });
    broadcast(state, { type: "presence", session: sessionView(state) });
  });

  await page.route(`**/api/v1/collab/sessions/${SESSION_ID}`, async (route) => {
    await route.fulfill({ json: sessionView(state) });
  });

  await page.route(`**/api/v1/collab/sessions/${SESSION_ID}/heartbeat`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const existing = state.participants.get(user.id) ?? {
      user_id: user.id,
      display_name: user.name,
      color: user.color,
      last_seen: Date.now(),
    };
    const next: Participant = {
      ...existing,
      last_seen: Date.now(),
      selection_start:
        (body.selection_start as number | undefined) ?? existing.selection_start ?? null,
      selection_end:
        (body.selection_end as number | undefined) ?? existing.selection_end ?? null,
      lock_start: body.clear_lock
        ? null
        : ((body.lock_start as number | undefined) ?? existing.lock_start ?? null),
      lock_end: body.clear_lock
        ? null
        : ((body.lock_end as number | undefined) ?? existing.lock_end ?? null),
    };
    if (body.presence && typeof body.presence === "object") {
      Object.assign(next, body.presence);
    }
    state.participants.set(user.id, next);
    const view = sessionView(state);
    await route.fulfill({ json: view });
    broadcast(state, { type: "presence", session: view });
  });

  await page.route(`**/api/v1/collab/sessions/${SESSION_ID}/ops**`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      const url = new URL(route.request().url());
      const after = Number(url.searchParams.get("after_seq") ?? "0");
      await route.fulfill({
        json: state.ops.filter((op) => op.seq > after),
      });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as {
        base_seq: number;
        op_type: string;
        payload: Record<string, unknown>;
        client_op_id?: string;
      };
      const op = appendOp(state, user.id, body);
      await route.fulfill({ json: op });
      return;
    }
    await route.fulfill({ status: 405 });
  });

  // WebSocket mock with fan-out
  await page.routeWebSocket(`**/collab/sessions/${SESSION_ID}/ws**`, (ws) => {
    const entry = {
      userId: user.id,
      send: (data: string) => ws.send(data),
    };
    state.sockets.add(entry);

    ws.send(
      JSON.stringify({
        type: "hello",
        session_id: SESSION_ID,
        user_id: user.id,
        protocol: 1,
      }),
    );

    ws.onMessage((message) => {
      const text = typeof message === "string" ? message : message.toString();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === "ping") return;
      if (msg.type === "sync") {
        const after = Number(msg.after_seq ?? 0);
        ws.send(
          JSON.stringify({
            type: "ops",
            ops: state.ops.filter((op) => op.seq > after),
            session: sessionView(state),
            snapshot: sessionView(state).snapshot,
          }),
        );
        return;
      }
      if (msg.type === "heartbeat" || msg.type === "presence") {
        const existing = state.participants.get(user.id);
        if (existing) {
          const presence = (msg.presence ?? msg) as Record<string, unknown>;
          state.participants.set(user.id, {
            ...existing,
            last_seen: Date.now(),
            selection_start:
              (presence.selection_start as number | undefined) ??
              existing.selection_start ??
              null,
            selection_end:
              (presence.selection_end as number | undefined) ??
              existing.selection_end ??
              null,
          });
          broadcast(state, { type: "presence", session: sessionView(state) });
        }
        return;
      }
      if (msg.type === "op") {
        const op = appendOp(state, user.id, {
          base_seq: Number(msg.base_seq ?? 0),
          op_type: String(msg.op_type ?? ""),
          payload: (msg.payload ?? {}) as Record<string, unknown>,
          client_op_id: msg.client_op_id as string | undefined,
        });
        // Fan-out includes origin (client treats local echo via client_op_id / user_id)
        broadcast(state, {
          type: "op",
          op,
          session: sessionView(state),
          snapshot: sessionView(state).snapshot,
        });
      }
    });

    ws.onClose(() => {
      state.sockets.delete(entry);
      // Leave participant for a bit so the other side still sees them during the test.
    });
  });
}

function appendOp(
  state: SharedCollabState,
  userId: string,
  body: {
    base_seq: number;
    op_type: string;
    payload: Record<string, unknown>;
    client_op_id?: string;
  },
): CollabOp {
  const op: CollabOp = {
    id: `op-${state.nextSeq}`,
    seq: state.nextSeq,
    user_id: userId,
    ts: Math.floor(Date.now() / 1000),
    base_seq: body.base_seq,
    op_type: body.op_type,
    payload: body.payload,
    client_op_id: body.client_op_id,
  };
  state.nextSeq += 1;
  state.ops.push(op);
  state.receivedClientOps.push(op);

  if (body.op_type === "replace") {
    const index = Number(body.payload.index ?? 0);
    const del = Number(body.payload.delete ?? 0);
    const insert = String(body.payload.insert ?? "");
    state.text = applyReplace(state.text, index, del, insert);
  } else if (body.op_type === "format_commit") {
    if (typeof body.payload.html === "string") state.html = body.payload.html;
    if (typeof body.payload.text === "string") state.text = body.payload.text;
  } else if (body.op_type === "lock") {
    const p = state.participants.get(userId);
    if (p) {
      p.lock_start = Number(body.payload.start ?? 0);
      p.lock_end = Number(body.payload.end ?? 0);
    }
  } else if (body.op_type === "unlock") {
    const p = state.participants.get(userId);
    if (p) {
      p.lock_start = null;
      p.lock_end = null;
    }
  }
  return op;
}

async function seedListView(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ownly_theme", "light");
    localStorage.setItem("ownly_explorer_view_mode", "list");
  });
}

async function openRtfEditor(page: Page) {
  await page.goto("/?view=my-files");
  await expect(page.getByRole("button", { name: /Preview collab-notes\.rtf/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /Preview collab-notes\.rtf/i }).click();
  await expect(page.getByRole("textbox", { name: "Rich text document" })).toBeVisible({
    timeout: 20_000,
  });
}

async function setupUser(
  context: BrowserContext,
  state: SharedCollabState,
  user: { id: string; email: string; name: string; color: string },
): Promise<Page> {
  const page = await context.newPage();
  await seedListView(page);
  await mockDriveAndCollab(page, state, user);
  return page;
}

test.describe("RTF collab smoke", () => {
  test("single editor: WS live, typing publishes replace, remote op applies", async ({
    page,
  }) => {
    const state = createSharedState();
    await seedListView(page);
    await mockDriveAndCollab(page, state, {
      id: "u-alice",
      email: "alice@ownly.test",
      name: "Alice",
      color: "#2563EB",
    });

    await openRtfEditor(page);

    // Presence strip shows Live + WS after join
    await expect(page.getByLabel("Collaborators")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Collaborators")).toContainText(/Live/);

    const editor = page.getByRole("textbox", { name: "Rich text document" });
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");

    await expect
      .poll(() => state.receivedClientOps.some((op) => op.op_type === "replace"), {
        timeout: 10_000,
      })
      .toBe(true);

    // Inject a remote concurrent insert at the start
    const remoteOp: CollabOp = {
      id: "remote-1",
      seq: state.nextSeq++,
      user_id: "u-bob",
      ts: Math.floor(Date.now() / 1000),
      base_seq: 0,
      op_type: "replace",
      payload: { index: 0, delete: 0, insert: ">>" },
    };
    state.ops.push(remoteOp);
    state.text = applyReplace(state.text, 0, 0, ">>");
    state.participants.set("u-bob", {
      user_id: "u-bob",
      display_name: "Bob",
      color: "#DC2626",
      last_seen: Date.now(),
      selection_start: 0,
      selection_end: 0,
    });
    broadcast(state, {
      type: "op",
      op: remoteOp,
      session: sessionView(state),
      snapshot: sessionView(state).snapshot,
    });
    broadcast(state, { type: "presence", session: sessionView(state) });

    await expect(editor).toContainText(">>", { timeout: 10_000 });
    await expect(page.getByLabel("Collaborators")).toContainText(/Bob/);
  });

  test("dual clients: shared presence and fan-out apply on both editors", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const state = createSharedState();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await setupUser(ctxA, state, {
      id: "u-alice",
      email: "alice@ownly.test",
      name: "Alice",
      color: "#2563EB",
    });
    const pageB = await setupUser(ctxB, state, {
      id: "u-bob",
      email: "bob@ownly.test",
      name: "Bob",
      color: "#DC2626",
    });

    await openRtfEditor(pageA);
    await expect(pageA.getByLabel("Collaborators")).toBeVisible({ timeout: 15_000 });

    await openRtfEditor(pageB);
    await expect(pageB.getByLabel("Collaborators")).toBeVisible({ timeout: 15_000 });

    // Human: Each peer should learn about the other via presence join broadcasts.
    await expect
      .poll(() => state.participants.has("u-alice") && state.participants.has("u-bob"), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(pageA.getByLabel("Collaborators")).toContainText(/Bob/, { timeout: 10_000 });
    await expect(pageB.getByLabel("Collaborators")).toContainText(/Alice/, { timeout: 10_000 });

    // Human: Fan-out a third-party replace so both clients apply it as remote (no keyboard deadlock).
    const remoteOp = appendOp(state, "u-charlie", {
      base_seq: state.nextSeq - 1,
      op_type: "replace",
      payload: { index: 0, delete: 0, insert: ">>" },
    });
    state.participants.set("u-charlie", {
      user_id: "u-charlie",
      display_name: "Charlie",
      color: "#059669",
      last_seen: Date.now(),
    });
    broadcast(state, {
      type: "op",
      op: remoteOp,
      session: sessionView(state),
      snapshot: sessionView(state).snapshot,
    });
    broadcast(state, { type: "presence", session: sessionView(state) });

    const editorA = pageA.getByRole("textbox", { name: "Rich text document" });
    const editorB = pageB.getByRole("textbox", { name: "Rich text document" });
    await expect(editorA).toContainText(">>", { timeout: 15_000 });
    await expect(editorB).toContainText(">>", { timeout: 15_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
