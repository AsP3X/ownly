// Human: Extract numeric chart series from a selected sheet range for Insert Chart.
// Agent: READS labels from first column/header; VALUES from selected numeric column.

import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetChart, SheetData } from "@/lib/spreadsheet/types";

export type ChartSeriesPoint = {
  label: string;
  value: number;
};

/** @deprecated Use ChartSeriesPoint — kept for existing imports. */
export type ChartBar = ChartSeriesPoint;

// Human: Pick the rightmost column in a range that contains numeric values.
// Agent: SCANS columns right-to-left; RETURNS column index or start col fallback.
function resolveValueColumn(sheet: Pick<SheetData, "rows">, range: CellRange): number {
  let valueCol = range.end.col;
  for (let col = range.end.col; col >= range.start.col; col -= 1) {
    let hasNumber = false;
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      const value = sheet.rows[row]?.[col]?.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        hasNumber = true;
        break;
      }
    }
    if (hasNumber) {
      valueCol = col;
      break;
    }
  }
  return valueCol;
}

// Human: Build chart series from any rectangular data range on the sheet.
// Agent: USES first column as labels; PICKS rightmost numeric column for values.
export function chartSeriesFromDataRange(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): ChartSeriesPoint[] {
  const normalized = normalizeRange(range);
  const valueCol = resolveValueColumn(sheet, normalized);
  const labelCol = normalized.start.col;
  const points: ChartSeriesPoint[] = [];

  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    const rawValue = sheet.rows[row]?.[valueCol]?.value;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
    const label =
      String(sheet.rows[row]?.[labelCol]?.display ?? sheet.rows[row]?.[labelCol]?.value ?? `Row ${row + 1}`);
    points.push({ label, value: rawValue });
  }

  return points;
}

// Human: Build chart series from the current selection — same rules as embedded charts.
// Agent: DELEGATES to chartSeriesFromDataRange after normalizing selection.
export function chartBarsFromSelection(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): ChartSeriesPoint[] {
  return chartSeriesFromDataRange(sheet, normalizeRange(range));
}

// Human: Resolve live series for an embedded chart using its stored data bounds.
// Agent: READS chart.dataStart/End*; RETURNS points for SVG overlay refresh on edit.
export function chartSeriesFromChart(
  sheet: Pick<SheetData, "rows">,
  chart: SheetChart,
): ChartSeriesPoint[] {
  return chartSeriesFromDataRange(sheet, {
    start: { row: chart.dataStartRow, col: chart.dataStartCol },
    end: { row: chart.dataEndRow, col: chart.dataEndCol },
  });
}

// Human: Normalize a selection into chart category/value bounds for OOXML export.
// Agent: LABELS from first column; VALUES from rightmost numeric column in range.
export function chartDataBoundsFromSelection(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): CellRange {
  const normalized = normalizeRange(range);
  const valueCol = resolveValueColumn(sheet, normalized);
  return {
    start: { row: normalized.start.row, col: normalized.start.col },
    end: { row: normalized.end.row, col: valueCol },
  };
}
