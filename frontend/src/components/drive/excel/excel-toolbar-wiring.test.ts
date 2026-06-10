// Human: Static wiring checks — toolbar callbacks must be passed from ExcelSpreadsheetDialog.
// Agent: READS source files; ASSERTS handler prop names appear in dialog JSX.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spreadsheetDisplayTitle } from "@/components/drive/excel/ExcelToolbarTitleBar";

const here = path.dirname(fileURLToPath(import.meta.url));
const dialogSource = readFileSync(
  path.resolve(here, "../ExcelSpreadsheetDialog.tsx"),
  "utf8",
);

/** Human: Title bar + ribbon handlers that must reach ExcelSpreadsheetDialog. */
const REQUIRED_DIALOG_HANDLERS = [
  "onSave={() => void handleSave()}",
  "onAutoSaveChange={handleAutoSaveChange}",
  "autoSaveEnabled={autoSaveEnabled}",
  "onFillDown={() =>",
  "onFindReplace={() => setFindOpen(true)}",
  "onEditComment={() => setCommentOpen(true)}",
  "onFormatAsTable={() =>",
  "onClearFormatting={() =>",
  "onUndo={() => editor.performUndo()}",
  "onRedo={() => editor.performRedo()}",
  "onSaveCopy={() => void handleSaveCopy()}",
  "onPrint={() => setPrintPreviewOpen(true)}",
] as const;

describe("excel toolbar wiring", () => {
  it("maps spreadsheet filenames to workbook titles", () => {
    expect(spreadsheetDisplayTitle("Sales_Q2_Forecast_2026.xlsx")).toBe("Sales_Q2_Forecast_2026");
    expect(spreadsheetDisplayTitle("")).toBe("Book1");
  });

  it("passes title bar and ribbon handlers from ExcelSpreadsheetDialog", () => {
    for (const snippet of REQUIRED_DIALOG_HANDLERS) {
      expect(dialogSource, `missing handler: ${snippet}`).toContain(snippet);
    }
  });

  it("defines handleSave for title-bar quick save", () => {
    expect(dialogSource).toContain("const handleSave = useCallback");
    expect(dialogSource).toContain("onSave={() => void handleSave()}");
  });

  it("debounces auto-save when AutoSave toggle is enabled", () => {
    expect(dialogSource).toContain("autoSaveEnabled");
    expect(dialogSource).toContain("void handleSave()");
    expect(dialogSource).toMatch(/setTimeout\(\(\) => \{\s*void handleSave\(\{ silent: true \}\)/);
  });

  it("hides manual save controls when AutoSave is enabled", () => {
    const titleBarSource = readFileSync(
      path.resolve(here, "ExcelToolbarTitleBar.tsx"),
      "utf8",
    );
    const headerSource = readFileSync(path.resolve(here, "ExcelDialogHeader.tsx"), "utf8");
    expect(titleBarSource).toContain("!autoSaveEnabled");
    expect(headerSource).toContain("!autoSaveEnabled");
    expect(headerSource).toContain('aria-label="Close spreadsheet"');
  });

  it("persists AutoSave preference via excel-editor-preferences helpers", () => {
    expect(dialogSource).toContain("readExcelAutoSaveEnabled");
    expect(dialogSource).toContain("writeExcelAutoSaveEnabled");
    expect(dialogSource).toContain("handleAutoSaveChange");
  });
});
