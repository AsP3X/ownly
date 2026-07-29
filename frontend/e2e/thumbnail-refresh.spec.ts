// Human: Regression cover for grid previews that appear only after a manual reload.
// Agent: SIMULATES the server flipping *_thumbnail_ready before the JPEG is servable; the tile
//        must recover on its own, because background polling stops as soon as that flag flips.

import { test, expect, type Page } from "@playwright/test";

const NOW = "2026-07-20T10:00:00Z";
const DONE_AT = "2026-07-20T10:05:00Z";

// Human: Smallest valid JPEG payload — content does not matter, only that decoding succeeds.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

// Human: One video row, before and after server-side transcode + poster generation.
function videoFile(ready: boolean) {
  return {
    id: "vid1",
    name: "clip.mp4",
    mime_type: "video/mp4",
    size_bytes: 1000,
    folder_id: null,
    created_at: NOW,
    updated_at: ready ? DONE_AT : NOW,
    hls_ready: ready,
    hls_encode_status: ready ? null : "running",
    conversion_progress: ready ? 100 : 40,
    video_thumbnail_ready: ready,
    video_thumbnail_status: ready ? "ready" : "running",
    video_thumbnail_selected_index: 0,
  };
}

async function mockShell(page: Page) {
  await page.route("**/api/v1/setup/status", (r) => r.fulfill({ json: { setup_complete: true } }));
  await page.route("**/api/v1/auth/refresh", (r) =>
    r.fulfill({ json: { csrf_token: "t", expires_in_seconds: 3600 } }),
  );
  await page.route("**/api/v1/me", (r) =>
    r.fulfill({ json: { id: "u1", email: "a@b.c", role: "member", enabled: true } }),
  );
  await page.route("**/api/v1/me/permissions", (r) => r.fulfill({ json: { permissions: [] } }));
  await page.route("**/api/v1/dashboard", (r) =>
    r.fulfill({ json: { instance_name: "Ownly", file_count: 1, used_bytes: 1, quota_bytes: 100 } }),
  );
  await page.route("**/api/v1/jobs", (r) => r.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/v1/folders*", (r) =>
    r.fulfill({ json: { folders: [], folder_count: 0, has_more: false } }),
  );
}

test("video poster appears without a reload when the JPEG lands after the ready flag", async ({
  page,
}) => {
  let ready = false;
  let blobServable = false;

  await mockShell(page);
  await page.route("**/api/v1/files*", (r) =>
    r.fulfill({
      json: { files: [videoFile(ready)], total_bytes: 1000, file_count: 1, has_more: false },
    }),
  );
  await page.route("**/api/v1/files/*/**", (r) => {
    if (!r.request().url().includes("thumbnail")) return r.fulfill({ status: 404 });
    // Human: The race this test exists for — flag says ready, object is not yet readable.
    if (!blobServable) return r.fulfill({ status: 404 });
    return r.fulfill({ status: 200, contentType: "image/jpeg", body: JPEG });
  });
  await page.route("**/api/v1/files/batch", (r) =>
    r.fulfill({ json: { files: [videoFile(ready)] } }),
  );

  await page.goto("/?view=my-files");
  await expect(page.getByText("clip.mp4")).toBeVisible({ timeout: 20_000 });

  // Server finishes transcoding and flags the poster ready — but storage lags behind.
  ready = true;
  await page.waitForTimeout(3000);
  blobServable = true;

  // Human: No reload, no scroll, no user action — the tile must recover by itself.
  await expect(page.locator('[data-file-id="vid1"] img')).toBeVisible({ timeout: 30_000 });
});

test("video poster still appears when the JPEG is servable immediately", async ({ page }) => {
  let ready = false;

  await mockShell(page);
  await page.route("**/api/v1/files*", (r) =>
    r.fulfill({
      json: { files: [videoFile(ready)], total_bytes: 1000, file_count: 1, has_more: false },
    }),
  );
  await page.route("**/api/v1/files/*/**", (r) => {
    if (!r.request().url().includes("thumbnail")) return r.fulfill({ status: 404 });
    if (!ready) return r.fulfill({ status: 404 });
    return r.fulfill({ status: 200, contentType: "image/jpeg", body: JPEG });
  });
  await page.route("**/api/v1/files/batch", (r) =>
    r.fulfill({ json: { files: [videoFile(ready)] } }),
  );

  await page.goto("/?view=my-files");
  await expect(page.getByText("clip.mp4")).toBeVisible({ timeout: 20_000 });

  ready = true;

  await expect(page.locator('[data-file-id="vid1"] img')).toBeVisible({ timeout: 30_000 });
});
