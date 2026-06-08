// Human: Structured table references like Sales[Amount] for Excel table formulas.
// Agent: RESOLVES SpreadsheetTable bounds on SheetData; USED by formulas.ts.

import type { SheetData } from "@/lib/spreadsheet/types";

export type TableColumnRef = {
  tableName: string;
  columnName: string;
};

// Human: Parse Table[Column] structured reference token.
// Agent: RETURNS null when pattern does not match.
export function parseTableColumnRef(raw: string): TableColumnRef | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\[([^\]]+)\]$/i.exec(raw.trim());
  if (!match) return null;
  return { tableName: match[1], columnName: match[2].trim() };
}

// Human: Resolve a table column to a zero-based column index within the table header row.
// Agent: READS table header cells; RETURNS col offset from table.startCol.
export function resolveTableColumnIndex(
  sheet: SheetData,
  tableName: string,
  columnName: string,
): { tableStartRow: number; tableStartCol: number; tableEndRow: number; col: number } | null {
  const table = sheet.tables?.find((entry) => entry.name.toLowerCase() === tableName.toLowerCase());
  if (!table) return null;

  const headerRow = sheet.rows[table.startRow];
  if (!headerRow) return null;

  for (let col = table.startCol; col <= table.endCol; col += 1) {
    const header = String(headerRow[col]?.display ?? headerRow[col]?.value ?? "").trim();
    if (header.toLowerCase() === columnName.toLowerCase()) {
      return {
        tableStartRow: table.startRow,
        tableStartCol: table.startCol,
        tableEndRow: table.endRow,
        col,
      };
    }
  }

  return null;
}
