// Human: End-to-end cover for creating documents and for an expiring session.
// Agent: MOCKS the upload + 401 paths via the shared drive fixtures; NO backend required.

import { test, expect } from "@playwright/test";
import { createCallLog, mockDriveApi, openDrive } from "./drive-mock-api";

test("New Document creates an empty file in the open folder and opens its editor", async ({
  page,
}) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);

  await page.getByRole("button", { name: /New Document/i }).click();

  const dialog = page.getByRole("radiogroup", { name: "Document type" });
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/Creates an empty file in My Cloud/)).toBeVisible();

  await page.getByRole("radio", { name: /Text document/ }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // Human: The upload carries a real, correctly-named file rather than a placeholder.
  await expect.poll(() => calls.uploads.map((upload) => upload.name)).toEqual(["Untitled.txt"]);
  await expect(page.getByText("Created “Untitled.txt”")).toBeVisible({ timeout: 10_000 });
});

test("an expiring session explains itself and offers a way back", async ({ page }) => {
  const calls = createCallLog();
  await mockDriveApi(page, calls);
  await openDrive(page);
  await page.getByRole("button", { name: /Open folder Work/i }).click();
  await expect(page).toHaveURL(/folder=work/);

  const unauthorized = {
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "unauthorized", message: "token expired" } }),
  };

  // Human: Only the mutation behaves like a revoked session — 401ing /setup/status too would
  // send the app to the setup wizard instead, which is a different flow entirely.
  await page.route("**/api/v1/folders", (route) => route.fulfill(unauthorized));
  // Human: A truly expired session cannot refresh either; without this the client retries forever.
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill(unauthorized));

  await page.getByRole("button", { name: /New Folder/i }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill("Anything");
  await page.getByRole("button", { name: "Create folder" }).click();

  // Human: The old behaviour dumped the user on the marketing page with no explanation.
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(
    page.getByText("Your session expired. Sign in to pick up where you left off."),
  ).toBeVisible();

  // Human: Signing in must return to the folder the session died in, not the default view.
  // Agent: React Router keeps navigation state under history.state.usr.
  const carried = await page.evaluate(
    () => (window.history.state as { usr?: { from?: string } } | null)?.usr ?? null,
  );
  expect(carried?.from).toBe("/?view=my-files&folder=work");
});
