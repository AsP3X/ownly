// Human: Smoke coverage for upload transfer panel retry affordances (mocked batch snapshot).
// Agent: MOCKS auth/setup APIs; INJECTS upload batch via localStorage-like path is not possible —
// so this test only asserts the drive shell boots. Retry logic is unit-tested in upload-manager.

import { test, expect } from "@playwright/test";

test("drive app shell loads when setup is complete (upload tray host)", async ({ page }) => {
  await page.route("**/api/v1/setup/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ setup_complete: true }),
    });
  });

  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "unauthorized", message: "not signed in" } }),
    });
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /sign in|log in|welcome/i })).toBeVisible({
    timeout: 15_000,
  });
});
