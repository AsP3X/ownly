// Human: OOXML import/export for column widths and row heights in .xlsx files.
// Agent: PATCHES worksheet XML; READS <cols> and <row ht>; WRITES customWidth/customHeight.

import {
  GRID_DEFAULT_COL_WIDTH,
  hptToDisplayPx,
  isDefaultColumnWidth,
  isDefaultRowHeight,
  lastNonDefaultColumnIndex,
  lastNonDefaultRowIndex,
  resolveColumnWidths,
  resolveRowHeights,
} from "@/lib/spreadsheet/dimensions";
import { trimSheetForSave } from "@/lib/spreadsheet/grid";
import type { SheetData } from "@/lib/spreadsheet/types";
import { readXlsxZipEntries, writeXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";

export type SheetDimensions = {
  columnWidths?: number[];
  rowHeights?: number[];
};

function readXmlAttribute(openTag: string, attributeName: string): string | null {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  return pattern.exec(openTag)?.[1] ?? null;
}

function normalizeXlsxEntryPath(target: string): string {
  let path = target.replace(/^\.\//, "");
  if (!path.startsWith("xl/")) path = `xl/${path}`;
  return path;
}

// Human: Excel column width uses character units; map from our display pixels.
// Agent: INVERSE of wch * 7 + 5 used on import.
function displayPxToWch(displayPx: number): number {
  const wch = (displayPx - 5) / 7;
  return Math.max(0, Math.round(wch * 1000) / 1000);
}

// Human: Excel row height uses points; convert from 96 dpi display pixels.
// Agent: WRITES ht attribute on worksheet row elements.
function displayPxToHpt(displayPx: number): number {
  return Math.round(((displayPx * 72) / 96) * 100) / 100;
}

// Human: Map OOXML width (character units) to grid display pixels.
// Agent: MATCHES columnWidthFromColMeta wch branch in dimensions.ts.
function wchToDisplayPx(wch: number): number {
  return Math.min(400, Math.max(20, Math.round(wch * 7 + 5)));
}

// Human: Excel default column width in character units (~64 CSS px).
// Agent: SKIP importing sheet-wide default <col> spans that would allocate thousands of columns.
const EXCEL_DEFAULT_COL_WCH = (GRID_DEFAULT_COL_WIDTH - 5) / 7;

function isCustomWidthFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

function isExcelDefaultColWch(wch: number): boolean {
  return Math.abs(wch - EXCEL_DEFAULT_COL_WCH) <= 0.05;
}

function parseWorksheetColumnWidths(sheetXml: string): number[] {
  const colsMatch = /<cols\b[^>]*>([\s\S]*?)<\/cols>/i.exec(sheetXml);
  if (!colsMatch) return [];

  const widths: number[] = [];
  for (const match of colsMatch[1].matchAll(/<col\b([^>]*)\/?>/gi)) {
    const attrs = match[1];
    const min = Number.parseInt(readXmlAttribute(attrs, "min") ?? "0", 10);
    const max = Number.parseInt(readXmlAttribute(attrs, "max") ?? "0", 10);
    const width = Number.parseFloat(readXmlAttribute(attrs, "width") ?? "0");
    const customWidth = readXmlAttribute(attrs, "customWidth");
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min || !Number.isFinite(width)) {
      continue;
    }
    if (!isCustomWidthFlag(customWidth) || isExcelDefaultColWch(width)) continue;

    const displayPx = wchToDisplayPx(width);
    if (isDefaultColumnWidth(displayPx)) continue;

    for (let colIndex = min; colIndex <= max; colIndex += 1) {
      widths[colIndex - 1] = displayPx;
    }
  }

  return widths;
}

function parseWorksheetRowHeights(sheetXml: string): number[] {
  const heights: number[] = [];

  for (const match of sheetXml.matchAll(/<row\b[^>]*\bcustomHeight="(?:1|true)"[^>]*\/?>/gi)) {
    const attrs = match[0];
    const rowNumber = Number.parseInt(readXmlAttribute(attrs, "r") ?? "0", 10);
    const ht = Number.parseFloat(readXmlAttribute(attrs, "ht") ?? "0");
    if (!Number.isFinite(rowNumber) || rowNumber < 1 || !Number.isFinite(ht) || ht <= 0) continue;

    const displayPx = hptToDisplayPx(ht);
    if (isDefaultRowHeight(displayPx)) continue;
    heights[rowNumber - 1] = displayPx;
  }

  return heights;
}

function dimensionArrayHasValues(values: number[]): boolean {
  return values.some((value) => typeof value === "number" && Number.isFinite(value));
}

function stripColsBlock(sheetXml: string): string {
  return sheetXml.replace(/<cols\b[^>]*>[\s\S]*?<\/cols>/gi, "");
}

function buildColsBlock(widths: number[]): string {
  const segments: Array<{ min: number; max: number; wch: number }> = [];

  widths.forEach((width, colIndex) => {
    if (isDefaultColumnWidth(width)) return;
    const wch = displayPxToWch(width);
    const colNumber = colIndex + 1;
    const last = segments[segments.length - 1];
    if (last && last.max === colNumber - 1 && Math.abs(last.wch - wch) < 0.001) {
      last.max = colNumber;
      return;
    }
    segments.push({ min: colNumber, max: colNumber, wch });
  });

  if (segments.length === 0) return "";
  const inner = segments
    .map((segment) => `<col min="${segment.min}" max="${segment.max}" width="${segment.wch}" customWidth="1"/>`)
    .join("");
  return `<cols>${inner}</cols>`;
}

function injectColsBlock(sheetXml: string, colsBlock: string): string {
  const stripped = stripColsBlock(sheetXml);
  if (!colsBlock) return stripped;
  if (/<sheetData\b/i.test(stripped)) {
    return stripped.replace(/<sheetData\b/i, `${colsBlock}<sheetData`);
  }
  return stripped.replace(/<\/worksheet>/i, `${colsBlock}</worksheet>`);
}

function upsertRowHeightTag(sheetXml: string, rowNumber: number, hpt: number): string {
  const rowPattern = new RegExp(`<row\\b([^>]*\\br="${rowNumber}"[^>]*)>`, "i");
  const match = rowPattern.exec(sheetXml);

  if (match) {
    const fullTag = match[0];
    const attrs = match[1]
      .replace(/\sht="[^"]*"/gi, "")
      .replace(/\scustomHeight="[^"]*"/gi, "")
      .trim();
    const spacer = attrs.length > 0 ? `${attrs} ` : "";
    return sheetXml.replace(fullTag, `<row ${spacer}ht="${hpt}" customHeight="1">`);
  }

  const rowTag = `<row r="${rowNumber}" ht="${hpt}" customHeight="1"/>`;
  const sheetDataMatch = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/i.exec(sheetXml);
  if (!sheetDataMatch) {
    return sheetXml.replace(/<\/worksheet>/i, `<sheetData>${rowTag}</sheetData></worksheet>`);
  }

  const inner = sheetDataMatch[1];
  const rowMatches = [...inner.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>/gi)];
  for (const rowMatch of rowMatches) {
    const existingRow = Number.parseInt(rowMatch[1], 10);
    if (existingRow > rowNumber) {
      return sheetXml.replace(rowMatch[0], `${rowTag}${rowMatch[0]}`);
    }
  }

  return sheetXml.replace(/<\/sheetData>/i, `${rowTag}</sheetData>`);
}

function injectRowHeights(sheetXml: string, heights: number[]): string {
  let xml = sheetXml;

  heights.forEach((height, rowIndex) => {
    if (isDefaultRowHeight(height)) return;
    xml = upsertRowHeightTag(xml, rowIndex + 1, displayPxToHpt(height));
  });

  return xml;
}

function sheetHasCustomDimensions(sheet: Pick<SheetData, "rows" | "columnWidths" | "rowHeights">): boolean {
  return lastNonDefaultColumnIndex(sheet.columnWidths) >= 0 || lastNonDefaultRowIndex(sheet.rowHeights) >= 0;
}

async function mapWorksheetEntries(buffer: ArrayBuffer): Promise<{
  entries: Map<string, Uint8Array>;
  relMap: Map<string, string>;
  sheetMatches: RegExpMatchArray[];
}> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = readXmlAttribute(match[1], "Id");
    const target = readXmlAttribute(match[1], "Target");
    if (id && target) relMap.set(id, normalizeXlsxEntryPath(target));
  }
  const sheetMatches = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)];
  return { entries, relMap, sheetMatches };
}

// Human: Import column widths and row heights from worksheet OOXML.
// Agent: READS zip worksheet XML; RETURNS map sheetName → dimension arrays.
export async function importDimensionsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, SheetDimensions>> {
  const { entries, relMap, sheetMatches } = await mapWorksheetEntries(buffer);
  const result = new Map<string, SheetDimensions>();

  for (const sheetMatch of sheetMatches) {
    const attrs = sheetMatch[1];
    const name = readXmlAttribute(attrs, "name");
    const relId = readXmlAttribute(attrs, "r:id");
    if (!name || !relId || !sheetNames.includes(name)) continue;

    const target = relMap.get(relId);
    if (!target) continue;

    const sheetXml = new TextDecoder().decode(entries.get(target) ?? new Uint8Array());
    const columnWidths = parseWorksheetColumnWidths(sheetXml);
    const rowHeights = parseWorksheetRowHeights(sheetXml);
    if (!dimensionArrayHasValues(columnWidths) && !dimensionArrayHasValues(rowHeights)) continue;

    result.set(name, {
      columnWidths: dimensionArrayHasValues(columnWidths) ? columnWidths : undefined,
      rowHeights: dimensionArrayHasValues(rowHeights) ? rowHeights : undefined,
    });
  }

  return result;
}

// Human: Patch serialized xlsx bytes with column and row dimension OOXML.
// Agent: REWRITES worksheet XML inside zip; RETURNS patched ArrayBuffer.
export async function exportDimensionsToXlsx(buffer: ArrayBuffer, sheets: SheetData[]): Promise<ArrayBuffer> {
  const trimmedSheets = sheets.map((sheet) => trimSheetForSave(sheet));
  if (!trimmedSheets.some((sheet) => sheetHasCustomDimensions(sheet))) return buffer;

  const { entries, relMap, sheetMatches } = await mapWorksheetEntries(buffer);

  for (const sheetMatch of sheetMatches) {
    const attrs = sheetMatch[1];
    const name = readXmlAttribute(attrs, "name");
    const relId = readXmlAttribute(attrs, "r:id");
    const sheet = trimmedSheets.find((entry) => entry.name === name);
    if (!name || !relId || !sheet || !sheetHasCustomDimensions(sheet)) continue;

    const target = relMap.get(relId);
    if (!target) continue;

    const columnCount = Math.max(...sheet.rows.map((row) => row.length), 1);
    const rowCount = sheet.rows.length;
    const widths = resolveColumnWidths(sheet, columnCount);
    const heights = resolveRowHeights(sheet, rowCount);

    const original = new TextDecoder().decode(entries.get(target) ?? new Uint8Array());
    const colsBlock = buildColsBlock(widths);
    let patched = injectColsBlock(original, colsBlock);
    patched = injectRowHeights(patched, heights);
    entries.set(target, new TextEncoder().encode(patched));
  }

  return writeXlsxZipEntries(entries);
}
