// Human: OOXML import/export for worksheet mergeCells regions.
// Agent: PATCHES xl/worksheets/sheetN.xml; READS on parse; WRITES on serialize.

import { columnIndexToLetters } from "@/lib/spreadsheet/cells";
import { patchXlsxZipEntries, readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import type { MergedRegion, SheetData } from "@/lib/spreadsheet/types";

function mergeRef(region: MergedRegion): string {
  const start = `${columnIndexToLetters(region.startCol)}${region.startRow + 1}`;
  const end = `${columnIndexToLetters(region.endCol)}${region.endRow + 1}`;
  return `${start}:${end}`;
}

function parseMergeRef(ref: string): MergedRegion | null {
  const parts = ref.split(":");
  if (parts.length !== 2) return null;

  const parseCell = (token: string) => {
    const match = /^([A-Za-z]+)(\d+)$/.exec(token.replace(/\$/g, ""));
    if (!match) return null;
    const colLetters = match[1].toUpperCase();
    let col = 0;
    for (const char of colLetters) col = col * 26 + (char.charCodeAt(0) - 64);
    col -= 1;
    const row = Number(match[2]) - 1;
    if (!Number.isFinite(row) || row < 0 || col < 0) return null;
    return { row, col };
  };

  const start = parseCell(parts[0]);
  const end = parseCell(parts[1]);
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endRow: Math.max(start.row, end.row),
    endCol: Math.max(start.col, end.col),
  };
}

function buildMergeCellsXml(regions: MergedRegion[]): string {
  if (!regions.length) return "";
  const refs = regions.map((region) => `<mergeCell ref="${mergeRef(region)}"/>`).join("");
  return `<mergeCells count="${regions.length}">${refs}</mergeCells>`;
}

function upsertMergeCells(worksheetXml: string, regions: MergedRegion[]): string {
  const stripped = worksheetXml.replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/i, "");
  if (!regions.length) return stripped;
  const block = buildMergeCellsXml(regions);
  if (stripped.includes("</sheetData>")) {
    return stripped.replace("</sheetData>", `</sheetData>${block}`);
  }
  if (stripped.includes("</worksheet>")) {
    return stripped.replace("</worksheet>", `${block}</worksheet>`);
  }
  return stripped + block;
}

function parseMergeCellsFromWorksheet(xml: string): MergedRegion[] {
  const match = /<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/i.exec(xml);
  if (!match) return [];
  const regions: MergedRegion[] = [];
  for (const cellMatch of match[1].matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/gi)) {
    const parsed = parseMergeRef(cellMatch[1]);
    if (parsed) regions.push(parsed);
  }
  return regions;
}

// Human: Import merged regions per sheet from worksheet XML.
// Agent: READS mergeCells blocks; RETURNS map keyed by sheet name.
export async function importMergedRegionsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, MergedRegion[]>> {
  const entries = await readXlsxZipEntries(buffer);
  const result = new Map<string, MergedRegion[]>();

  sheetNames.forEach((name, index) => {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const xml = new TextDecoder().decode(entries.get(path) ?? new Uint8Array());
    const regions = parseMergeCellsFromWorksheet(xml);
    if (regions.length > 0) result.set(name, regions);
  });

  return result;
}

// Human: Export merged regions into worksheet XML on save.
// Agent: PATCHES each sheet's mergeCells block from workbook model.
export async function exportMergedRegionsToXlsx(
  buffer: ArrayBuffer,
  sheets: SheetData[],
): Promise<ArrayBuffer> {
  return patchXlsxZipEntries(buffer, (entries) => {
    sheets.forEach((sheet, index) => {
      const path = `xl/worksheets/sheet${index + 1}.xml`;
      const original = new TextDecoder().decode(entries.get(path) ?? new Uint8Array());
      if (!original) return;
      const patched = upsertMergeCells(original, sheet.mergedRegions ?? []);
      entries.set(path, new TextEncoder().encode(patched));
    });
  });
}
