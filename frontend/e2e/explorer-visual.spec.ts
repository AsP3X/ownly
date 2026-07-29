// Human: Visual harness for the reworked filebrowser — mocks the drive API and captures both
// layouts in both themes. Temporary verification aid for the UI rework, not a CI assertion suite.
// Agent: ROUTES /api/v1/* to fixtures; SEEDS localStorage theme + view mode; WRITES screenshots.

import { test, expect, type Page } from "@playwright/test";

const NOW = "2026-07-20T10:00:00Z";

function file(
  id: string,
  name: string,
  mime: string | null,
  sizeBytes: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    mime_type: mime,
    size_bytes: sizeBytes,
    folder_id: null,
    created_at: NOW,
    updated_at: NOW,
    hls_ready: true,
    hls_encode_status: null,
    conversion_progress: 100,
    image_thumbnail_ready: false,
    document_thumbnail_ready: false,
    video_thumbnail_ready: false,
    ...overrides,
  };
}

function folder(id: string, name: string) {
  return { id, name, parent_id: null, created_at: NOW, updated_at: NOW };
}

const FOLDERS = [
  folder("f1", "Client Contracts"),
  folder("f2", "Design Assets"),
  folder("f3", "Q3 Reporting"),
];

const FILES = [
  file("a1", "Quarterly-Revenue-Model.xlsx", "application/vnd.ms-excel", 2_411_724),
  file("a2", "Brand-Guidelines-v4.pdf", "application/pdf", 8_930_112),
  file("a3", "onboarding-walkthrough.mp4", "video/mp4", 184_233_984),
  file("a4", "architecture-notes.md", "text/markdown", 14_204),
  file("a5", "hero-banner.png", "image/png", 3_204_112),
  file("a6", "investor-update.docx", "application/msword", 88_421),
  file("a7", "field-recording.wav", "audio/wav", 41_882_112),
  file("a8", "deployment-runbook.txt", "text/plain", 6_113),
  file("a9", "site-archive.zip", "application/zip", 512_884_224),
  file("a10", "transcode-in-progress.mov", "video/quicktime", 92_113_408, {
    hls_ready: false,
    hls_encode_status: "processing",
    conversion_progress: 42,
  }),
];

// Human: Install every API route the drive shell touches on first paint.
// Agent: FULFILLS /me, /me/permissions, /dashboard, /folders, /files; 404s everything else.
async function mockDriveApi(page: Page) {
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
    route.fulfill({
      json: { id: "u1", email: "nik@ownly.test", role: "admin", enabled: true },
    }),
  );
  await page.route("**/api/v1/me/permissions", (route) =>
    route.fulfill({ json: { permissions: ["admin"] } }),
  );
  await page.route("**/api/v1/dashboard", (route) =>
    route.fulfill({
      json: {
        instance_name: "Ownly",
        file_count: FILES.length,
        used_bytes: 41_284_112_384,
        quota_bytes: 107_374_182_400,
      },
    }),
  );
  // Human: Admin sessions mount StorageMigrationUi, which polls this maintenance endpoint. An
  // unmocked 401 here cascades into /auth/refresh and clears the session, dropping the app to
  // the landing page — the mocked user is an admin, so this route is mandatory.
  await page.route("**/api/v1/admin/maintenance/**", (route) =>
    route.fulfill({ json: { run: null } }),
  );
  // Human: The transfer tray probes GET /jobs on mount to recover interrupted uploads. Left
  // unmocked it 401s against the dev proxy, which tears down the session and drops the app back
  // to the landing page — so this route is required even though the test is about the explorer.
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/v1/folders*", (route) =>
    route.fulfill({
      json: { folders: FOLDERS, folder_count: FOLDERS.length, has_more: false },
    }),
  );
  await page.route("**/api/v1/files*", (route) =>
    route.fulfill({
      json: {
        files: FILES,
        total_bytes: 41_284_112_384,
        file_count: FILES.length,
        has_more: false,
      },
    }),
  );
  // Human: Per-file sub-resources (preview-url, download, thumbnails) have no fixtures. They must
  // answer 404, not fall through to the dev proxy — an unmocked 401 there cascades into
  // /auth/refresh, clears the session, and drops the whole app back to the landing page.
  // Agent: Scoped to /files/<id>/<sub> so it cannot swallow POST /files/batch, whose callers
  //        read `.files.length` and crash the route when handed a 404 body.
  await page.route("**/api/v1/files/*/**", (route) => route.fulfill({ status: 404 }));
  // Human: The processing fixture (transcode-in-progress.mov) makes the drive poll GET /files/:id.
  // Agent: RETURNS a single-file envelope that stays mid-conversion for the life of the test.
  await page.route(/\/api\/v1\/files\/[^/?]+$/, (route) =>
    route.fulfill({
      json: {
        file: {
          ...FILES[9],
          hls_ready: false,
          hls_encode_status: "processing",
          conversion_progress: 42,
        },
      },
    }),
  );
  // Human: Home recent/favourites and the processing-row poller both use POST /files/batch.
  // Registered LAST so it beats the single-file regex above, which otherwise matches
  // ".../files/batch" and hands back a {file} envelope — leaving `files` undefined and
  // crashing patchExplorerFileRows, which takes the whole drive route down.
  // Agent: Playwright matches routes newest-first; order here is load-bearing.
  await page.route("**/api/v1/files/batch", (route) => route.fulfill({ json: { files: [] } }));
}

async function seedPreferences(page: Page, theme: string, viewMode: string) {
  await page.addInitScript(
    ([nextTheme, nextViewMode]) => {
      localStorage.setItem("ownly_theme", nextTheme);
      localStorage.setItem("ownly_explorer_view_mode", nextViewMode);
    },
    [theme, viewMode],
  );
}

for (const theme of ["light", "dark"]) {
  for (const viewMode of ["grid", "list"]) {
    test(`explorer renders — ${theme} / ${viewMode}`, async ({ page }) => {
      await seedPreferences(page, theme, viewMode);
      await mockDriveApi(page);

      await page.goto("/?view=my-files");
      // Human: Wait for real content, not a spinner, before capturing.
      await expect(page.getByRole("button", { name: /Open folder Design Assets/i })).toBeVisible({
        timeout: 20_000,
      });

      // Human: The status strip is the headline addition — assert it is actually present.
      const status = page.getByRole("status", { name: "Explorer status" });
      await expect(status.getByText(/folders/)).toBeVisible();

      // Human: The status strip must sit flush with the viewport floor — any gap means file
      // rows scroll visibly beneath it, which reads as a rendering bug.
      // Agent: ASSERTS the strip's bottom edge is within 2px of the viewport bottom.
      const strip = page.getByRole("status", { name: "Explorer status" });
      const box = await strip.boundingBox();
      const viewport = page.viewportSize();
      expect(box).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(Math.abs(box!.y + box!.height - viewport!.height)).toBeLessThanOrEqual(2);

      await page.screenshot({
        path: `test-results/explorer-${theme}-${viewMode}.png`,
        fullPage: false,
      });
    });
  }
}

test("selection surfaces the bulk bar and status count", async ({ page }) => {
  await seedPreferences(page, "light", "grid");
  await mockDriveApi(page);
  await page.goto("/?view=my-files");

  await expect(page.getByRole("button", { name: /Open folder Design Assets/i })).toBeVisible({
    timeout: 20_000,
  });

  // Human: Target the checkbox role explicitly — once a selection exists, card-select mode gives
  // the tile button the same "Select <name>" label, which is intended behaviour.
  await page.getByRole("checkbox", { name: "Select Brand-Guidelines-v4.pdf" }).check({ force: true });
  await page.getByRole("checkbox", { name: "Select hero-banner.png" }).check({ force: true });

  await expect(page.getByRole("toolbar", { name: "Bulk file actions" })).toBeVisible();

  // Human: Both picked tiles must actually report checked state, not just tint their filename.
  // Agent: ASSERTS the checkbox inputs, which is what screen readers and form state read.
  await expect(
    page.getByRole("checkbox", { name: "Select Brand-Guidelines-v4.pdf" }),
  ).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select hero-banner.png" })).toBeChecked();
  await expect(page.getByRole("status", { name: "Explorer status" }).getByText("2")).toBeVisible();

  await page.screenshot({ path: "test-results/explorer-selection.png" });
});
