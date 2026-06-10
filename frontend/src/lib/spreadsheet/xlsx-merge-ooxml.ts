// Human: OOXML import/export for worksheet mergeCells regions.
// Agent: PATCHES xl/worksheets/*.xml via workbook rels; READS on parse; WRITES on serialize.

import { columnIndexToLetters } from "@/lib/spreadsheet/cells";
import { listWorksheetLinksByName } from "@/lib/spreadsheet/xlsx-sheet-links";
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
// Agent: READS mergeCells blocks via workbook rels; RETURNS map keyed by sheet name.
export async function importMergedRegionsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, MergedRegion[]>> {
  const entries = await readXlsxZipEntries(buffer);
  const links = await listWorksheetLinksByName(buffer);
  const result = new Map<string, MergedRegion[]>();

  for (const name of sheetNames) {
    const link = links.get(name);
    if (!link) continue;
    const xml = new TextDecoder().decode(entries.get(link.sheetPath) ?? new Uint8Array());
    const regions = parseMergeCellsFromWorksheet(xml);
    if (regions.length > 0) result.set(name, regions);
  }

  return result;
}

// Human: Export merged regions into worksheet XML on save.
// Agent: PATCHES only sheets with modeled mergedRegions; preserves OOXML when undefined.
export async function exportMergedRegionsToXlsx(
  buffer: ArrayBuffer,
  sheets: SheetData[],
): Promise<ArrayBuffer> {
  const links = await listWorksheetLinksByName(buffer);
  const hasModeledMerges = sheets.some((sheet) => sheet.mergedRegions !== undefined);
  if (!hasModeledMerges) return buffer;

  return patchXlsxZipEntries(buffer, (entries) => {
    for (const sheet of sheets) {
      if (sheet.mergedRegions === undefined) continue;
      const link = links.get(sheet.name);
      if (!link) continue;
      const original = new TextDecoder().decode(entries.get(link.sheetPath) ?? new Uint8Array());
      if (!original) continue;
      const patched = upsertMergeCells(original, sheet.mergedRegions);
      entries.set(link.sheetPath, new TextEncoder().encode(patched));
    }
  });
}
