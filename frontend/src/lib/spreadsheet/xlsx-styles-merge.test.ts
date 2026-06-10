// Human: Unit tests for styles.xml merge and sheetData style index remapping.
// Agent: ASSERTS xfs append + s= attribute rewrite.

import { describe, expect, it } from "vitest";
import { mergeStylesXml, remapSheetDataStyleIndices } from "@/lib/spreadsheet/xlsx-styles-merge";

describe("mergeStylesXml", () => {
  it("appends generated cellXfs and preserves source dxfs", () => {
    const source = `<?xml version="1.0"?>
<styleSheet>
  <fonts count="1"><font><sz val="11"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
  <dxfs count="1"><dxf><font><b/></font></dxf></dxfs>
</styleSheet>`;
    const generated = `<?xml version="1.0"?>
<styleSheet>
  <fonts count="2"><font><sz val="11"/></font><font><b/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>
  </cellXfs>
</styleSheet>`;

    const { mergedXml, cellXfsRemap } = mergeStylesXml(source, generated);
    expect(mergedXml).toContain("<dxfs count=\"1\">");
    expect(mergedXml.match(/<cellXfs count="(\d+)"/)?.[1]).toBe("2");
    expect(cellXfsRemap.get(1)).toBe(1);
  });
});

describe("remapSheetDataStyleIndices", () => {
  it("rewrites s attributes on cells", () => {
    const sheetData =
      '<sheetData><row r="1"><c r="A1" s="3" t="n"><v>1</v></c></row></sheetData>';
    const remapped = remapSheetDataStyleIndices(sheetData, new Map([[3, 9]]));
    expect(remapped).toContain('s="9"');
    expect(remapped).not.toContain('s="3"');
  });
});
