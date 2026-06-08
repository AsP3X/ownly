// Human: Parse formula cell references for Trace Precedents highlighting.
// Agent: READS formula string; RETURNS CellAddress[] for grid overlay.

import { columnLettersToIndex } from "@/lib/spreadsheet/cells";
import type { CellAddress } from "@/lib/spreadsheet/types";

function parseRefToken(raw: string): CellAddress | null {
  const match = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const col = columnLettersToIndex(match[2].toUpperCase());
  const row = Number(match[4]) - 1;
  if (col === null || !Number.isFinite(row) || row < 0) return null;
  return { row, col };
}

// Human: Extract direct precedent cells referenced in a formula (single refs only).
// Agent: SKIPS ranges for highlight; EXPANDS A1:B2 into corner cells for visibility.
export function precedentCellsFromFormula(formula: string | undefined): CellAddress[] {
  if (!formula) return [];
  const expression = formula.startsWith("=") ? formula.slice(1) : formula;
  const results: CellAddress[] = [];
  const seen = new Set<string>();

  const rangePattern = /(\$?[A-Za-z]+\$?\d+):(\$?[A-Za-z]+\$?\d+)/g;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangePattern.exec(expression)) !== null) {
    const start = parseRefToken(rangeMatch[1]);
    const end = parseRefToken(rangeMatch[2]);
    if (!start || !end) continue;
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const key = `${row}:${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ row, col });
      }
    }
  }

  const withoutRanges = expression.replace(rangePattern, " ");
  const singlePattern = /\$?[A-Za-z]+\$?\d+/g;
  let singleMatch: RegExpExecArray | null;
  while ((singleMatch = singlePattern.exec(withoutRanges)) !== null) {
    const address = parseRefToken(singleMatch[0]);
    if (!address) continue;
    const key = `${address.row}:${address.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(address);
  }

  return results;
}

export function precedentCellKey(address: CellAddress): string {
  return `${address.row}:${address.col}`;
}
