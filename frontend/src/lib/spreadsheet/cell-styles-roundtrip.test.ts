// Human: Unit tests for spreadsheet style patch and format-code round-trip helpers.
// Agent: ASSERTS applyCellStylePatch, clearCellStylePatch, xlsxFormatCodeFromStyle behavior.

import { describe, expect, it } from "vitest";
import {
  applyCellStylePatch,
  cellFontSizeCss,
  cellStyleFromXlsx,
  clearCellStylePatch,
  DEFAULT_CELL_FONT_SIZE_PT,
  resolveCellFontSizePt,
  ribbonFontSizeOptions,
  ribbonFontSizeSelectValue,
} from "@/lib/spreadsheet/cell-styles";
import { xlsxFormatCodeFromStyle } from "@/lib/spreadsheet/number-formats";

describe("applyCellStylePatch", () => {
  it("removes keys when patch value is undefined", () => {
    const result = applyCellStylePatch(
      { bold: true, italic: true, backgroundColor: "#FF0000" },
      { bold: undefined, backgroundColor: undefined },
    );
    expect(result.bold).toBeUndefined();
    expect(result.italic).toBe(true);
    expect(result.backgroundColor).toBeUndefined();
  });

  it("clearCellStylePatch removes every modeled field", () => {
    const result = applyCellStylePatch(
      {
        bold: true,
        fontFamily: "Calibri",
        customNumberFormat: "#,##0.00",
        borderTop: true,
        isHeaderRow: true,
      },
      clearCellStylePatch(),
    );
    expect(result).toEqual({});
  });
});

describe("font size display", () => {
  it("defaults to Excel 11pt when style has no fontSize", () => {
    expect(resolveCellFontSizePt(undefined)).toBe(DEFAULT_CELL_FONT_SIZE_PT);
    expect(ribbonFontSizeSelectValue(undefined)).toBe(11);
    expect(cellFontSizeCss(undefined)).toBe("11pt");
  });

  it("includes non-preset imported sizes in ribbon options", () => {
    const options = ribbonFontSizeOptions(13);
    expect(options.some((entry) => entry.value === 13)).toBe(true);
  });
});

describe("number format round-trip", () => {
  it("preserves imported z-code over builtin mapping on export", () => {
    const code = xlsxFormatCodeFromStyle("number", "#,##0.00_);[Red](#,##0.00)");
    expect(code).toBe("#,##0.00_);[Red](#,##0.00)");
  });

  it("stores non-General z codes on import", () => {
    const style = cellStyleFromXlsx(undefined, "general", {}, "#,##0.00");
    expect(style.customNumberFormat).toBe("#,##0.00");
    expect(style.numberFormat).toBe("number");
  });

  it("does not force row-0 header defaults from cellStyleFromXlsx", () => {
    const style = cellStyleFromXlsx(undefined, "general", {}, undefined);
    expect(style.bold).toBeUndefined();
    expect(style.isHeaderRow).toBeUndefined();
  });
});
