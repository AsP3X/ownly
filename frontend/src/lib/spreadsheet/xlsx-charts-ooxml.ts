// Human: OOXML import/export for embedded worksheet charts (DrawingML chart parts).
// Agent: READS xl/drawings + xl/charts on parse; WRITES new chart parts on insert save.

import { columnIndexToLetters } from "@/lib/spreadsheet/cells";
import { listWorksheetLinksByName } from "@/lib/spreadsheet/xlsx-sheet-links";
import { patchXlsxZipEntries, readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import type { SheetChart, SheetChartType, SheetData } from "@/lib/spreadsheet/types";

function readXmlAttribute(openTag: string, attributeName: string): string | null {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  return pattern.exec(openTag)?.[1] ?? null;
}

function readXmlTagValue(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*val="([^"]*)"`, "i");
  return pattern.exec(xml)?.[1] ?? null;
}

function normalizeXlsxEntryPath(target: string, baseDir: string): string {
  const path = target.replace(/^\.\//, "");
  if (path.startsWith("/")) return path.slice(1);
  if (path.startsWith("xl/")) return path;
  const base = baseDir.replace(/\/[^/]+$/, "");
  const parts = `${base}/${path}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function parseCellToken(token: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(token.replace(/\$/g, ""));
  if (!match) return null;
  const colLetters = match[1].toUpperCase();
  let col = 0;
  for (const char of colLetters) col = col * 26 + (char.charCodeAt(0) - 64);
  col -= 1;
  const row = Number(match[2]) - 1;
  if (!Number.isFinite(row) || row < 0 || col < 0) return null;
  return { row, col };
}

function parseFormulaRange(formula: string): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} | null {
  const cleaned = formula.replace(/^'[^']*'!/, "").replace(/^[^!]+!/, "");
  const parts = cleaned.split(":");
  if (parts.length !== 2) return null;
  const start = parseCellToken(parts[0]);
  const end = parseCellToken(parts[1]);
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endRow: Math.max(start.row, end.row),
    endCol: Math.max(start.col, end.col),
  };
}

function mergeRanges(
  a: { startRow: number; startCol: number; endRow: number; endCol: number } | null,
  b: { startRow: number; startCol: number; endRow: number; endCol: number } | null,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  if (!a) return b;
  if (!b) return a;
  return {
    startRow: Math.min(a.startRow, b.startRow),
    startCol: Math.min(a.startCol, b.startCol),
    endRow: Math.max(a.endRow, b.endRow),
    endCol: Math.max(a.endCol, b.endCol),
  };
}

function parseChartType(chartXml: string): SheetChartType {
  if (/<c:scatterChart\b/i.test(chartXml)) return "scatter";
  if (/<c:doughnutChart\b/i.test(chartXml)) return "doughnut";
  if (/<c:pieChart\b/i.test(chartXml)) return "pie";
  if (/<c:lineChart\b/i.test(chartXml)) return "line";
  if (/<c:areaChart\b/i.test(chartXml) || /<c:area3DChart\b/i.test(chartXml)) return "area";
  if (/<c:barChart\b/i.test(chartXml) || /<c:bar3DChart\b/i.test(chartXml)) {
    const dir = readXmlTagValue(chartXml, "c:barDir");
    return dir === "bar" ? "bar" : "column";
  }
  if (/<c:radarChart\b/i.test(chartXml)) return "line";
  if (/<c:bubbleChart\b/i.test(chartXml)) return "scatter";
  return "column";
}

function parseChartTitle(chartXml: string): string {
  const richMatch = /<c:title\b[\s\S]*?<a:t>([^<]*)<\/a:t>/i.exec(chartXml);
  if (richMatch?.[1]) return richMatch[1];
  const vMatch = /<c:title\b[\s\S]*?<c:v>([^<]*)<\/c:v>/i.exec(chartXml);
  return vMatch?.[1]?.trim() || "Chart";
}

type ParsedSeriesRef = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

function toSeriesRef(range: ParsedSeriesRef | null): ParsedSeriesRef | undefined {
  return range ?? undefined;
}

function firstSeriesXml(chartXml: string): string {
  const match = /<c:ser\b[\s\S]*?<\/c:ser>/i.exec(chartXml);
  return match?.[0] ?? chartXml;
}

function formulaFromAxis(axisXml: string): string | null {
  const refMatch = /<c:(?:strRef|numRef)\b[\s\S]*?<c:f>([^<]*)<\/c:f>/i.exec(axisXml);
  return refMatch?.[1]?.trim() ?? null;
}

// Human: Parse c:cat / c:val / c:xVal / c:yVal formulas from the first chart series.
// Agent: RETURNS distinct category and value ranges for vertical or horizontal Excel layouts.
function parseFirstSeriesRefs(chartXml: string): {
  category: ParsedSeriesRef | null;
  value: ParsedSeriesRef | null;
} {
  const serXml = firstSeriesXml(chartXml);
  const catXml = /<c:cat\b[\s\S]*?<\/c:cat>/i.exec(serXml)?.[0] ?? "";
  const valXml = /<c:val\b[\s\S]*?<\/c:val>/i.exec(serXml)?.[0] ?? "";
  const xValXml = /<c:xVal\b[\s\S]*?<\/c:xVal>/i.exec(serXml)?.[0] ?? "";
  const yValXml = /<c:yVal\b[\s\S]*?<\/c:yVal>/i.exec(serXml)?.[0] ?? "";

  const categoryFormula = formulaFromAxis(catXml) ?? formulaFromAxis(xValXml);
  const valueFormula = formulaFromAxis(valXml) ?? formulaFromAxis(yValXml);

  return {
    category: categoryFormula ? parseFormulaRange(categoryFormula) : null,
    value: valueFormula ? parseFormulaRange(valueFormula) : null,
  };
}

function parseCacheValues(blockXml: string, cacheTag: "strCache" | "numCache"): string[] {
  const cacheMatch = new RegExp(`<c:${cacheTag}\\b[\\s\\S]*?<\\/c:${cacheTag}>`, "i").exec(blockXml);
  if (!cacheMatch) return [];
  const values: string[] = [];
  for (const point of cacheMatch[0].matchAll(/<c:pt\b[^>]*\bidx="(\d+)"[^>]*>[\s\S]*?<c:v>([^<]*)<\/c:v>/gi)) {
    values[Number(point[1])] = point[2];
  }
  return values;
}

// Human: Read cached c:strCache/c:numCache points when worksheet formulas cannot be resolved.
// Agent: PAIRS label/value arrays from the first series; RETURNS undefined when no numeric cache.
function parseFallbackSeries(chartXml: string): Array<{ label: string; value: number }> | undefined {
  const serXml = firstSeriesXml(chartXml);
  const catXml = /<c:cat\b[\s\S]*?<\/c:cat>/i.exec(serXml)?.[0] ?? "";
  const valXml = /<c:val\b[\s\S]*?<\/c:val>/i.exec(serXml)?.[0] ?? "";
  const labels = [
    ...parseCacheValues(catXml, "strCache"),
    ...parseCacheValues(catXml, "numCache"),
  ];
  const values = parseCacheValues(valXml, "numCache");
  if (values.length === 0) return undefined;

  return values
    .map((rawValue, index) => {
      const parsed = Number(String(rawValue).replace(/[$,%\s,]/g, ""));
      if (!Number.isFinite(parsed)) return null;
      const label = labels[index]?.trim();
      return { label: label && label.length > 0 ? label : `Point ${index + 1}`, value: parsed };
    })
    .filter((point): point is { label: string; value: number } => point !== null);
}

function readAnchorPoint(blockXml: string, edge: "from" | "to"): {
  row: number;
  col: number;
  rowOff: number;
  colOff: number;
} | null {
  const edgeMatch = new RegExp(`<xdr:${edge}>([\\s\\S]*?)<\\/xdr:${edge}>`, "i").exec(blockXml);
  if (!edgeMatch) return null;
  const edgeXml = edgeMatch[1];
  const col = /<xdr:col>(\d+)<\/xdr:col>/i.exec(edgeXml)?.[1];
  const row = /<xdr:row>(\d+)<\/xdr:row>/i.exec(edgeXml)?.[1];
  if (!col || !row) return null;
  return {
    col: Number(col),
    row: Number(row),
    colOff: Number(/<xdr:colOff>(\d+)<\/xdr:colOff>/i.exec(edgeXml)?.[1] ?? 0),
    rowOff: Number(/<xdr:rowOff>(\d+)<\/xdr:rowOff>/i.exec(edgeXml)?.[1] ?? 0),
  };
}

function parseDrawingAnchor(drawingXml: string, chartRelId: string): {
  anchorRow: number;
  anchorCol: number;
  anchorEndRow?: number;
  anchorEndCol?: number;
  anchorColOff?: number;
  anchorRowOff?: number;
  anchorEndColOff?: number;
  anchorEndRowOff?: number;
} | null {
  const anchorPattern = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/gi;
  for (const anchorBlock of drawingXml.matchAll(anchorPattern)) {
    if (!anchorBlock[0].includes(chartRelId)) continue;
    const from = readAnchorPoint(anchorBlock[0], "from");
    if (!from) continue;
    const to = readAnchorPoint(anchorBlock[0], "to");
    if (to) {
      return {
        anchorRow: from.row,
        anchorCol: from.col,
        anchorColOff: from.colOff,
        anchorRowOff: from.rowOff,
        anchorEndRow: to.row,
        anchorEndCol: to.col,
        anchorEndColOff: to.colOff,
        anchorEndRowOff: to.rowOff,
      };
    }
    return {
      anchorRow: from.row,
      anchorCol: from.col,
      anchorColOff: from.colOff,
      anchorRowOff: from.rowOff,
    };
  }
  return null;
}

function worksheetRelsPath(sheetPath: string): string {
  const fileName = sheetPath.split("/").pop() ?? "sheet.xml";
  return `xl/worksheets/_rels/${fileName}.rels`;
}

function drawingRelsPath(drawingPath: string): string {
  const fileName = drawingPath.split("/").pop() ?? "drawing.xml";
  return `xl/drawings/_rels/${fileName}.rels`;
}

function readRelationshipMap(relsXml: string, baseDir: string): Map<string, string> {
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = readXmlAttribute(match[1], "Id");
    const target = readXmlAttribute(match[1], "Target");
    if (!id || !target) continue;
    relMap.set(id, normalizeXlsxEntryPath(target, baseDir));
  }
  return relMap;
}

function rangeRef(
  sheetName: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  const start = `$${columnIndexToLetters(startCol)}$${startRow + 1}`;
  const end = `$${columnIndexToLetters(endCol)}$${endRow + 1}`;
  const escapedName = /[^A-Za-z0-9_]/.test(sheetName) ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
  return `${escapedName}!${start}:${end}`;
}

function buildChartXml(chart: SheetChart, sheetName: string): string {
  const catRef = rangeRef(
    sheetName,
    chart.dataStartRow,
    chart.dataStartCol,
    chart.dataEndRow,
    chart.dataStartCol,
  );
  const valRef = rangeRef(
    sheetName,
    chart.dataStartRow,
    chart.dataEndCol,
    chart.dataEndRow,
    chart.dataEndCol,
  );

  const plot =
    chart.type === "area"
      ? `<c:areaChart><c:grouping val="standard"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${valRef}</c:f></c:numRef></c:val></c:ser></c:areaChart>`
      : chart.type === "line"
        ? `<c:lineChart><c:grouping val="standard"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${valRef}</c:f></c:numRef></c:val></c:ser></c:lineChart>`
      : chart.type === "pie" || chart.type === "doughnut"
        ? `<c:${chart.type === "doughnut" ? "doughnutChart" : "pieChart"}><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${valRef}</c:f></c:numRef></c:val></c:ser></c:${chart.type === "doughnut" ? "doughnutChart" : "pieChart"}>`
        : chart.type === "scatter"
          ? `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:ser><c:idx val="0"/><c:order val="0"/><c:xVal><c:numRef><c:f>${catRef}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${valRef}</c:f></c:numRef></c:yVal></c:ser></c:scatterChart>`
          : `<c:barChart><c:barDir val="${chart.type === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${valRef}</c:f></c:numRef></c:val></c:ser></c:barChart>`;

  const axes =
    chart.type === "pie" || chart.type === "doughnut"
      ? ""
      : `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="20"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="10"/></c:valAx>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${chart.title}</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea><c:layout/>${plot}${axes}</c:plotArea>
  </c:chart>
</c:chartSpace>`;
}

function buildDrawingAnchorXml(chart: SheetChart, chartRelId: string): string {
  const endRow = chart.anchorEndRow ?? chart.anchorRow + 12;
  const endCol = chart.anchorEndCol ?? chart.anchorCol + 8;
  const fromColOff = chart.anchorColOff ?? 0;
  const fromRowOff = chart.anchorRowOff ?? 0;
  const toColOff = chart.anchorEndColOff ?? 0;
  const toRowOff = chart.anchorEndRowOff ?? 0;
  return `<xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${chart.anchorCol}</xdr:col><xdr:colOff>${fromColOff}</xdr:colOff><xdr:row>${chart.anchorRow}</xdr:row><xdr:rowOff>${fromRowOff}</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${endCol}</xdr:col><xdr:colOff>${toColOff}</xdr:colOff><xdr:row>${endRow}</xdr:row><xdr:rowOff>${toRowOff}</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${chartRelId}"/></a:graphicData></a:graphic></xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
}

function replaceAnchorPoint(edgeXml: string, point: { row: number; col: number; rowOff: number; colOff: number }): string {
  let next = edgeXml;
  next = next.replace(/<xdr:col>\d+<\/xdr:col>/i, `<xdr:col>${point.col}</xdr:col>`);
  next = next.replace(/<xdr:row>\d+<\/xdr:row>/i, `<xdr:row>${point.row}</xdr:row>`);
  next = next.replace(/<xdr:colOff>\d+<\/xdr:colOff>/i, `<xdr:colOff>${point.colOff}</xdr:colOff>`);
  next = next.replace(/<xdr:rowOff>\d+<\/xdr:rowOff>/i, `<xdr:rowOff>${point.rowOff}</xdr:rowOff>`);
  if (!/<xdr:colOff>/i.test(next)) {
    next = next.replace(/<\/xdr:col>/i, `</xdr:col><xdr:colOff>${point.colOff}</xdr:colOff>`);
  }
  if (!/<xdr:rowOff>/i.test(next)) {
    next = next.replace(/<\/xdr:row>/i, `</xdr:row><xdr:rowOff>${point.rowOff}</xdr:rowOff>`);
  }
  return next;
}

// Human: Patch an existing twoCellAnchor block with moved chart coordinates.
// Agent: MATCHES c:chart r:id; UPDATES xdr:from/xdr:to like Excel after drag-resize.
function patchDrawingAnchorInXml(drawingXml: string, chartRelId: string, chart: SheetChart): string {
  const anchorPattern = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/gi;
  let patched = false;
  const nextXml = drawingXml.replace(anchorPattern, (block) => {
    if (!block.includes(chartRelId)) return block;
    patched = true;
    const endRow = chart.anchorEndRow ?? chart.anchorRow + 12;
    const endCol = chart.anchorEndCol ?? chart.anchorCol + 8;
    let updated = block;
    updated = updated.replace(/<xdr:from>[\s\S]*?<\/xdr:from>/i, (fromBlock) =>
      replaceAnchorPoint(fromBlock, {
        col: chart.anchorCol,
        row: chart.anchorRow,
        colOff: chart.anchorColOff ?? 0,
        rowOff: chart.anchorRowOff ?? 0,
      }),
    );
    updated = updated.replace(/<xdr:to>[\s\S]*?<\/xdr:to>/i, (toBlock) =>
      replaceAnchorPoint(toBlock, {
        col: endCol,
        row: endRow,
        colOff: chart.anchorEndColOff ?? 0,
        rowOff: chart.anchorEndRowOff ?? 0,
      }),
    );
    return updated;
  });
  if (patched) return nextXml;
  return nextXml.replace("</xdr:wsDr>", `${buildDrawingAnchorXml(chart, chartRelId)}</xdr:wsDr>`);
}

const EMPTY_DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"></xdr:wsDr>`;

function nextNumericPathSuffix(entries: Map<string, Uint8Array>, prefix: string): number {
  let max = 0;
  for (const path of entries.keys()) {
    const match = new RegExp(`^${prefix.replace("/", "\\/")}(\\d+)\\.xml$`).exec(path);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function upsertRelationship(
  relsXml: string,
  id: string,
  target: string,
  type: string,
): string {
  if (relsXml.includes(`Id="${id}"`)) return relsXml;
  const relationship = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  if (relsXml.includes("</Relationships>")) {
    return relsXml.replace("</Relationships>", `${relationship}</Relationships>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`;
}

// Human: Import embedded charts per sheet from drawing + chart OOXML parts.
// Agent: READS worksheet drawing rels; RETURNS map keyed by sheet name.
export async function importChartsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, SheetChart[]>> {
  const entries = await readXlsxZipEntries(buffer);
  const links = await listWorksheetLinksByName(buffer);
  const result = new Map<string, SheetChart[]>();

  for (const name of sheetNames) {
    const link = links.get(name);
    if (!link) continue;
    const worksheetXml = new TextDecoder().decode(entries.get(link.sheetPath) ?? new Uint8Array());
    const drawingRelId = /<drawing\b[^>]*r:id="([^"]+)"/i.exec(worksheetXml)?.[1];
    if (!drawingRelId) continue;

    const worksheetRelsPathValue = worksheetRelsPath(link.sheetPath);
    const worksheetRels = new TextDecoder().decode(entries.get(worksheetRelsPathValue) ?? new Uint8Array());
    const worksheetRelsBase = worksheetRelsPathValue.replace(/\/[^/]+$/, "");
    const worksheetRelMap = readRelationshipMap(worksheetRels, worksheetRelsBase);
    const drawingPath = worksheetRelMap.get(drawingRelId);
    if (!drawingPath) continue;

    const drawingXml = new TextDecoder().decode(entries.get(drawingPath) ?? new Uint8Array());
    const drawingRelsPathValue = drawingRelsPath(drawingPath);
    const drawingRels = new TextDecoder().decode(entries.get(drawingRelsPathValue) ?? new Uint8Array());
    const drawingRelsBase = drawingRelsPathValue.replace(/\/[^/]+$/, "");
    const drawingRelMap = readRelationshipMap(drawingRels, drawingRelsBase);

    const charts: SheetChart[] = [];
    for (const [relId, chartPath] of drawingRelMap) {
      if (!/\/charts\/chart\d+\.xml$/i.test(chartPath)) continue;
      const chartXml = new TextDecoder().decode(entries.get(chartPath) ?? new Uint8Array());
      if (!chartXml.includes("<c:chart")) continue;
      const seriesRefs = parseFirstSeriesRefs(chartXml);
      const dataRange = mergeRanges(seriesRefs.category, seriesRefs.value);
      const fallbackSeries = parseFallbackSeries(chartXml);
      if (!dataRange && !fallbackSeries?.length) continue;
      const anchor = parseDrawingAnchor(drawingXml, relId);
      if (!anchor) continue;
      charts.push({
        id: `imported-${chartPath}`,
        type: parseChartType(chartXml),
        title: parseChartTitle(chartXml),
        anchorRow: anchor.anchorRow,
        anchorCol: anchor.anchorCol,
        anchorEndRow: anchor.anchorEndRow,
        anchorEndCol: anchor.anchorEndCol,
        dataStartRow: dataRange?.startRow ?? 0,
        dataStartCol: dataRange?.startCol ?? 0,
        dataEndRow: dataRange?.endRow ?? 0,
        dataEndCol: dataRange?.endCol ?? 0,
        categoryRef: toSeriesRef(seriesRefs.category),
        valueRef: toSeriesRef(seriesRefs.value),
        fallbackSeries,
        imported: true,
        sourceChartPath: chartPath,
        sourceDrawingPath: drawingPath,
        drawingChartRelId: relId,
        anchorColOff: anchor.anchorColOff,
        anchorRowOff: anchor.anchorRowOff,
        anchorEndColOff: anchor.anchorEndColOff,
        anchorEndRowOff: anchor.anchorEndRowOff,
      });
    }

    if (charts.length > 0) result.set(name, charts);
  }

  return result;
}

// Human: Resolve or create the worksheet drawing part path for chart anchor export.
// Agent: READS worksheet drawing rel; CREATES drawing part when missing.
function resolveSheetDrawingContext(
  entries: Map<string, Uint8Array>,
  sheet: SheetData,
  sheetIndex: number,
): { sheetPath: string; drawingPath: string; worksheetRelsPathValue: string } {
  const sheetPath = sheet.sourceWorksheetPath ?? `xl/worksheets/sheet${sheetIndex + 1}.xml`;
  const worksheetRelsPathValue = worksheetRelsPath(sheetPath);
  let worksheetRels = new TextDecoder().decode(entries.get(worksheetRelsPathValue) ?? new Uint8Array());
  if (!worksheetRels) {
    worksheetRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  }

  const worksheetXml = new TextDecoder().decode(entries.get(sheetPath) ?? new Uint8Array());
  let drawingRelId = /<drawing\b[^>]*r:id="([^"]+)"/i.exec(worksheetXml)?.[1] ?? null;
  let drawingPath: string;

  if (drawingRelId) {
    const relMap = readRelationshipMap(worksheetRels, worksheetRelsPathValue.replace(/\/[^/]+$/, ""));
    drawingPath =
      relMap.get(drawingRelId) ?? `xl/drawings/drawing${nextNumericPathSuffix(entries, "xl/drawings/drawing")}.xml`;
  } else {
    drawingRelId = `rId${nextNumericPathSuffix(entries, "xl/worksheets/_rels/")}`;
    const drawingIndex = nextNumericPathSuffix(entries, "xl/drawings/drawing");
    drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
    worksheetRels = upsertRelationship(
      worksheetRels,
      drawingRelId,
      `../drawings/${drawingPath.split("/").pop()}`,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
    );
    const patchedWorksheet = worksheetXml.includes("<drawing ")
      ? worksheetXml
      : worksheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
    entries.set(sheetPath, new TextEncoder().encode(patchedWorksheet));
  }

  entries.set(worksheetRelsPathValue, new TextEncoder().encode(worksheetRels));
  return { sheetPath, drawingPath, worksheetRelsPathValue };
}

// Human: Export chart anchors and inserted chart parts into xl/drawings + xl/charts.
// Agent: PATCHES twoCellAnchor for moved charts; WRITES new chart parts for Ownly inserts.
export async function exportChartsToXlsx(buffer: ArrayBuffer, sheets: SheetData[]): Promise<ArrayBuffer> {
  const hasCharts = sheets.some((sheet) => (sheet.charts ?? []).length);
  if (!hasCharts) return buffer;

  return patchXlsxZipEntries(buffer, (entries) => {
    for (const [sheetIndex, sheet] of sheets.entries()) {
      const charts = sheet.charts ?? [];
      if (!charts.length) continue;

      const chartsByDrawing = new Map<string, SheetChart[]>();
      for (const chart of charts) {
        const drawingKey = chart.sourceDrawingPath ?? `__sheet__${sheet.name}`;
        const bucket = chartsByDrawing.get(drawingKey) ?? [];
        bucket.push(chart);
        chartsByDrawing.set(drawingKey, bucket);
      }

      for (const [drawingKey, drawingCharts] of chartsByDrawing) {
        let drawingPath = drawingKey;
        if (drawingKey.startsWith("__sheet__")) {
          drawingPath = resolveSheetDrawingContext(entries, sheet, sheetIndex).drawingPath;
        }

        let drawingXml = new TextDecoder().decode(entries.get(drawingPath) ?? new Uint8Array());
        if (!drawingXml) drawingXml = EMPTY_DRAWING_XML;

        const drawingRelsPathValue = drawingRelsPath(drawingPath);
        let drawingRels = new TextDecoder().decode(entries.get(drawingRelsPathValue) ?? new Uint8Array());
        if (!drawingRels) {
          drawingRels =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
        }

        for (const chart of drawingCharts) {
          let chartRelId = chart.drawingChartRelId;
          if (!chart.imported) {
            const chartIndex = nextNumericPathSuffix(entries, "xl/charts/chart");
            const chartPath = `xl/charts/chart${chartIndex}.xml`;
            chartRelId = chartRelId ?? `rId${chartIndex}`;
            entries.set(chartPath, new TextEncoder().encode(buildChartXml(chart, sheet.name)));
            drawingRels = upsertRelationship(
              drawingRels,
              chartRelId,
              `../charts/chart${chartIndex}.xml`,
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
            );
          }

          if (!chartRelId) continue;
          drawingXml = patchDrawingAnchorInXml(drawingXml, chartRelId, chart);
        }

        entries.set(drawingPath, new TextEncoder().encode(drawingXml));
        entries.set(drawingRelsPathValue, new TextEncoder().encode(drawingRels));
      }
    }
  });
}
