// Human: End-to-end cover for the offline banner and connection-aware error copy.
// Agent: USES Playwright's context.setOffline; NO backend required.

import { test, expect } from "@playwright/test";
import { createCallLog, mockDriveApi, openDrive } from "./drive-mock-api";

const OFFLINE_TEXT = /You are offline/;

test("the drive announces a dropped connection and clears the notice on reconnect", async ({
  page,
  context,
}) => {
  await mockDriveApi(page, createCallLog());
  await openDrive(page);

  await expect(page.getByText(OFFLINE_TEXT)).toBeHidden();

  await context.setOffline(true);
  await expect(page.getByText(OFFLINE_TEXT)).toBeVisible({ timeout: 10_000 });

  await context.setOffline(false);
  await expect(page.getByText(OFFLINE_TEXT)).toBeHidden({ timeout: 10_000 });
});

test("a failed request reads as a connection problem, not browser jargon", async ({ page }) => {
  await mockDriveApi(page, createCallLog());
  await openDrive(page);

  // Human: Kill the listing endpoints, then force a fetch by opening a folder.
  await page.route("**/api/v1/folders*", (route) => route.abort("internetdisconnected"));
  await page.route("**/api/v1/files*", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: /Open folder Work/i }).click();

  const banner = page.getByText("Can't reach the server. Check your connection, then try again.");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  // Human: The browser's own wording must never reach the user.
  await expect(page.getByText(/Failed to fetch|NetworkError|Load failed/)).toBeHidden();
});
