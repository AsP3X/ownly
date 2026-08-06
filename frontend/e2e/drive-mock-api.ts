// Human: Shared API fixtures for the drive end-to-end specs — no backend required.
// Agent: MOCKS every /api/v1 route the drive shell touches on first paint; RECORDS mutating calls.

import { expect, type Page } from "@playwright/test";

const NOW = "2026-07-20T10:00:00Z";

export function file(id: string, name: string, mime: string, folderId: string | null) {
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

export function folder(id: string, name: string, parentId: string | null) {
  return { id, name, parent_id: parentId, created_at: NOW, updated_at: NOW };
}

export const ROOT_FOLDER = folder("work", "Work", null);
export const NESTED_FOLDER = folder("invoices", "Invoices", "work");
export const FILES = [
  file("a1", "Quarterly-Revenue-Model.xlsx", "application/vnd.ms-excel", "invoices"),
  file("a2", "Brand-Guidelines-v4.pdf", "application/pdf", null),
  file("a3", "Team-Offsite-Notes.txt", "text/plain", null),
];

/** Human: Root-first trails the palette asks for, keyed by the folder that was requested. */
export const FOLDER_PATHS: Record<string, { id: string; name: string }[]> = {
  work: [{ id: "work", name: "Work" }],
  invoices: [
    { id: "work", name: "Work" },
    { id: "invoices", name: "Invoices" },
  ],
};

/** Human: Mutating calls a spec wants to assert on after the UI reports success. */
export type DriveCallLog = {
  restored: string[][];
  renamed: { id: string; name: string }[];
  /** Human: Server-side stars, so favourites survive a nav change within one test. */
  favourites: Set<string>;
};

export function createCallLog(): DriveCallLog {
  return { restored: [], renamed: [], favourites: new Set() };
}

// Human: Install every API route the drive shell touches on first paint.
// Agent: ORDER matters — Playwright matches newest-first, so specific routes register last.
export async function mockDriveApi(page: Page, calls: DriveCallLog) {
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

  // Human: Single-file routes: DELETE recycles, PATCH renames, GET returns the row.
  // Agent: Registered BEFORE batch/deletion-preview — Playwright matches newest-first, and this
  //        regex would otherwise swallow those collection routes and hand back a {file} envelope.
  await page.route(/\/api\/v1\/files\/[^/?]+(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      route.fulfill({ json: { ok: true } });
      return;
    }
    if (request.method() === "PATCH") {
      const id = new URL(request.url()).pathname.split("/").pop() ?? "";
      const body = request.postDataJSON() as { name?: string };
      if (body.name !== undefined) calls.renamed.push({ id, name: body.name });
      const existing = FILES.find((entry) => entry.id === id) ?? FILES[0];
      route.fulfill({ json: { file: { ...existing, name: body.name ?? existing.name } } });
      return;
    }
    route.fulfill({ json: { file: FILES[0] } });
  });

  // Human: Batch resolve backs both Home recents and the Favourites view.
  await page.route("**/api/v1/files/batch", (route) => {
    const { ids } = route.request().postDataJSON() as { ids: string[] };
    const files = FILES.filter((entry) => ids.includes(entry.id));
    route.fulfill({ json: { files } });
  });

  // Human: Account-level stars — the set lives in the call log so a test can assert on it.
  await page.route("**/api/v1/favourites", (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      route.fulfill({ json: { file_ids: [...calls.favourites] } });
      return;
    }
    const { file_ids: ids } = request.postDataJSON() as { file_ids: string[] };
    for (const id of ids) {
      if (request.method() === "POST") calls.favourites.add(id);
      else calls.favourites.delete(id);
    }
    route.fulfill({ json: { file_ids: ids, changed: ids.length } });
  });
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

export async function openDrive(page: Page) {
  await page.goto("/?view=my-files");
  await expect(page.getByRole("button", { name: /Open folder Work/i })).toBeVisible({
    timeout: 20_000,
  });
}
