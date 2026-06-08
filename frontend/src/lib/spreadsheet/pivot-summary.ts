// Human: Lightweight pivot summary — group-by column with sum/count/average on a value column.
// Agent: READS SheetData selection; RETURNS tabular pivot rows for dialog preview + new sheet.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";

export type PivotAggregation = "sum" | "count" | "average" | "max" | "min";

export type PivotSummaryResult = {
  headers: string[];
  rows: SheetCell[][];
};

function cellDisplayValue(cell: SheetCell | undefined): string {
  if (!cell) return "";
  return cell.display || String(cell.value ?? "");
}

function numericFromCell(cell: SheetCell | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const parsed = Number(String(cell.value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregateValues(values: number[], aggregation: PivotAggregation): number {
  if (values.length === 0) return 0;
  switch (aggregation) {
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "count":
      return values.length;
    case "average":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    default:
      return 0;
  }
}

function pivotCell(value: string | number | null): SheetCell {
  return {
    value,
    display: formatCellDisplay(value, typeof value === "number" ? "number" : "general"),
    style: typeof value === "number" ? { numberFormat: "number" } : undefined,
  };
}

// Human: List column indices covered by a normalized selection range.
// Agent: USED by pivot dialog to populate row/value field pickers.
export function columnIndicesInRange(range: CellRange): number[] {
  const normalized = normalizeRange(range);
  const indices: number[] = [];
  for (let col = normalized.start.col; col <= normalized.end.col; col += 1) {
    indices.push(col);
  }
  return indices;
}

// Human: Build a grouped pivot table from the selected range.
// Agent: GROUPS by rowFieldCol; AGGREGATES valueFieldCol; SKIPS blank group keys.
export function computePivotSummary(
  sheet: SheetData,
  range: CellRange,
  rowFieldCol: number,
  valueFieldCol: number,
  aggregation: PivotAggregation,
  skipHeaderRow = true,
): PivotSummaryResult {
  const normalized = normalizeRange(range);
  const startRow = skipHeaderRow ? normalized.start.row + 1 : normalized.start.row;
  const groups = new Map<string, number[]>();

  for (let row = startRow; row <= normalized.end.row; row += 1) {
    const groupKey = cellDisplayValue(sheet.rows[row]?.[rowFieldCol]).trim() || "(blank)";
    const numeric = numericFromCell(sheet.rows[row]?.[valueFieldCol]);
    if (numeric === null && aggregation !== "count") continue;
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(numeric ?? 0);
    groups.set(groupKey, bucket);
  }

  const aggregationLabel =
    aggregation === "average" ? "Average" : aggregation.charAt(0).toUpperCase() + aggregation.slice(1);
  const headers = ["Group", aggregationLabel];
  const rows = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupKey, values]) => [
      pivotCell(groupKey),
      pivotCell(aggregateValues(values, aggregation)),
    ]);

  return { headers, rows };
}
