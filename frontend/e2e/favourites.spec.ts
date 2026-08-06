// Human: End-to-end cover for account-level favourites — star, see the badge, browse, unstar.
// Agent: MOCKS /favourites via the shared drive fixtures; NO backend required.

import { test, expect } from "@playwright/test";
import { createCallLog, mockDriveApi, openDrive } from "./drive-mock-api";

test("starring a file shows a badge, lists it under Favourites, and unstars again", async ({
  page,
}) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  const target = "Brand-Guidelines-v4.pdf";
  const row = page.locator("[data-explorer-entry]", { hasText: target });
  await expect(row.getByLabel("Starred")).toBeHidden();

  await page.getByRole("checkbox", { name: `Select ${target}` }).check({ force: true });
  await page
    .getByRole("toolbar", { name: "Bulk file actions" })
    .getByRole("button", { name: /Favourite/i })
    .click();

  // Human: The star must reach the account, not just this tab's memory.
  await expect.poll(() => [...calls.favourites]).toEqual(["a2"]);
  await expect(row.getByLabel("Starred")).toBeVisible();

  // Human: Favourites is a flat view — the starred file, and no folders.
  await page.getByRole("button", { name: "Favourites", exact: true }).first().click();
  const favouriteRow = page.locator("[data-explorer-entry]", { hasText: target });
  await expect(favouriteRow).toBeVisible();
  await expect(page.locator("[data-explorer-entry]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Open folder Work/i })).toBeHidden();

  // Human: Unstarring from here empties the view.
  await page.getByRole("checkbox", { name: `Select ${target}` }).check({ force: true });
  await page
    .getByRole("toolbar", { name: "Bulk file actions" })
    .getByRole("button", { name: /Favourite/i })
    .click();

  await expect.poll(() => [...calls.favourites]).toEqual([]);
  await expect(page.getByText("No starred files yet")).toBeVisible();
});

test("favourites left in browser storage are imported to the account once", async ({ page }) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);

  // Human: Seed the pre-2026-08 localStorage key before the drive boots.
  await page.addInitScript(() => {
    window.localStorage.setItem("ownly_favourite_files", JSON.stringify(["a1", "a3"]));
  });

  await openDrive(page);

  await expect.poll(() => [...calls.favourites].sort()).toEqual(["a1", "a3"]);
  // Human: The legacy key is cleared only after the server accepted the import.
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("ownly_favourite_files")))
    .toBeNull();
});
