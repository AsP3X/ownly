// Human: Drag-fill logic — copy source range into extended target with optional numeric series.
// Agent: READS source cells; WRITES target cells; USED by grid fill handle on pointer up.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { expandSheetToAddress } from "@/lib/spreadsheet/grid";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetCell, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

function cloneCell(cell: SheetCell): SheetCell {
  return JSON.parse(JSON.stringify(cell)) as SheetCell;
}

function cellNumericStep(values: Array<number | null>): number | null {
  if (values.length < 2) return null;
  const steps = new Set<number>();
  for (let index = 1; index < values.length; index += 1) {
    const prev = values[index - 1];
    const next = values[index];
    if (prev === null || next === null) return null;
    steps.add(next - prev);
  }
  return steps.size === 1 ? [...steps][0] : null;
}

function fillValueForOffset(
  sourceCells: SheetCell[],
  offset: number,
  axisLength: number,
): SheetCell {
  if (sourceCells.length === 0) return { value: null, display: "" };
  const index = offset % axisLength;
  const base = sourceCells[index] ?? sourceCells[sourceCells.length - 1];
  const numericSeries = sourceCells
    .map((cell) => (typeof cell.value === "number" ? cell.value : null))
    .filter((value): value is number => value !== null);
  const step = cellNumericStep(numericSeries);

  if (step !== null && typeof base.value === "number") {
    const cycles = Math.floor(offset / axisLength);
    const value = base.value + step * (cycles * axisLength + index);
    return {
      ...cloneCell(base),
      formula: undefined,
      value,
      display: formatCellDisplay(value, base.style?.numberFormat ?? "general"),
    };
  }

  return cloneCell(base);
}

// Human: Fill target range using source pattern — supports vertical/horizontal extension.
// Agent: MERGES normalized source+target bounding box; COPIES/increments into new cells.
export function fillRangeInWorkbook(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  sourceRange: CellRange,
  targetRange: CellRange,
): SpreadsheetWorkbook {
  const source = normalizeRange(sourceRange);
  const target = normalizeRange(targetRange);
  const bounds = normalizeRange({
    start: {
      row: Math.min(source.start.row, target.start.row),
      col: Math.min(source.start.col, target.start.col),
    },
    end: {
      row: Math.max(source.end.row, target.end.row),
      col: Math.max(source.end.col, target.end.col),
    },
  });

  const sourceRows = source.end.row - source.start.row + 1;
  const sourceCols = source.end.col - source.start.col + 1;

  const nextSheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;

    const expanded = expandSheetToAddress(sheet, bounds.end.row, bounds.end.col);
    const nextRows = expanded.rows.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const inSource =
          rowIndex >= source.start.row &&
          rowIndex <= source.end.row &&
          colIndex >= source.start.col &&
          colIndex <= source.end.col;
        if (inSource) return cell;

        const inTarget =
          rowIndex >= bounds.start.row &&
          rowIndex <= bounds.end.row &&
          colIndex >= bounds.start.col &&
          colIndex <= bounds.end.col;
        if (!inTarget) return cell;

        const rowOffset = rowIndex - source.start.row;
        const colOffset = colIndex - source.start.col;

        if (bounds.end.row > source.end.row && colIndex >= source.start.col && colIndex <= source.end.col) {
          const columnCells = Array.from({ length: sourceRows }, (_, offset) =>
            expanded.rows[source.start.row + offset]?.[colIndex] ?? { value: null, display: "" },
          );
          return fillValueForOffset(columnCells, rowOffset, sourceRows);
        }

        if (bounds.end.col > source.end.col && rowIndex >= source.start.row && rowIndex <= source.end.row) {
          const rowCells = Array.from({ length: sourceCols }, (_, offset) =>
            expanded.rows[rowIndex]?.[source.start.col + offset] ?? { value: null, display: "" },
          );
          return fillValueForOffset(rowCells, colOffset, sourceCols);
        }

        return cell;
      }),
    );

    return { ...expanded, rows: nextRows };
  });

  return { sheets: nextSheets };
}

// Human: Build target range when user drags fill handle to a new cell corner.
// Agent: EXTENDS selection along dominant axis toward dragEnd.
export function fillTargetRange(sourceRange: CellRange, dragEnd: { row: number; col: number }): CellRange | null {
  const source = normalizeRange(sourceRange);
  if (dragEnd.row <= source.end.row && dragEnd.col <= source.end.col) return null;

  const extendRows = dragEnd.row > source.end.row;
  const extendCols = dragEnd.col > source.end.col;

  if (extendRows && (!extendCols || dragEnd.row - source.end.row >= dragEnd.col - source.end.col)) {
    return normalizeRange({
      start: source.start,
      end: { row: dragEnd.row, col: source.end.col },
    });
  }

  if (extendCols) {
    return normalizeRange({
      start: source.start,
      end: { row: source.end.row, col: dragEnd.col },
    });
  }

  return null;
}
