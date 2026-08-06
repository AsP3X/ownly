// Human: Smoke spec — confirms the SPA boots and renders the setup wizard when setup is incomplete.
// Agent: MOCKS /setup/status; NAVIGATES /setup; ASSERTS step 1 of the wizard is on screen.

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

  // Human: Step 1 owns the page heading; the token field proves the form rendered with it rather
  // than an empty shell. Both are viewport-independent — the "Step 1 of 4" line is mobile-only.
  // Agent: TITLE comes from SETUP_STEPS[0] in components/setup/setup-steps.ts — keep the two in step.
  await expect(page.getByRole("heading", { name: "Administrator account" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Setup token")).toBeVisible();
});
