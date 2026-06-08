// Human: Parse Excel sheet-qualified references like Sheet2!A1 or 'My Sheet'!$B$2:$C$10.
// Agent: RESOLVES sheet index from workbook; USED by formulas.ts evaluator.

import { columnLettersToIndex } from "@/lib/spreadsheet/cells";
import type { CellRange } from "@/lib/spreadsheet/selection";
import { normalizeRange } from "@/lib/spreadsheet/selection";
import type { SheetData } from "@/lib/spreadsheet/types";

export type SheetQualifiedRef = {
  sheetIndex: number;
  range: CellRange | null;
  cell: { row: number; col: number } | null;
};

// Human: Strip optional sheet prefix from a formula token.
// Agent: RETURNS { sheetName, ref } when bang present; else ref only on active sheet.
export function splitSheetQualifiedToken(
  raw: string,
  sheets: SheetData[],
  activeSheetIndex: number,
): { sheetIndex: number; refPart: string } {
  const trimmed = raw.trim();
  const bangIndex = trimmed.lastIndexOf("!");
  if (bangIndex < 0) {
    return { sheetIndex: activeSheetIndex, refPart: trimmed };
  }

  let sheetName = trimmed.slice(0, bangIndex).trim();
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }

  const sheetIndex = sheets.findIndex(
    (sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase(),
  );
  return {
    sheetIndex: sheetIndex >= 0 ? sheetIndex : activeSheetIndex,
    refPart: trimmed.slice(bangIndex + 1).trim(),
  };
}

function parseCellRefPart(refPart: string): { row: number; col: number } | null {
  const match = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(refPart.replace(/\$/g, ""));
  if (!match) return null;
  const col = columnLettersToIndex(match[2].toUpperCase());
  const row = Number(match[4]) - 1;
  if (col === null || !Number.isFinite(row) || row < 0) return null;
  return { row, col };
}

function parseRangeRefPart(refPart: string): CellRange | null {
  const parts = refPart.split(":");
  if (parts.length !== 2) return null;
  const start = parseCellRefPart(parts[0]);
  const end = parseCellRefPart(parts[1]);
  if (!start || !end) return null;
  return normalizeRange({ start, end });
}

// Human: Resolve a sheet-qualified reference token to sheet index + range or cell.
// Agent: CALLS splitSheetQualifiedToken; RETURNS null when ref is invalid.
export function resolveSheetQualifiedRef(
  raw: string,
  sheets: SheetData[],
  activeSheetIndex: number,
): SheetQualifiedRef | null {
  const { sheetIndex, refPart } = splitSheetQualifiedToken(raw, sheets, activeSheetIndex);
  const range = parseRangeRefPart(refPart.replace(/\$/g, ""));
  if (range) return { sheetIndex, range, cell: null };
  const cell = parseCellRefPart(refPart);
  if (cell) return { sheetIndex, range: null, cell };
  return null;
}

// Human: Detect sheet-qualified range pattern inside a formula expression.
// Agent: REGEX replaces 'Sheet'!A1:B2 before single-cell replacement pass.
export const SHEET_QUALIFIED_RANGE_PATTERN =
  /(?:'[^']*(?:''[^']*)*'|[A-Za-z0-9_]+)!(\$?[A-Za-z]+\$?\d+):(\$?[A-Za-z]+\$?\d+)/g;

export const SHEET_QUALIFIED_CELL_PATTERN =
  /(?:'[^']*(?:''[^']*)*'|[A-Za-z0-9_]+)!(\$?[A-Za-z]+\$?\d+)/g;
