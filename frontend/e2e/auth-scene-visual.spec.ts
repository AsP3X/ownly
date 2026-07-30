// Human: Visual harness for the auth backdrop — captures the laptop and server at several
// points in the loop so misalignment between a panel and its contents is easy to spot.
// Agent: MOCKS only setup/status; /login and /register are public routes.

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

for (const theme of ["light", "dark"]) {
  test(`auth scene renders across the loop — ${theme}`, async ({ page }) => {
    await page.addInitScript((next) => localStorage.setItem("ownly_theme", next), theme);
    await mockShell(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/login");
    // Human: The canvas only mounts at md and up; wait for it before capturing.
    const canvas = page.locator("canvas");
    await expect(canvas.first()).toBeVisible({ timeout: 20_000 });

    // Human: Sample the loop at intervals — the camera cuts between the laptop and the server,
    // so a single frame would not show whether the two objects hold together under yaw.
    for (let shot = 0; shot < 4; shot += 1) {
      await page.waitForTimeout(3200);
      await page.screenshot({ path: `test-results/auth-scene-${theme}-${shot}.png` });
    }
  });
}

test("auth scene still frame under reduced motion", async ({ page }) => {
  await mockShell(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/login");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/auth-scene-still.png" });
});
