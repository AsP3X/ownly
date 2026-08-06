// Human: End-to-end cover for the ⌘K command palette and the undoable recycle toast.
// Agent: MOCKS every /api/v1 route via the shared drive fixtures; NO backend required.

import { test, expect } from "@playwright/test";
import { createCallLog, mockDriveApi, openDrive } from "./drive-mock-api";

test("command palette finds a file, shows where it lives, and reveals its folder", async ({
  page,
}) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("listbox", { name: "Search results and commands" });
  await expect(palette).toBeVisible();

  await page.getByRole("combobox").fill("revenue");

  // Human: The file hit must name the folder it lives in — the whole point of the location line.
  const fileRow = palette.getByRole("option", { name: /Quarterly-Revenue-Model\.xlsx/ });
  await expect(fileRow).toBeVisible({ timeout: 10_000 });
  await expect(fileRow).toContainText("My Cloud / Work / Invoices");

  // Human: Alt+Enter on the highlighted file reveals the folder it lives in.
  await page.getByRole("combobox").press("Alt+Enter");

  await expect(palette).toBeHidden();
  await expect(page.getByRole("button", { name: "Invoices", exact: true })).toBeVisible();
});

test("command palette runs a command without touching the mouse", async ({ page }) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("trash");

  const command = page
    .getByRole("listbox", { name: "Search results and commands" })
    .getByRole("option", { name: /Go to Recycle bin/ });
  await expect(command).toBeVisible();
  await page.getByRole("combobox").press("Enter");

  await expect(page.getByRole("heading", { name: "Recycle bin" }).first()).toBeVisible();
});

test("recycling a file offers an Undo that restores it", async ({ page }) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page
    .getByRole("checkbox", { name: "Select Brand-Guidelines-v4.pdf" })
    .check({ force: true });
  await page.getByRole("toolbar", { name: "Bulk file actions" }).getByRole("button", {
    name: /Delete/i,
  }).click();

  await page.getByRole("button", { name: "Recycle", exact: true }).click();

  const toast = page.getByText("“Brand-Guidelines-v4.pdf” moved to the recycle bin");
  await expect(toast).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Restored/)).toBeVisible({ timeout: 10_000 });
  expect(calls.restored).toEqual([["a2"]]);
});
