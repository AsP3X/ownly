// Human: Visual harness for the upload tray — restores a live batch from active background jobs.
// Agent: MOCKS GET /jobs so restoreFromActiveBackgroundJobs() rebuilds real "processing" rows.
//        The localStorage path is deliberately NOT used: it marks reloaded rows as interrupted.

import { test, expect, type Page } from "@playwright/test";

const NOW = "2026-07-29T20:00:00Z";

function encodeJob(id: string, label: string, progress: number, status = "running") {
  return {
    id,
    kind: "hls_encode",
    status,
    progress,
    label,
    error: null,
    resource_type: "file",
    resource_id: `file-${id}`,
    created_at: NOW,
    updated_at: NOW,
  };
}

async function mockDriveApi(page: Page, jobs: ReturnType<typeof encodeJob>[]) {
  // Human: Kill entrance animations so a capture taken immediately is crisp, not a mid-fade ghost.
  // Agent: The tray is short-lived under mocks, so waiting for the animation is not an option.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  });
  await page.route("**/api/v1/setup/status", (route) =>
    route.fulfill({ json: { setup_complete: true } }),
  );
  // Human: AuthContext bootstraps CSRF via POST /auth/refresh whenever no CSRF cookie exists,
  // which is always the case under mocks. An unmocked 401 there tears the session down and the
  // app falls back to the landing page — every drive test needs this route.
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ json: { csrf_token: "test-csrf", expires_in_seconds: 3600 } }),
  );
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ json: { id: "u1", email: "nik@ownly.test", role: "admin", enabled: true } }),
  );
  await page.route("**/api/v1/me/permissions", (route) =>
    route.fulfill({ json: { permissions: ["admin"] } }),
  );
  await page.route("**/api/v1/dashboard", (route) =>
    route.fulfill({
      json: {
        instance_name: "Ownly",
        file_count: 0,
        used_bytes: 41_284_112_384,
        quota_bytes: 107_374_182_400,
      },
    }),
  );
  // Human: Admin sessions poll this maintenance endpoint; an unmocked 401 cascades into
  // /auth/refresh and tears down the session before the tray can be captured.
  await page.route("**/api/v1/admin/maintenance/**", (route) =>
    route.fulfill({ json: { run: null } }),
  );
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs } }));
  await page.route("**/api/v1/folders*", (route) =>
    route.fulfill({ json: { folders: [], folder_count: 0, has_more: false } }),
  );
  await page.route("**/api/v1/files*", (route) =>
    route.fulfill({ json: { files: [], total_bytes: 0, file_count: 0, has_more: false } }),
  );
  // Human: The tray polls GET /files/:id to follow server-side conversion. Registered last so it
  // wins over the list route above (Playwright matches routes newest-first); returning a list
  // shape here made items error out and the whole tray vanish mid-test.
  // Agent: hls_ready false keeps the row in its processing phase for the duration of the capture.
  await page.route(/\/api\/v1\/files\/[^/?]+$/, (route) =>
    route.fulfill({
      json: {
        file: {
          id: "file-a",
          name: "clip.mp4",
          mime_type: "video/mp4",
          size_bytes: 443_547_648,
          folder_id: null,
          created_at: NOW,
          updated_at: NOW,
          hls_ready: false,
          hls_encode_status: "running",
          conversion_progress: 48,
        },
      },
    }),
  );
}

const MANY_JOBS = [
  encodeJob("a", "Footsie Babes - das Latina-Schätzchen 4K.mp4", 48),
  encodeJob("b", "Ganzes Video - Mein Stiefbruder ist zu spät.mp4", 50),
  encodeJob("c", "Bratty Stiefschwester Compilation.mp4", 12),
  encodeJob("d", "Spyfam Stiefschwester Teil 2.mp4", 0, "queued"),
];

for (const theme of ["light", "dark"]) {
  test(`upload tray renders — ${theme}`, async ({ page }) => {
    await page.addInitScript((next) => localStorage.setItem("ownly_theme", next), theme);
    await mockDriveApi(page, MANY_JOBS);

    await page.goto("/?view=my-files");

    const tray = page.getByRole("region", { name: "Uploads" });
    await expect(tray).toBeVisible({ timeout: 20_000 });
    // Human: The tray keeps its live and completed sections both mounted so they can animate
    // open/closed, so match the first occurrence rather than asserting a unique node.
    // Human: The tray keeps its live and completed sections both mounted so they can animate
    // open/closed, so match the first occurrence rather than asserting a unique node.
    await expect(tray.getByText(/Footsie Babes/).first()).toBeVisible();
  
    // Human: Four live rows must not push the tray past a sane height, and — more importantly —
    // the tray must not reserve blank space beyond its content.
    const box = await tray.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(520);

    await page.screenshot({ path: `test-results/upload-tray-${theme}.png` });
  });
}

test("upload tray hugs its content with a single active file", async ({ page }) => {
  await mockDriveApi(page, [encodeJob("solo", "single-clip.mp4", 62)]);

  await page.goto("/?view=my-files");
  const tray = page.getByRole("region", { name: "Uploads" });
  await expect(tray).toBeVisible({ timeout: 20_000 });

  // Human: This is the regression the rework targets. One active file previously rendered a tall
  // panel that was mostly empty, because the file list height was pinned at 17.5rem.
  // Agent: Header + hero + one row should land well under 260px.
  const box = await tray.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeLessThan(260);

  await page.screenshot({ path: "test-results/upload-tray-single.png" });
});
