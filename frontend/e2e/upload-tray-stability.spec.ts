// Human: Guards the upload tray against height churn. The tray is anchored bottom-right, so every
// list resize moves its top edge — and rows leave the in-flight set constantly during a batch.
// Agent: DRIVES a real eight-file batch through UploadDialog with delayed upload + ingest mocks;
//        SAMPLES tray height while files are still queued and asserts it never gives space back.

import { test, expect, type Page } from "@playwright/test";

const NOW = "2026-07-30T10:00:00Z";
/** Human: Simulated time on the wire per file — two upload slots run at once. */
const UPLOAD_LATENCY_MS = 700;
/** Human: Simulated server-side conversion per file — two ingest slots run at once. */
const INGEST_MS = 1_800;
const FILE_COUNT = 8;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockDriveApi(page: Page) {
  await page.route("**/api/v1/setup/status", (route) =>
    route.fulfill({ json: { setup_complete: true } }),
  );
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
        used_bytes: 1_000,
        quota_bytes: 107_374_182_400,
      },
    }),
  );
  await page.route("**/api/v1/admin/maintenance/**", (route) =>
    route.fulfill({ json: { run: null } }),
  );
  // Human: No restored background jobs — this test starts its batch from the picker.
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/v1/folders*", (route) =>
    route.fulfill({ json: { folders: [], folder_count: 0, has_more: false } }),
  );
  await page.route("**/api/v1/files*", (route) =>
    route.fulfill({ json: { files: [], total_bytes: 0, file_count: 0, has_more: false } }),
  );

  // Human: Ingest polling — a file reports ready once it has been polled for INGEST_MS.
  // Agent: Registered before the POST routes below; Playwright matches newest route first.
  const ingestStartedAt = new Map<string, number>();
  await page.route(/\/api\/v1\/files\/[^/?]+$/, async (route) => {
    const fileId = new URL(route.request().url()).pathname.split("/").pop() ?? "unknown";
    const startedAt = ingestStartedAt.get(fileId) ?? Date.now();
    ingestStartedAt.set(fileId, startedAt);
    const elapsed = Date.now() - startedAt;
    const ready = elapsed >= INGEST_MS;
    await route.fulfill({
      json: {
        file: {
          id: fileId,
          name: `${fileId}.mp4`,
          mime_type: "video/mp4",
          size_bytes: 4_096,
          folder_id: null,
          created_at: NOW,
          updated_at: NOW,
          hls_ready: ready,
          hls_encode_status: ready ? "completed" : "running",
          conversion_progress: Math.min(99, Math.round((elapsed / INGEST_MS) * 100)),
        },
      },
    });
  });

  await page.route("**/api/v1/files/check-upload-names", (route) =>
    route.fulfill({ json: { duplicates: [], recycle_matches: [] } }),
  );

  let uploadedCount = 0;
  await page.route("**/api/v1/files/upload", async (route) => {
    uploadedCount += 1;
    const id = `file-${uploadedCount}`;
    // Human: Hold the response so byte upload occupies a slot long enough to overlap ingest.
    await sleep(UPLOAD_LATENCY_MS);
    await route.fulfill({
      json: {
        file: {
          id,
          name: `${id}.mp4`,
          mime_type: "video/mp4",
          size_bytes: 4_096,
          folder_id: null,
          created_at: NOW,
          updated_at: NOW,
          hls_ready: false,
          hls_encode_status: "running",
          conversion_progress: 0,
        },
      },
    });
  });
}

test("upload tray does not give height back while files are still queued", async ({ page }) => {
  await mockDriveApi(page);
  await page.goto("/?view=my-files");

  // Human: The toolbar and the empty-state both offer this button — either opens the same dialog.
  await page.getByRole("button", { name: "Upload Files" }).first().click();
  await page.setInputFiles(
    'input[type="file"]:not([webkitdirectory])',
    Array.from({ length: FILE_COUNT }, (_, index) => ({
      name: `clip-${index + 1}.mp4`,
      mimeType: "video/mp4",
      buffer: Buffer.alloc(4_096, index),
    })),
  );
  await page.getByRole("button", { name: `Upload (${FILE_COUNT})` }).click();

  const tray = page.getByRole("region", { name: "Uploads" });
  await expect(tray).toBeVisible({ timeout: 20_000 });

  await expect(tray.getByText(/waiting in queue/).first()).toBeVisible({ timeout: 20_000 });

  /**
   * Human: The header status line is driven straight off pipeline state, so it is the honest signal
   * for "files are still waiting" — the queue row itself lingers for a frame while it fades out.
   */
  const queuedCount = () =>
    page.evaluate(() => {
      const text =
        document.querySelector('[aria-label="Uploads"] p.tabular-nums')?.textContent ?? "";
      return Number(/(\d+)\s+queued/.exec(text)?.[1] ?? "0");
    });

  const trayHeight = async () => Math.round((await tray.boundingBox())?.height ?? 0);

  // Human: The tray grows as the first rows mount and the list animates up to its cap. That is
  // expected, so wait for the first hand-off and then for the height to hold still.
  await expect.poll(queuedCount, { timeout: 20_000 }).toBeLessThanOrEqual(FILE_COUNT - 4);
  let settled = -1;
  let stableTicks = 0;
  for (let tick = 0; tick < 40 && stableTicks < 3; tick += 1) {
    const height = await trayHeight();
    stableTicks = height === settled ? stableTicks + 1 : 0;
    settled = height;
    await page.waitForTimeout(100);
  }

  // Human: From here the batch is mid-flight with files still waiting — the window in which the tray
  // used to jump, once per hand-off between byte upload and server-side conversion.
  const heights: number[] = [settled];
  for (let tick = 0; tick < 160; tick += 1) {
    if ((await queuedCount()) === 0) break;
    heights.push(await trayHeight());
    await page.waitForTimeout(100);
  }

  expect(heights.length).toBeGreaterThan(10);

  const drops = heights
    .map((height, index) => (index === 0 ? 0 : height - heights[index - 1]!))
    .filter((delta) => delta < -1);
  const biggestStep = heights.reduce(
    (max, height, index) =>
      index === 0 ? max : Math.max(max, Math.abs(height - heights[index - 1]!)),
    0,
  );

  // Human: A row leaving is always about to be replaced, so the tray must hold its height.
  expect(drops).toEqual([]);
  // Human: Growth is animated, so no single frame may snap by a whole row.
  expect(biggestStep).toBeLessThan(48);
});
