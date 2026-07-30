// Human: Storyboard for the server interior sequence — samples dock, ingest and seal.
// Agent: Drives the clock with prefers-reduced-motion off; captures at act boundaries by waiting.

import { test, expect, type Page } from "@playwright/test";

async function mockShell(page: Page) {
  await page.route("**/api/v1/setup/status", (route) =>
    route.fulfill({ json: { setup_complete: true } }),
  );
  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 401, json: {} }));
  await page.route("**/api/v1/me/permissions", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
}

/*
 * Human: Act start times, derived from STORY_ACTS: capture 0, transit 6, dock 13.5, ingest 16.5,
 * seal 23.5, retrieve 27, display 34, loop 39.
 * Agent: Sampled a little past each start so the camera has settled into the act.
 */
const SAMPLES: { name: string; at: number }[] = [
  { name: "dock", at: 15.0 },
  { name: "ingest-encrypt", at: 18.5 },
  { name: "ingest-shard", at: 20.5 },
  { name: "ingest-verify", at: 22.4 },
  { name: "seal", at: 24.8 },
];

for (const theme of ["light", "dark"]) {
  test(`server interior sequence — ${theme}`, async ({ page }) => {
    await page.addInitScript((next) => localStorage.setItem("ownly_theme", next), theme);
    await mockShell(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/login");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    const started = Date.now();
    for (const sample of SAMPLES) {
      const elapsed = (Date.now() - started) / 1000;
      const wait = Math.max(0, sample.at - elapsed) * 1000;
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: `test-results/interior-${theme}-${sample.name}.png` });
    }
  });
}

test("reduced-motion still lands inside the server", async ({ page }) => {
  await mockShell(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/login");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/interior-still.png" });
});
