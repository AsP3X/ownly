/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { writeXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import { exportChartsToXlsx, importChartsFromXlsx } from "@/lib/spreadsheet/xlsx-charts-ooxml";
import type { SheetData } from "@/lib/spreadsheet/types";

const CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:ser>
          <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f></c:numRef></c:val>
        </c:ser>
      </c:barChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`;

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>4</xdr:col><xdr:row>1</xdr:row></xdr:from>
    <xdr:to><xdr:col>10</xdr:col><xdr:row>12</xdr:row></xdr:to>
    <xdr:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;

describe("importChartsFromXlsx", () => {
  it("imports column chart metadata from drawing and chart parts", async () => {
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`)],
      ["xl/_rels/workbook.xml.rels", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`)],
      ["xl/worksheets/sheet1.xml", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/><drawing r:id="rId2"/>
</worksheet>`)],
      ["xl/worksheets/_rels/sheet1.xml.rels", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`)],
      ["xl/drawings/drawing1.xml", new TextEncoder().encode(DRAWING_XML)],
      ["xl/drawings/_rels/drawing1.xml.rels", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`)],
      ["xl/charts/chart1.xml", new TextEncoder().encode(CHART_XML)],
    ]);
    const buffer = await writeXlsxZipEntries(entries);
    const chartsBySheet = await importChartsFromXlsx(buffer, ["Sheet1"]);
    const charts = chartsBySheet.get("Sheet1");

    expect(charts).toHaveLength(1);
    expect(charts?.[0]).toMatchObject({
      type: "column",
      title: "Sales",
      anchorRow: 1,
      anchorCol: 4,
      anchorEndRow: 12,
      anchorEndCol: 10,
      dataStartRow: 1,
      dataStartCol: 0,
      dataEndRow: 3,
      dataEndCol: 1,
      categoryRef: { startRow: 1, startCol: 0, endRow: 3, endCol: 0 },
      valueRef: { startRow: 1, startCol: 1, endRow: 3, endCol: 1 },
      imported: true,
      sourceChartPath: "xl/charts/chart1.xml",
      drawingChartRelId: "rId1",
    });
  });

  it("exports moved chart anchors into drawing twoCellAnchor XML", async () => {
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`)],
      ["xl/_rels/workbook.xml.rels", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`)],
      ["xl/worksheets/sheet1.xml", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/><drawing r:id="rId2"/>
</worksheet>`)],
      ["xl/worksheets/_rels/sheet1.xml.rels", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`)],
      ["xl/drawings/drawing1.xml", new TextEncoder().encode(DRAWING_XML)],
      ["xl/drawings/_rels/drawing1.xml.rels", new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`)],
      ["xl/charts/chart1.xml", new TextEncoder().encode(CHART_XML)],
    ]);
    const sourceBuffer = await writeXlsxZipEntries(entries);
    const sheet: SheetData = {
      name: "Sheet1",
      sourceWorksheetPath: "xl/worksheets/sheet1.xml",
      rows: [[{ value: null, display: "" }]],
      charts: [
        {
          id: "imported-xl/charts/chart1.xml",
          type: "column",
          title: "Sales",
          anchorRow: 3,
          anchorCol: 1,
          anchorEndRow: 10,
          anchorEndCol: 6,
          dataStartRow: 1,
          dataStartCol: 0,
          dataEndRow: 3,
          dataEndCol: 1,
          imported: true,
          sourceChartPath: "xl/charts/chart1.xml",
          sourceDrawingPath: "xl/drawings/drawing1.xml",
          drawingChartRelId: "rId1",
        },
      ],
    };

    const exported = await exportChartsToXlsx(sourceBuffer, [sheet]);
    const imported = await importChartsFromXlsx(exported, ["Sheet1"]);
    expect(imported.get("Sheet1")?.[0]).toMatchObject({
      anchorRow: 3,
      anchorCol: 1,
      anchorEndRow: 10,
      anchorEndCol: 6,
    });
  });
});
