import { describe, expect, it } from "vitest";
import {
  applyStyleIndexFormatsToSheet,
  buildFormatCodeByStyleIndex,
  parseWorksheetCellStyleIndices,
} from "@/lib/spreadsheet/xlsx-numfmts-ooxml";
import type { SheetData } from "@/lib/spreadsheet/types";

describe("xlsx-numfmts-ooxml style index formats", () => {
  it("parses worksheet c@s style indices", () => {
    const xml = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" s="2" t="n"><v>1</v></c><c r="B1" t="n"><v>2</v></c></row>
    </sheetData></worksheet>`;
    const map = parseWorksheetCellStyleIndices(xml);
    expect(map.get("A1")).toBe(2);
    expect(map.has("B1")).toBe(false);
  });

  it("builds format codes from cellXfs numFmtIds", () => {
    const codes = buildFormatCodeByStyleIndex([0, 14, 10], { 164: "0.000" });
    expect(codes[0]).toBe("General");
    expect(codes[1]).toBe("m/d/yyyy");
    expect(codes[2]).toBe("0.00%");
  });

  it("applies missing z formats from style index map", () => {
    const sheet: SheetData = {
      name: "Sheet1",
      rows: [[{ value: 0.5, display: "0.5", style: { numberFormat: "general" } }]],
    };
    const next = applyStyleIndexFormatsToSheet(sheet, {
      formatCodeByStyleIndex: ["General", "0.00%"],
      styleIndexBySheetRef: new Map([["Sheet1", new Map([["A1", 1]])]]),
    });
    expect(next.rows[0][0].style?.numberFormat).toBe("percent");
    expect(next.rows[0][0].style?.customNumberFormat).toBe("0.00%");
    expect(next.rows[0][0].display).toContain("%");
  });
});
