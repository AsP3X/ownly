// Human: End-to-end cover for the ⌘K command palette and the undoable recycle toast.
// Agent: MOCKS every /api/v1 route the drive shell touches; NO backend required.

import { test, expect, type Page } from "@playwright/test";

const NOW = "2026-07-20T10:00:00Z";

function file(id: string, name: string, mime: string, folderId: string | null) {
  return {
    id,
    name,
    mime_type: mime,
    size_bytes: 12_345,
    folder_id: folderId,
    created_at: NOW,
    updated_at: NOW,
    hls_ready: true,
    hls_encode_status: null,
    conversion_progress: 100,
    image_thumbnail_ready: false,
    document_thumbnail_ready: false,
    video_thumbnail_ready: false,
  };
}

function folder(id: string, name: string, parentId: string | null) {
  return { id, name, parent_id: parentId, created_at: NOW, updated_at: NOW };
}

const ROOT_FOLDER = folder("work", "Work", null);
const NESTED_FOLDER = folder("invoices", "Invoices", "work");
const FILES = [
  file("a1", "Quarterly-Revenue-Model.xlsx", "application/vnd.ms-excel", "invoices"),
  file("a2", "Brand-Guidelines-v4.pdf", "application/pdf", null),
];

/** Human: Root-first trails the palette asks for, keyed by the folder that was requested. */
const FOLDER_PATHS: Record<string, { id: string; name: string }[]> = {
  work: [{ id: "work", name: "Work" }],
  invoices: [
    { id: "work", name: "Work" },
    { id: "invoices", name: "Invoices" },
  ],
};

// Human: Install every API route the drive shell touches on first paint.
// Agent: ORDER matters — Playwright matches newest-first, so specific routes register last.
async function mockDriveApi(page: Page, calls: { restored: string[][] }) {
  await page.route("**/api/v1/setup/status", (route) =>
    route.fulfill({ json: { setup_complete: true } }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ json: { csrf_token: "test-csrf", expires_in_seconds: 3600 } }),
  );
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ json: { id: "u1", email: "nik@ownly.test", role: "user", enabled: true } }),
  );
  await page.route("**/api/v1/me/permissions", (route) =>
    route.fulfill({ json: { permissions: [] } }),
  );
  await page.route("**/api/v1/dashboard", (route) =>
    route.fulfill({
      json: {
        instance_name: "Ownly",
        file_count: FILES.length,
        used_bytes: 1_000,
        quota_bytes: 100_000,
      },
    }),
  );
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/v1/recycle-bin", (route) =>
    route.fulfill({ json: { files: [], folders: [], total_count: 0 } }),
  );

  // Human: Folder listing doubles as folder search — `q` matches names the same way the API does.
  await page.route("**/api/v1/folders*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const all = [ROOT_FOLDER, NESTED_FOLDER];
    const folders = query
      ? all.filter((entry) => entry.name.toLowerCase().includes(query))
      : [ROOT_FOLDER];
    route.fulfill({ json: { folders, folder_count: folders.length, has_more: false } });
  });

  await page.route("**/api/v1/files*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const files = query
      ? FILES.filter((entry) => entry.name.toLowerCase().includes(query))
      : FILES;
    route.fulfill({
      json: { files, total_bytes: 1_000, file_count: files.length, has_more: false },
    });
  });

  // Human: Per-file sub-resources have no fixtures — they must 404 rather than hit the proxy.
  await page.route("**/api/v1/files/*/**", (route) => route.fulfill({ status: 404 }));

  // Human: Recycling one file goes straight to DELETE /files/:id (no job for a single soft delete).
  // Agent: Registered BEFORE batch/deletion-preview — Playwright matches newest-first, and this
  //        regex would otherwise swallow those collection routes and hand back a {file} envelope.
  await page.route(/\/api\/v1\/files\/[^/?]+(\?.*)?$/, (route) => {
    if (route.request().method() === "DELETE") {
      route.fulfill({ json: { ok: true } });
      return;
    }
    route.fulfill({ json: { file: FILES[0] } });
  });

  await page.route("**/api/v1/files/batch", (route) => route.fulfill({ json: { files: [] } }));
  await page.route("**/api/v1/files/deletion-preview", (route) =>
    route.fulfill({ json: { file_count: 1, storage_object_count: 1 } }),
  );

  await page.route("**/api/v1/folders/paths", (route) => {
    const ids = (route.request().postDataJSON() as { ids: string[] }).ids;
    const paths: Record<string, { id: string; name: string }[]> = {};
    for (const id of ids) {
      if (FOLDER_PATHS[id]) paths[id] = FOLDER_PATHS[id];
    }
    route.fulfill({ json: { paths } });
  });

  await page.route("**/api/v1/recycle-bin/restore", (route) => {
    const body = route.request().postDataJSON() as { file_ids: string[]; folder_ids: string[] };
    calls.restored.push(body.file_ids);
    route.fulfill({ json: { ok: true, restored_files: body.file_ids.length, restored_folders: 0 } });
  });
}

async function openDrive(page: Page) {
  await page.goto("/?view=my-files");
  await expect(page.getByRole("button", { name: /Open folder Work/i })).toBeVisible({
    timeout: 20_000,
  });
}

test("command palette finds a file, shows where it lives, and reveals its folder", async ({
  page,
}) => {
  const calls = { restored: [] as string[][] };
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("listbox", { name: "Search results and commands" });
  await expect(palette).toBeVisible();

  await page.getByRole("combobox").fill("revenue");

  // Human: The file hit must name the folder it lives in — the whole point of the location line.
  const fileRow = palette.getByRole("option", { name: /Quarterly-Revenue-Model\.xlsx/ });
  await expect(fileRow).toBeVisible({ timeout: 10_000 });
  await expect(fileRow).toContainText("My Cloud / Work / Invoices");

  // Human: Alt+Enter on the highlighted file reveals the folder it lives in.
  await page.getByRole("combobox").press("Alt+Enter");

  await expect(palette).toBeHidden();
  await expect(page.getByRole("button", { name: "Invoices", exact: true })).toBeVisible();
});

test("command palette runs a command without touching the mouse", async ({ page }) => {
  const calls = { restored: [] as string[][] };
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("trash");

  const command = page
    .getByRole("listbox", { name: "Search results and commands" })
    .getByRole("option", { name: /Go to Recycle bin/ });
  await expect(command).toBeVisible();
  await page.getByRole("combobox").press("Enter");

  await expect(page.getByRole("heading", { name: "Recycle bin" }).first()).toBeVisible();
});

test("recycling a file offers an Undo that restores it", async ({ page }) => {
  const calls = { restored: [] as string[][] };
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page
    .getByRole("checkbox", { name: "Select Brand-Guidelines-v4.pdf" })
    .check({ force: true });
  await page.getByRole("toolbar", { name: "Bulk file actions" }).getByRole("button", {
    name: /Delete/i,
  }).click();

  await page.getByRole("button", { name: "Recycle", exact: true }).click();

  const toast = page.getByText("“Brand-Guidelines-v4.pdf” moved to the recycle bin");
  await expect(toast).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Restored/)).toBeVisible({ timeout: 10_000 });
  expect(calls.restored).toEqual([["a2"]]);
});
