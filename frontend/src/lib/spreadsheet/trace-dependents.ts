// Human: Trace Dependents — find formula cells that reference a given address.
// Agent: SCANS sheet formulas for A1 / A1:B2 tokens; USED by Formulas ribbon + grid overlay.

import { columnIndexToLetters } from "@/lib/spreadsheet/cells";
import type { CellAddress, SheetData } from "@/lib/spreadsheet/types";
import { precedentCellsFromFormula } from "@/lib/spreadsheet/trace-precedents";

// Human: Cells whose formulas depend on the target address (direct dependents).
// Agent: REUSES precedent parser; RETURNS unique addresses excluding the target itself.
export function dependentCellsForAddress(sheet: SheetData, target: CellAddress): CellAddress[] {
  const results: CellAddress[] = [];
  const seen = new Set<string>();
  const targetKey = `${target.row}:${target.col}`;

  for (let row = 0; row < sheet.rows.length; row += 1) {
    const rowCells = sheet.rows[row] ?? [];
    for (let col = 0; col < rowCells.length; col += 1) {
      const formula = rowCells[col]?.formula;
      if (!formula) continue;
      const precedents = precedentCellsFromFormula(formula);
      if (!precedents.some((address) => address.row === target.row && address.col === target.col)) {
        continue;
      }
      const key = `${row}:${col}`;
      if (key === targetKey || seen.has(key)) continue;
      seen.add(key);
      results.push({ row, col });
    }
  }

  return results;
}

// Human: Human-readable label list for dependent cells (status / dialog copy).
// Agent: FORMATS A1-style addresses joined by comma.
export function dependentAddressLabels(dependents: CellAddress[]): string {
  return dependents
    .map((address) => `${columnIndexToLetters(address.col)}${address.row + 1}`)
    .join(", ");
}

export function dependentCellKey(address: CellAddress): string {
  return `${address.row}:${address.col}`;
}
