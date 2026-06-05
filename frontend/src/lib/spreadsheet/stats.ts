// Human: Selection statistics shown in the Excel status bar (Average, Count, Sum).
// Agent: READS selected cell range values; RETURNS aggregated metrics per Pencil footer.

import type { CellAddress, SelectionStats, SheetCell } from "@/lib/spreadsheet/types";

function numericValue(cell: SheetCell | undefined): number | null {
  if (!cell || cell.value === null || cell.value === "") return null;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const parsed = Number(String(cell.value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Human: Compute footer metrics for the currently selected cell (single-cell selection).
// Agent: READS rows grid + address; RETURNS average/count/sum for numeric values in column slice.
export function computeSelectionStats(rows: SheetCell[][], address: CellAddress | null): SelectionStats {
  if (!address || rows.length === 0) {
    return { average: null, count: 0, sum: null };
  }

  const numbers: number[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cell = rows[rowIndex]?.[address.col];
    const value = numericValue(cell);
    if (value !== null) numbers.push(value);
  }

  if (numbers.length === 0) {
    return { average: null, count: 0, sum: null };
  }

  const sum = numbers.reduce((total, value) => total + value, 0);
  return {
    average: sum / numbers.length,
    count: numbers.length,
    sum,
  };
}

// Human: Format status bar metric line matching Pencil "Average: $31,525 | Count: 6 | Sum: $189,150".
// Agent: READS SelectionStats; RETURNS single footer string.
export function formatSelectionStatsLine(stats: SelectionStats): string {
  const average =
    stats.average === null
      ? "—"
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
          stats.average,
        );
  const sum =
    stats.sum === null
      ? "—"
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
          stats.sum,
        );
  return `Average: ${average}   |   Count: ${stats.count}   |   Sum: ${sum}`;
}
