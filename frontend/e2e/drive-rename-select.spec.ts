// Human: End-to-end cover for the rename dialog and mouse multi-select in the explorer.
// Agent: MOCKS every /api/v1 route via the shared drive fixtures; NO backend required.

import { test, expect, type Page } from "@playwright/test";
import { createCallLog, mockDriveApi, openDrive } from "./drive-mock-api";

const BULK_BAR = { role: "toolbar" as const, name: "Bulk file actions" };

async function selectionCount(page: Page): Promise<string> {
  return (
    (await page.getByRole(BULK_BAR.role, { name: BULK_BAR.name }).textContent()) ?? ""
  );
}

test("rename keeps the extension out of the selection and validates before sending", async ({
  page,
}) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  const checkbox = page.getByRole("checkbox", { name: "Select Brand-Guidelines-v4.pdf" });
  await checkbox.check({ force: true });
  // Human: F2 is ignored while a form control has focus, so leave the checkbox before pressing it.
  await checkbox.blur();
  await page.keyboard.press("F2");

  const field = page.getByRole("textbox", { name: "File name" });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("Brand-Guidelines-v4.pdf");

  // Human: The stem is preselected so typing replaces it — the .pdf must survive.
  const selected = await field.evaluate((node: HTMLInputElement) =>
    node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0),
  );
  expect(selected).toBe("Brand-Guidelines-v4");

  // Human: A path separator is refused inline, with no request sent.
  await field.fill("nested/name.pdf");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByText("File name cannot contain / or \\.")).toBeVisible();
  expect(calls.renamed).toEqual([]);

  // Human: A name already used in this folder is caught before the request too.
  await field.fill("Team-Offsite-Notes.txt");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    page.getByText("A file named “Team-Offsite-Notes.txt” already exists here."),
  ).toBeVisible();
  expect(calls.renamed).toEqual([]);

  await field.fill("Brand-Guidelines-v5.pdf");
  await page.getByRole("button", { name: "Rename", exact: true }).click();

  await expect(page.getByText("Renamed to “Brand-Guidelines-v5.pdf”")).toBeVisible({
    timeout: 10_000,
  });
  expect(calls.renamed).toEqual([{ id: "a2", name: "Brand-Guidelines-v5.pdf" }]);

  // Human: Undo puts the old name back through the same endpoint.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Name restored to “Brand-Guidelines-v4.pdf”")).toBeVisible({
    timeout: 10_000,
  });
  expect(calls.renamed).toEqual([
    { id: "a2", name: "Brand-Guidelines-v5.pdf" },
    { id: "a2", name: "Brand-Guidelines-v4.pdf" },
  ]);
});

test("shift-click selects the whole range between two entries", async ({ page }) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  // Human: Files render name-sorted — Brand, Quarterly, Offsite — so this range spans all three.
  await page.getByRole("checkbox", { name: "Select Brand-Guidelines-v4.pdf" }).check({
    force: true,
  });
  expect(await selectionCount(page)).toContain("1 item selected");

  await page
    .getByRole("checkbox", { name: "Select Team-Offsite-Notes.txt" })
    .click({ modifiers: ["Shift"], force: true });

  expect(await selectionCount(page)).toContain("3 items selected");
});

test("dragging a marquee over empty space selects what it covers", async ({ page }) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  const firstTile = page.locator("[data-explorer-entry]").first();
  const lastTile = page.locator("[data-explorer-entry]").last();
  const surface = firstTile.locator("xpath=ancestor::section[1]");
  const firstBox = await firstTile.boundingBox();
  const lastBox = await lastTile.boundingBox();
  const surfaceBox = await surface.boundingBox();
  expect(firstBox && lastBox && surfaceBox).toBeTruthy();
  if (!firstBox || !lastBox || !surfaceBox) return;

  // Human: Start below every tile but still inside the entries surface — that is the empty space
  // a marquee is allowed to begin in.
  const startX = firstBox.x + 8;
  const startY = lastBox.y + lastBox.height + 16;
  expect(startY).toBeLessThan(surfaceBox.y + surfaceBox.height);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width - 4, firstBox.y + 4, { steps: 12 });
  await page.mouse.up();

  expect(await selectionCount(page)).toMatch(/[1-9]\d* items? selected/);

  // Human: A plain click on empty space clears the sweep again.
  await page.mouse.click(startX, startY);
  await expect(page.getByRole(BULK_BAR.role, { name: BULK_BAR.name })).toBeHidden();
});
