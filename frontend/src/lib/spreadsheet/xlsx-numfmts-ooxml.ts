// Human: Parse xl/styles.xml numFmts + cellXfs for format codes when SheetJS omits cell.z.
// Agent: USED by parseSpreadsheetBuffer to enrich number formats from OOXML style indices.

import {
  formatCodeFromNumFmtId,
  numberFormatFromXlsxCode,
} from "@/lib/spreadsheet/number-formats";
import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import type { NumberFormat, SheetCell, SheetData } from "@/lib/spreadsheet/types";
import { readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import { listWorksheetLinksByName } from "@/lib/spreadsheet/xlsx-sheet-links";

function decodeXmlAttr(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// Human: Read custom numFmtId → formatCode map from styles.xml.
// Agent: RETURNS empty object when styles part is missing.
export async function importNumFmtMapFromXlsx(
  buffer: ArrayBuffer,
): Promise<Record<number, string>> {
  try {
    const entries = await readXlsxZipEntries(buffer);
    const stylesXml = new TextDecoder().decode(entries.get("xl/styles.xml") ?? new Uint8Array());
    if (!stylesXml) return {};
    const map: Record<number, string> = {};
    for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/gi)) {
      const attrs = match[1];
      const id = /numFmtId="(\d+)"/i.exec(attrs)?.[1];
      const code = /formatCode="([^"]*)"/i.exec(attrs)?.[1];
      if (id && code) {
        map[Number.parseInt(id, 10)] = decodeXmlAttr(code);
      }
    }
    return map;
  } catch {
    return {};
  }
}

// Human: Map cellXfs style index → numFmtId from styles.xml.
// Agent: INDEX 0 is first <xf> in cellXfs; USED when SheetJS cell.s is a style index or worksheet s=.
export async function importCellXfNumFmtIdsFromXlsx(
  buffer: ArrayBuffer,
): Promise<number[]> {
  try {
    const entries = await readXlsxZipEntries(buffer);
    const stylesXml = new TextDecoder().decode(entries.get("xl/styles.xml") ?? new Uint8Array());
    if (!stylesXml) return [];
    const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i.exec(stylesXml)?.[1] ?? "";
    const ids: number[] = [];
    for (const match of block.matchAll(/<xf\b([^>]*)\/?>/gi)) {
      const numFmtId = /numFmtId="(\d+)"/i.exec(match[1])?.[1];
      ids.push(numFmtId ? Number.parseInt(numFmtId, 10) : 0);
    }
    return ids;
  } catch {
    return [];
  }
}

export type StyleFormatResolver = {
  // Human: cellXfs index → format code (built-in or custom).
  formatCodeByStyleIndex: string[];
  // Human: sheet name → A1 ref → cellXfs index from worksheet XML.
  styleIndexBySheetRef: Map<string, Map<string, number>>;
};

// Human: Build full style-index → formatCode table from styles.xml.
// Agent: COMBINES cellXfs numFmtId with custom numFmts + built-in id table.
export function buildFormatCodeByStyleIndex(
  cellXfNumFmtIds: number[],
  customNumFmts: Record<number, string>,
): string[] {
  return cellXfNumFmtIds.map((numFmtId) => {
    const code = formatCodeFromNumFmtId(numFmtId, customNumFmts);
    return code ?? "General";
  });
}

// Human: Scan worksheet XML for <c r="A1" s="N"/> style indices.
// Agent: RETURNS map of uppercase A1 → style index for one sheet.
export function parseWorksheetCellStyleIndices(worksheetXml: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const match of worksheetXml.matchAll(/<c\b([^>]*)\/?>/gi)) {
    const attrs = match[1];
    const ref = /r="([A-Za-z]+\d+)"/i.exec(attrs)?.[1];
    const styleRaw = /s="(\d+)"/i.exec(attrs)?.[1];
    if (!ref || styleRaw === undefined) continue;
    map.set(ref.toUpperCase(), Number.parseInt(styleRaw, 10));
  }
  return map;
}

// Human: Load per-sheet A1→styleIndex maps from the xlsx package.
// Agent: USES worksheet paths from workbook links; SKIPS sheets without paths.
export async function importWorksheetStyleIndicesFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  try {
    const entries = await readXlsxZipEntries(buffer);
    const links = await listWorksheetLinksByName(buffer);
    for (const name of sheetNames) {
      const path = links.get(name)?.sheetPath;
      if (!path) continue;
      const xml = new TextDecoder().decode(entries.get(path) ?? new Uint8Array());
      if (!xml) continue;
      result.set(name, parseWorksheetCellStyleIndices(xml));
    }
  } catch {
    // leave empty
  }
  return result;
}

// Human: Load complete style format resolver (cellXfs + worksheet s= maps).
// Agent: CALLED once in parseSpreadsheetBuffer before sheet row enrichment.
export async function importStyleFormatResolverFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<StyleFormatResolver> {
  const [customNumFmts, cellXfNumFmtIds, styleIndexBySheetRef] = await Promise.all([
    importNumFmtMapFromXlsx(buffer),
    importCellXfNumFmtIdsFromXlsx(buffer),
    importWorksheetStyleIndicesFromXlsx(buffer, sheetNames),
  ]);
  return {
    formatCodeByStyleIndex: buildFormatCodeByStyleIndex(cellXfNumFmtIds, customNumFmts),
    styleIndexBySheetRef,
  };
}

function cellRefFromIndices(row: number, col: number): string {
  let n = col + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

// Human: When SheetJS omits cell.z, apply format from styles.xml cellXfs via worksheet s=.
// Agent: MUTATES sheet rows in place for display + style.numberFormat/customNumberFormat.
export function applyStyleIndexFormatsToSheet(
  sheet: SheetData,
  resolver: StyleFormatResolver,
): SheetData {
  const refMap = resolver.styleIndexBySheetRef.get(sheet.name);
  if (!refMap || resolver.formatCodeByStyleIndex.length === 0) return sheet;

  const nextRows = sheet.rows.map((row, rowIndex) =>
    row.map((cell, colIndex) => {
      // Human: Keep explicit format codes SheetJS already resolved.
      // Agent: SKIP when customNumberFormat or non-general numberFormat already set from z.
      if (cell.style?.customNumberFormat) return cell;
      if (cell.style?.numberFormat && cell.style.numberFormat !== "general") return cell;

      const ref = cellRefFromIndices(rowIndex, colIndex);
      const styleIndex = refMap.get(ref);
      if (styleIndex === undefined) return cell;
      const formatCode = resolver.formatCodeByStyleIndex[styleIndex];
      if (!formatCode || formatCode.toLowerCase() === "general") return cell;

      const numberFormat: NumberFormat = numberFormatFromXlsxCode(formatCode);
      const customNumberFormat =
        formatCode.trim().toLowerCase() !== "general" ? formatCode.trim() : undefined;
      const nextStyle = {
        ...cell.style,
        numberFormat,
        customNumberFormat,
      };
      // Human: Reformat display only when SheetJS left raw/general display.
      // Agent: PRESERVES raw.w-like display when it already looks formatted and non-empty.
      const display =
        cell.display && cell.display !== String(cell.value ?? "")
          ? cell.display
          : formatCellDisplay(cell.value, numberFormat, customNumberFormat);

      return { ...cell, style: nextStyle, display } satisfies SheetCell;
    }),
  );

  return { ...sheet, rows: nextRows };
}
