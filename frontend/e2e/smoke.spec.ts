// Human: Smoke spec — confirms the SPA boots and renders the setup wizard when setup is incomplete.
// Agent: MOCKS /setup/status; NAVIGATES /setup; ASSERTS Welcome heading visible.

import { test, expect } from "@playwright/test";

test("setup wizard renders when setup is incomplete", async ({ page }) => {
  await page.route("**/api/v1/setup/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ setup_complete: false }),
    });
  });

  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Welcome to Ownly" })).toBeVisible({
    timeout: 15_000,
  });
});
