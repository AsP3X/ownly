// Human: Named range types and sqref parsing for workbook metadata + formulas.
// Agent: READS definedName OOXML; RESOLVES names to cell ranges during formula eval.

import { columnIndexToLetters, columnLettersToIndex } from "@/lib/spreadsheet/cells";

export type NamedRange = {
  name: string;
  sheetName: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

function parseRefToken(raw: string): { row: number; col: number } | null {
  const cleaned = raw.replace(/\$/g, "");
  const match = /^([A-Za-z]+)(\d+)$/.exec(cleaned);
  if (!match) return null;
  const col = columnLettersToIndex(match[1].toUpperCase());
  const row = Number(match[2]) - 1;
  if (col === null || !Number.isFinite(row) || row < 0) return null;
  return { row, col };
}

// Human: Parse a workbook.xml definedName value like Sheet1!$A$1:$B$5.
// Agent: RETURNS NamedRange bounds or null when value is unsupported.
export function parseDefinedNameValue(name: string, raw: string): NamedRange | null {
  const parts = raw.split("!");
  if (parts.length !== 2) return null;
  const sheetName = parts[0].replace(/^'/, "").replace(/'$/, "");
  const rangeParts = parts[1].split(":");
  const start = parseRefToken(rangeParts[0] ?? "");
  const end = parseRefToken(rangeParts[rangeParts.length - 1] ?? rangeParts[0] ?? "");
  if (!start || !end) return null;

  return {
    name,
    sheetName,
    startRow: Math.min(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endRow: Math.max(start.row, end.row),
    endCol: Math.max(start.col, end.col),
  };
}

// Human: Serialize a named range back to definedName OOXML text.
// Agent: WRITES quoted sheet name when it contains spaces.
export function definedNameToSqref(range: NamedRange): string {
  const sheetPrefix = /[\s']/.test(range.sheetName) ? `'${range.sheetName.replace(/'/g, "''")}'` : range.sheetName;
  const start = `$${columnIndexToLetters(range.startCol)}$${range.startRow + 1}`;
  const end = `$${columnIndexToLetters(range.endCol)}$${range.endRow + 1}`;
  return `${sheetPrefix}!${start}:${end}`;
}

// Human: Look up a named range case-insensitively for formula evaluation.
// Agent: READS workbook.namedRanges; RETURNS first matching entry.
export function findNamedRange(ranges: NamedRange[] | undefined, name: string): NamedRange | undefined {
  if (!ranges?.length) return undefined;
  const normalized = name.trim().toLowerCase();
  return ranges.find((range) => range.name.toLowerCase() === normalized);
}
