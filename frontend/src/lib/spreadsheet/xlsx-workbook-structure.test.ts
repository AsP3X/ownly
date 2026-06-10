// Human: Unit tests for workbook.xml tab rename/reorder merge.
// Agent: ASSERTS sheetId/relId preserved while name/order update.

import { describe, expect, it } from "vitest";
import { applyWorkbookStructureMerge } from "@/lib/spreadsheet/xlsx-workbook-structure";
import type { WorksheetCatalogEntry } from "@/lib/spreadsheet/xlsx-sheet-links";

describe("applyWorkbookStructureMerge", () => {
  it("renames and reorders sheets while keeping rel ids", () => {
    const sourceEntries = new Map<string, Uint8Array>([
      [
        "xl/workbook.xml",
        new TextEncoder().encode(
          '<?xml version="1.0"?><workbook><sheets count="2">' +
            '<sheet name="Sheet1" sheetId="10" r:id="rId1"/>' +
            '<sheet name="Sheet2" sheetId="20" r:id="rId2"/>' +
            "</sheets></workbook>",
        ),
      ],
      [
        "xl/_rels/workbook.xml.rels",
        new TextEncoder().encode(
          '<?xml version="1.0"?><Relationships>' +
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>' +
            "</Relationships>",
        ),
      ],
      ["[Content_Types].xml", new TextEncoder().encode('<?xml version="1.0"?><Types></Types>')],
    ]);

    const generatedEntries = new Map<string, Uint8Array>(sourceEntries);
    const merged = new Map(generatedEntries);
    const sourceCatalog: WorksheetCatalogEntry[] = [
      {
        name: "Sheet1",
        sheetId: "10",
        relId: "rId1",
        sheetPath: "xl/worksheets/sheet1.xml",
      },
      {
        name: "Sheet2",
        sheetId: "20",
        relId: "rId2",
        sheetPath: "xl/worksheets/sheet2.xml",
      },
    ];

    applyWorkbookStructureMerge(
      merged,
      sourceEntries,
      generatedEntries,
      {
        sheets: [
          {
            name: "Second",
            sourceSheetId: "20",
            sourceRelId: "rId2",
            sourceWorksheetPath: "xl/worksheets/sheet2.xml",
            rows: [[{ value: null, display: "" }]],
          },
          {
            name: "First",
            sourceSheetId: "10",
            sourceRelId: "rId1",
            sourceWorksheetPath: "xl/worksheets/sheet1.xml",
            rows: [[{ value: null, display: "" }]],
          },
        ],
      },
      sourceCatalog,
      sourceCatalog,
    );

    const workbookXml = new TextDecoder().decode(merged.get("xl/workbook.xml") ?? new Uint8Array());
    expect(workbookXml.indexOf('name="Second"')).toBeLessThan(workbookXml.indexOf('name="First"'));
    expect(workbookXml).toContain('sheetId="20" r:id="rId2"');
    expect(workbookXml).toContain('sheetId="10" r:id="rId1"');
    expect(workbookXml).not.toContain("Sheet1");
  });

  it("registers a newly added worksheet part from generated output", () => {
    const sourceEntries = new Map<string, Uint8Array>([
      [
        "xl/workbook.xml",
        new TextEncoder().encode(
          '<?xml version="1.0"?><workbook><sheets count="1">' +
            '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>' +
            "</sheets></workbook>",
        ),
      ],
      [
        "xl/_rels/workbook.xml.rels",
        new TextEncoder().encode(
          '<?xml version="1.0"?><Relationships>' +
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
            "</Relationships>",
        ),
      ],
      ["[Content_Types].xml", new TextEncoder().encode('<?xml version="1.0"?><Types></Types>')],
    ]);
    const generatedEntries = new Map<string, Uint8Array>([
      ...sourceEntries,
      ["xl/worksheets/sheet2.xml", new TextEncoder().encode("<worksheet/>")],
      [
        "xl/_rels/workbook.xml.rels",
        new TextEncoder().encode(
          '<?xml version="1.0"?><Relationships>' +
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>' +
            "</Relationships>",
        ),
      ],
      [
        "xl/workbook.xml",
        new TextEncoder().encode(
          '<?xml version="1.0"?><workbook><sheets count="2">' +
            '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>' +
            '<sheet name="Sheet2" sheetId="2" r:id="rId2"/>' +
            "</sheets></workbook>",
        ),
      ],
      [
        "[Content_Types].xml",
        new TextEncoder().encode(
          '<?xml version="1.0"?><Types><Override PartName="/xl/worksheets/sheet2.xml" ContentType="sheet"/></Types>',
        ),
      ],
    ]);

    const merged = new Map(generatedEntries);
    const sourceCatalog: WorksheetCatalogEntry[] = [
      { name: "Sheet1", sheetId: "1", relId: "rId1", sheetPath: "xl/worksheets/sheet1.xml" },
    ];
    const generatedCatalog: WorksheetCatalogEntry[] = [
      ...sourceCatalog,
      { name: "Sheet2", sheetId: "2", relId: "rId2", sheetPath: "xl/worksheets/sheet2.xml" },
    ];

    applyWorkbookStructureMerge(
      merged,
      sourceEntries,
      generatedEntries,
      {
        sheets: [
          {
            name: "Sheet1",
            sourceSheetId: "1",
            sourceRelId: "rId1",
            sourceWorksheetPath: "xl/worksheets/sheet1.xml",
            rows: [[{ value: null, display: "" }]],
          },
          { name: "Sheet2", rows: [[{ value: null, display: "" }]] },
        ],
      },
      sourceCatalog,
      generatedCatalog,
    );

    expect(merged.has("xl/worksheets/sheet2.xml")).toBe(true);
    const rels = new TextDecoder().decode(merged.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
    expect(rels).toContain('Id="rId2"');
  });
});
