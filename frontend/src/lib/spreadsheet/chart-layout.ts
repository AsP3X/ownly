// Human: Map sheet chart anchors to grid pixel coordinates for overlay rendering.
// Agent: READS columnWidths/rowHeights; RETURNS x/y offsets and span sizes.

import {
  GRID_DEFAULT_COL_WIDTH,
  GRID_DEFAULT_ROW_HEIGHT,
  GRID_HEADER_ROW_HEIGHT,
  GRID_ROW_INDEX_WIDTH,
} from "@/lib/spreadsheet/dimensions";
import type { SheetChart } from "@/lib/spreadsheet/types";

const DEFAULT_CHART_COL_SPAN = 8;
const DEFAULT_CHART_ROW_SPAN = 12;

// Human: Sum leading column widths up to (but not including) the anchor column.
// Agent: USED for chart overlay translate-x inside the grid scroll area.
export function columnOffsetPx(columnWidths: number[], colIndex: number): number {
  let offset = 0;
  for (let index = 0; index < colIndex; index += 1) {
    offset += columnWidths[index] ?? GRID_DEFAULT_COL_WIDTH;
  }
  return offset;
}

// Human: Sum leading row heights up to (but not including) the anchor row.
// Agent: USED for chart overlay translate-y below the column header row.
export function rowOffsetPx(rowHeights: number[], rowIndex: number): number {
  let offset = GRID_HEADER_ROW_HEIGHT;
  for (let index = 0; index < rowIndex; index += 1) {
    offset += rowHeights[index] ?? GRID_DEFAULT_ROW_HEIGHT;
  }
  return offset;
}

// Human: Span width between two column indices (inclusive of start, exclusive of end+1).
// Agent: READS resolved columnWidths array from the grid.
export function columnSpanWidthPx(columnWidths: number[], startCol: number, endCol: number): number {
  let width = 0;
  for (let col = startCol; col <= endCol; col += 1) {
    width += columnWidths[col] ?? GRID_DEFAULT_COL_WIDTH;
  }
  return Math.max(width, GRID_DEFAULT_COL_WIDTH * 2);
}

// Human: Span height between two row indices (inclusive).
// Agent: READS resolved rowHeights array from the grid.
export function rowSpanHeightPx(rowHeights: number[], startRow: number, endRow: number): number {
  let height = 0;
  for (let row = startRow; row <= endRow; row += 1) {
    height += rowHeights[row] ?? GRID_DEFAULT_ROW_HEIGHT;
  }
  return Math.max(height, GRID_DEFAULT_ROW_HEIGHT * 2);
}

export type ChartLayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Human: Resolve on-grid position and size for one embedded chart.
// Agent: PREFERS two-cell anchor span; FALLS BACK to widthPx/heightPx or Excel-like defaults.
export function chartLayoutRect(
  chart: SheetChart,
  columnWidths: number[],
  rowHeights: number[],
): ChartLayoutRect {
  const x = GRID_ROW_INDEX_WIDTH + columnOffsetPx(columnWidths, chart.anchorCol);
  const y = rowOffsetPx(rowHeights, chart.anchorRow);

  if (
    typeof chart.anchorEndRow === "number" &&
    typeof chart.anchorEndCol === "number" &&
    chart.anchorEndRow >= chart.anchorRow &&
    chart.anchorEndCol >= chart.anchorCol
  ) {
    return {
      x,
      y,
      width: columnSpanWidthPx(columnWidths, chart.anchorCol, chart.anchorEndCol),
      height: rowSpanHeightPx(rowHeights, chart.anchorRow, chart.anchorEndRow),
    };
  }

  const defaultWidth = columnSpanWidthPx(
    columnWidths,
    chart.anchorCol,
    chart.anchorCol + DEFAULT_CHART_COL_SPAN - 1,
  );
  const defaultHeight = rowSpanHeightPx(
    rowHeights,
    chart.anchorRow,
    chart.anchorRow + DEFAULT_CHART_ROW_SPAN - 1,
  );

  return {
    x,
    y,
    width: chart.widthPx ?? defaultWidth,
    height: chart.heightPx ?? defaultHeight,
  };
}
