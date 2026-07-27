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
  "onClose={() => handleDialogOpenChange(false)}",
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
    expect(titleBarSource).toContain("!autoSaveEnabled");
  });

  it("matches real Excel topbar chrome (title - Excel, search, window close, Comments/Share on tabs)", () => {
    const titleBarSource = readFileSync(
      path.resolve(here, "ExcelToolbarTitleBar.tsx"),
      "utf8",
    );
    const primitivesSource = readFileSync(
      path.resolve(here, "excel-ribbon-primitives.tsx"),
      "utf8",
    );
    const ribbonSource = readFileSync(
      path.resolve(here, "ExcelSpreadsheetRibbon.tsx"),
      "utf8",
    );

    expect(titleBarSource).toContain(" - Excel");
    expect(titleBarSource).toContain(">Search<");
    expect(titleBarSource).toContain('aria-label="Close spreadsheet"');
    expect(titleBarSource).toContain("EXCEL_RIBBON_CHROME_BG");
    expect(primitivesSource).toContain("onComments");
    expect(primitivesSource).toContain("onShare");
    expect(primitivesSource).toContain("EXCEL_RIBBON_SHARE");
    expect(ribbonSource).toContain('{ id: "file", label: "File" }');
    expect(ribbonSource).toContain('{ id: "draw", label: "Draw" }');
    expect(ribbonSource).toContain('{ id: "automate", label: "Automate" }');
    expect(ribbonSource).toContain('{ id: "help", label: "Help" }');
    expect(dialogSource).not.toContain("ExcelDialogHeader");
  });

  it("persists AutoSave preference via excel-editor-preferences helpers", () => {
    expect(dialogSource).toContain("readExcelAutoSaveEnabled");
    expect(dialogSource).toContain("writeExcelAutoSaveEnabled");
    expect(dialogSource).toContain("handleAutoSaveChange");
  });
});
