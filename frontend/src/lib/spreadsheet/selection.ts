// Human: Cell range selection helpers for Excel-like multi-cell select.
// Agent: NORMALIZES anchor/end addresses; TESTS membership; FORMATS A1:B3 labels.

import { cellAddressLabel } from "@/lib/spreadsheet/cells";
import type { CellAddress } from "@/lib/spreadsheet/types";

export type CellRange = {
  start: CellAddress;
  end: CellAddress;
};

// Human: Order range corners so start is top-left and end is bottom-right.
// Agent: RETURNS normalized range for hit-testing and clipboard iteration.
export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  };
}

export function singleCellRange(address: CellAddress): CellRange {
  return { start: address, end: address };
}

export function isCellInRange(row: number, col: number, range: CellRange): boolean {
  const normalized = normalizeRange(range);
  return (
    row >= normalized.start.row &&
    row <= normalized.end.row &&
    col >= normalized.start.col &&
    col <= normalized.end.col
  );
}

export function rangeAddressLabel(range: CellRange): string {
  const normalized = normalizeRange(range);
  const startLabel = cellAddressLabel(normalized.start);
  const endLabel = cellAddressLabel(normalized.end);
  if (startLabel === endLabel) return startLabel;
  return `${startLabel}:${endLabel}`;
}

export function iterateRangeCells(
  range: CellRange,
  callback: (row: number, col: number) => void,
): void {
  const normalized = normalizeRange(range);
  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    for (let col = normalized.start.col; col <= normalized.end.col; col += 1) {
      callback(row, col);
    }
  }
}

export function rangeDimensions(range: CellRange): { rows: number; cols: number } {
  const normalized = normalizeRange(range);
  return {
    rows: normalized.end.row - normalized.start.row + 1,
    cols: normalized.end.col - normalized.start.col + 1,
  };
}

// Human: Entire worksheet selection — top-left through last row/column index.
// Agent: USED by the header corner button (Excel select-all control).
export function fullSheetRange(rowCount: number, columnCount: number): CellRange {
  const lastRow = Math.max(0, rowCount - 1);
  const lastCol = Math.max(0, columnCount - 1);
  return {
    start: { row: 0, col: 0 },
    end: { row: lastRow, col: lastCol },
  };
}

// Human: True when the normalized range covers every row and column in the grid.
// Agent: READS selection + grid bounds; TRIGGERS bulk row/column resize on drag.
export function isFullSheetSelection(range: CellRange, rowCount: number, columnCount: number): boolean {
  if (rowCount < 1 || columnCount < 1) return false;
  const normalized = normalizeRange(range);
  return (
    normalized.start.row === 0 &&
    normalized.start.col === 0 &&
    normalized.end.row === rowCount - 1 &&
    normalized.end.col === columnCount - 1
  );
}
