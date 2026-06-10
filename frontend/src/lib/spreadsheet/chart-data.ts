// Human: Extract numeric chart series from sheet ranges and embedded chart metadata.
// Agent: READS labels/values from cells; COERCES formatted strings; FALLBACK to OOXML cache.

import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetCell, SheetChart, SheetChartSeriesRef, SheetData } from "@/lib/spreadsheet/types";

export type ChartSeriesPoint = {
  label: string;
  value: number;
};

/** @deprecated Use ChartSeriesPoint — kept for existing imports. */
export type ChartBar = ChartSeriesPoint;

// Human: Parse a numeric value from a grid cell — mirrors status bar / pivot coercion.
// Agent: READS value then display; STRIPS currency/percent formatting before Number().
export function numericChartValue(cell: SheetCell | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const candidates = [cell.value, cell.display];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const parsed = Number(String(candidate).replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function cellLabel(cell: SheetCell | undefined, fallback: string): string {
  if (!cell) return fallback;
  const text = cell.display ?? cell.value;
  if (text === null || text === undefined || text === "") return fallback;
  return String(text);
}

// Human: Pick the rightmost column in a range that contains chartable numeric values.
// Agent: SCANS columns right-to-left; RETURNS column index or end col fallback.
function resolveValueColumn(sheet: Pick<SheetData, "rows">, range: CellRange): number {
  let valueCol = range.end.col;
  for (let col = range.end.col; col >= range.start.col; col -= 1) {
    let hasNumber = false;
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      if (numericChartValue(sheet.rows[row]?.[col]) !== null) {
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

function seriesOrientation(
  categoryRef: SheetChartSeriesRef,
  valueRef: SheetChartSeriesRef,
): "vertical" | "horizontal" {
  const catRowSpan = categoryRef.endRow - categoryRef.startRow;
  const catColSpan = categoryRef.endCol - categoryRef.startCol;
  const valRowSpan = valueRef.endRow - valueRef.startRow;
  const valColSpan = valueRef.endCol - valueRef.startCol;

  if (catRowSpan === 0 && valRowSpan === 0 && catColSpan > 0) return "horizontal";
  if (catColSpan === 0 && valColSpan === 0 && valRowSpan > 0) return "vertical";
  if (valColSpan > valRowSpan) return "horizontal";
  return "vertical";
}

// Human: Build chart points from explicit Excel category/value cell ranges.
// Agent: SUPPORTS vertical (labels in a column) and horizontal (labels in a row) layouts.
export function chartSeriesFromExplicitRefs(
  sheet: Pick<SheetData, "rows">,
  categoryRef: SheetChartSeriesRef,
  valueRef: SheetChartSeriesRef,
): ChartSeriesPoint[] {
  const orientation = seriesOrientation(categoryRef, valueRef);
  const points: ChartSeriesPoint[] = [];

  if (orientation === "horizontal") {
    for (let col = Math.min(categoryRef.startCol, valueRef.startCol); col <= Math.max(categoryRef.endCol, valueRef.endCol); col += 1) {
      const value = numericChartValue(sheet.rows[valueRef.startRow]?.[col]);
      if (value === null) continue;
      const label = cellLabel(sheet.rows[categoryRef.startRow]?.[col], `Col ${col + 1}`);
      points.push({ label, value });
    }
    return points;
  }

  for (let row = Math.min(categoryRef.startRow, valueRef.startRow); row <= Math.max(categoryRef.endRow, valueRef.endRow); row += 1) {
    const value = numericChartValue(sheet.rows[row]?.[valueRef.startCol]);
    if (value === null) continue;
    const label = cellLabel(sheet.rows[row]?.[categoryRef.startCol], `Row ${row + 1}`);
    points.push({ label, value });
  }

  return points;
}

// Human: Build chart series from any rectangular data range on the sheet.
// Agent: USES first column as labels; PICKS rightmost numeric column for values.
export function chartSeriesFromDataRange(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): ChartSeriesPoint[] {
  const normalized = normalizeRange(range);
  const valueCol = resolveValueColumn(sheet, normalized);
  const categoryRef: SheetChartSeriesRef = {
    startRow: normalized.start.row,
    startCol: normalized.start.col,
    endRow: normalized.end.row,
    endCol: normalized.start.col,
  };
  const valueRef: SheetChartSeriesRef = {
    startRow: normalized.start.row,
    startCol: valueCol,
    endRow: normalized.end.row,
    endCol: valueCol,
  };
  return chartSeriesFromExplicitRefs(sheet, categoryRef, valueRef);
}

// Human: Build chart series from the current selection — same rules as embedded charts.
// Agent: DELEGATES to chartSeriesFromDataRange after normalizing selection.
export function chartBarsFromSelection(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): ChartSeriesPoint[] {
  return chartSeriesFromDataRange(sheet, normalizeRange(range));
}

// Human: Category/value refs for OOXML export and embedded chart metadata.
// Agent: LABELS from first column; VALUES from rightmost numeric column in range.
export function chartSeriesRefsFromSelection(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): { categoryRef: SheetChartSeriesRef; valueRef: SheetChartSeriesRef; merged: CellRange } {
  const normalized = normalizeRange(range);
  const valueCol = resolveValueColumn(sheet, normalized);
  return {
    categoryRef: {
      startRow: normalized.start.row,
      startCol: normalized.start.col,
      endRow: normalized.end.row,
      endCol: normalized.start.col,
    },
    valueRef: {
      startRow: normalized.start.row,
      startCol: valueCol,
      endRow: normalized.end.row,
      endCol: valueCol,
    },
    merged: {
      start: { row: normalized.start.row, col: normalized.start.col },
      end: { row: normalized.end.row, col: valueCol },
    },
  };
}

/** @deprecated Use chartSeriesRefsFromSelection — kept for callers using merged bounds only. */
export function chartDataBoundsFromSelection(
  sheet: Pick<SheetData, "rows">,
  range: CellRange,
): CellRange {
  return chartSeriesRefsFromSelection(sheet, range).merged;
}

// Human: Resolve live series for an embedded chart using its stored data bounds.
// Agent: PREFERS categoryRef/valueRef; FALLBACK to merged bounds then OOXML cache.
export function chartSeriesFromChart(
  sheet: Pick<SheetData, "rows">,
  chart: SheetChart,
): ChartSeriesPoint[] {
  if (chart.categoryRef && chart.valueRef) {
    const points = chartSeriesFromExplicitRefs(sheet, chart.categoryRef, chart.valueRef);
    if (points.length > 0) return points;
  }

  const mergedPoints = chartSeriesFromDataRange(sheet, {
    start: { row: chart.dataStartRow, col: chart.dataStartCol },
    end: { row: chart.dataEndRow, col: chart.dataEndCol },
  });
  if (mergedPoints.length > 0) return mergedPoints;

  return chart.fallbackSeries ?? [];
}
