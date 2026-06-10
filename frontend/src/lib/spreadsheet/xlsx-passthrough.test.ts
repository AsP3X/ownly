// Human: Unit tests for passthrough worksheet merge and zip preservation rules.
// Agent: ASSERTS sheetData splice and structure-change detection.

import { describe, expect, it } from "vitest";
import {
  extractSheetDataBlock,
  replaceSheetDataInWorksheet,
} from "@/lib/spreadsheet/xlsx-worksheet-merge";
import { workbookSheetStructureChanged } from "@/lib/spreadsheet/xlsx-passthrough";

describe("replaceSheetDataInWorksheet", () => {
  it("replaces sheetData while preserving drawing anchors", () => {
    const source = `<?xml version="1.0"?>
<worksheet>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>
  <drawing r:id="rId1"/>
</worksheet>`;
    const generatedData = `<sheetData><row r="1"><c r="A1" t="n"><v>42</v></c></row></sheetData>`;
    const patched = replaceSheetDataInWorksheet(source, generatedData);
    expect(patched).toContain("<drawing r:id=\"rId1\"/>");
    expect(patched).toContain("<v>42</v>");
    expect(patched).not.toContain("t=\"s\"");
  });
});

describe("extractSheetDataBlock", () => {
  it("returns the sheetData element", () => {
    const xml = "<worksheet><sheetData><row r=\"1\"/></sheetData></worksheet>";
    expect(extractSheetDataBlock(xml)).toBe("<sheetData><row r=\"1\"/></sheetData>");
  });
});

describe("workbookSheetStructureChanged", () => {
  it("detects renamed sheets", () => {
    const workbookXml =
      '<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>';
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", new TextEncoder().encode(workbookXml)],
    ]);
    const changed = workbookSheetStructureChanged(entries, {
      sheets: [{ name: "Renamed", rows: [[{ value: null, display: "" }]] }],
    });
    expect(changed).toBe(true);
  });
});
