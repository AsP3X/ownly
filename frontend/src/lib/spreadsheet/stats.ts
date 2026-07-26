// Human: Selection statistics shown in the Excel status bar (Average, Count, Sum).
// Agent: READS selected cell range values; RETURNS aggregated metrics per Pencil footer.

import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { CellAddress, SelectionStats, SheetCell } from "@/lib/spreadsheet/types";

function numericValue(cell: SheetCell | undefined): number | null {
  if (!cell || cell.value === null || cell.value === "") return null;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const parsed = Number(String(cell.value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Human: Compute footer metrics for the currently selected cell (legacy single-cell path).
// Agent: DELEGATES to range stats for the full data column below the header when only address given.
export function computeSelectionStats(rows: SheetCell[][], address: CellAddress | null): SelectionStats {
  if (!address || rows.length === 0) {
    return { average: null, count: 0, sum: null };
  }
  // Human: Single-cell selection still aggregates the column (demo-friendly status bar).
  // Agent: RANGE from row 1 through last row at the active column.
  return computeRangeSelectionStats(rows, {
    start: { row: 1, col: address.col },
    end: { row: Math.max(1, rows.length - 1), col: address.col },
  });
}

// Human: Excel-style status metrics over the current selection range.
// Agent: COUNTS numeric cells only for average/sum; COUNT is numeric count (Excel status bar).
export function computeRangeSelectionStats(
  rows: SheetCell[][],
  range: CellRange | null,
): SelectionStats {
  if (!range || rows.length === 0) {
    return { average: null, count: 0, sum: null };
  }
  const normalized = normalizeRange(range);
  const numbers: number[] = [];
  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    for (let col = normalized.start.col; col <= normalized.end.col; col += 1) {
      const value = numericValue(rows[row]?.[col]);
      if (value !== null) numbers.push(value);
    }
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
// Agent: READS SelectionStats; USES compact number format when values are small / non-currency-like.
export function formatSelectionStatsLine(stats: SelectionStats): string {
  const formatNumber = (value: number) => {
    if (Math.abs(value) >= 1000) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    }
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
    }).format(value);
  };
  const average = stats.average === null ? "—" : formatNumber(stats.average);
  const sum = stats.sum === null ? "—" : formatNumber(stats.sum);
  return `Average: ${average}   |   Count: ${stats.count}   |   Sum: ${sum}`;
}
