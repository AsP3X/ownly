// Human: Excel-like sheet grid bounds — empty rows/cols beyond used data for adding cells.
// Agent: PADS SheetData on load/edit; TRIMS trailing empties before xlsx serialize.

import {
  GRID_DEFAULT_COL_WIDTH,
  lastNonDefaultColumnIndex,
  lastNonDefaultRowIndex,
  resolveColumnWidths,
  resolveRowHeights,
  storedCustomColumnExtent,
  storedCustomRowExtent,
} from "@/lib/spreadsheet/dimensions";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";

// Human: Excel shows columns A–Z at minimum; rows scroll far below the used range.
// Agent: MIN bounds applied on load; PADDING added beyond last non-empty cell.
export const GRID_MIN_COLUMN_COUNT = 26;
export const GRID_MIN_ROW_COUNT = 500;
export const GRID_PADDING_COLUMNS = 10;
export const GRID_PADDING_ROWS = 50;

// Human: Canonical empty cell for padded grid slots.
// Agent: REUSED when extending rows/cols; NOT written on save when trailing.
export const EMPTY_SHEET_CELL: SheetCell = { value: null, display: "" };

// Human: True when a cell carries data, a formula, or user-applied style.
// Agent: USED to find the used range for trim and padding calculations.
export function cellHasContent(cell: SheetCell | undefined): boolean {
  if (!cell) return false;
  if (cell.formula) return true;
  if (cell.value !== null && cell.value !== "") return true;
  if (cell.style && Object.keys(cell.style).length > 0) return true;
  return false;
}

function rowHasContent(row: SheetCell[] | undefined): boolean {
  if (!row) return false;
  return row.some((cell) => cellHasContent(cell));
}

// Human: Index after the last column that contains any content (0 if sheet is empty).
// Agent: SCANS rows right-to-left per row; RETURNS max occupied column count.
export function usedColumnCount(rows: SheetCell[][]): number {
  let maxCol = 0;
  for (const row of rows) {
    for (let col = row.length - 1; col >= 0; col -= 1) {
      if (cellHasContent(row[col])) {
        maxCol = Math.max(maxCol, col + 1);
        break;
      }
    }
  }
  return maxCol;
}

// Human: Index after the last row that contains any content (0 if sheet is empty).
// Agent: SCANS rows bottom-up; RETURNS occupied row count.
export function usedRowCount(rows: SheetCell[][]): number {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    if (rowHasContent(rows[rowIndex])) return rowIndex + 1;
  }
  return 0;
}

// Human: Target column count for the interactive grid (min A–Z + padding past data).
// Agent: RETURNS max(26, usedCols + 10, explicit width, resized column metadata).
export function targetGridColumnCount(rows: SheetCell[][], columnWidths?: number[]): number {
  const usedCols = usedColumnCount(rows);
  const structuralCols = Math.max(...rows.map((row) => row.length), 0);
  const dimensionCols = storedCustomColumnExtent(columnWidths);
  return Math.max(GRID_MIN_COLUMN_COUNT, usedCols + GRID_PADDING_COLUMNS, structuralCols, dimensionCols);
}

// Human: Target row count for the interactive grid (min 500 + padding past data).
// Agent: RETURNS max(500, usedRows + 50, current row array length, resized row metadata).
export function targetGridRowCount(rows: SheetCell[][], rowHeights?: number[]): number {
  const usedRows = usedRowCount(rows);
  const dimensionRows = storedCustomRowExtent(rowHeights);
  return Math.max(GRID_MIN_ROW_COUNT, usedRows + GRID_PADDING_ROWS, rows.length, dimensionRows);
}

function padRow(row: SheetCell[], columnCount: number): SheetCell[] {
  const next = [...row];
  while (next.length < columnCount) {
    next.push({ ...EMPTY_SHEET_CELL });
  }
  return next.slice(0, columnCount);
}

// Human: Grow row/column arrays with empty cells and default dimension metadata.
// Agent: WRITES rows, columnWidths, rowHeights to at least rowCount × columnCount.
export function padSheetToSize(sheet: SheetData, rowCount: number, columnCount: number): SheetData {
  const nextRows = Array.from({ length: rowCount }, (_, rowIndex) =>
    padRow(sheet.rows[rowIndex] ?? [], columnCount),
  );

  const nextColumnWidths = resolveColumnWidths(sheet, columnCount);
  for (let colIndex = nextColumnWidths.length; colIndex < columnCount; colIndex += 1) {
    nextColumnWidths[colIndex] = GRID_DEFAULT_COL_WIDTH;
  }

  const nextRowHeights = resolveRowHeights(sheet, rowCount);

  return {
    ...sheet,
    rows: nextRows,
    columnWidths: nextColumnWidths,
    rowHeights: nextRowHeights,
  };
}

// Human: After import, pad sheet to Excel-like working area so users can add cells anywhere.
// Agent: CALLS padSheetToSize with targetGridRow/ColumnCount.
export function normalizeSheetGrid(sheet: SheetData): SheetData {
  return padSheetToSize(
    sheet,
    targetGridRowCount(sheet.rows, sheet.rowHeights),
    targetGridColumnCount(sheet.rows, sheet.columnWidths),
  );
}

// Human: Before editing a cell, ensure the grid covers the address plus scroll padding.
// Agent: EXPANDS rows/cols when formula bar targets beyond current padded bounds.
export function expandSheetToAddress(sheet: SheetData, row: number, col: number): SheetData {
  const rowCount = Math.max(targetGridRowCount(sheet.rows, sheet.rowHeights), row + 1 + GRID_PADDING_ROWS);
  const columnCount = Math.max(
    targetGridColumnCount(sheet.rows, sheet.columnWidths),
    col + 1 + GRID_PADDING_COLUMNS,
  );
  return padSheetToSize(sheet, rowCount, columnCount);
}

// Human: Strip trailing empty rows/columns before writing xlsx (keeps file size small).
// Agent: TRIMS to used range; RETURNS single empty cell when sheet has no content.
export function trimSheetForSave(sheet: SheetData): SheetData {
  const maxRow = Math.max(
    usedRowCount(sheet.rows) - 1,
    lastNonDefaultRowIndex(sheet.rowHeights),
  );
  const maxCol = Math.max(
    usedColumnCount(sheet.rows) - 1,
    lastNonDefaultColumnIndex(sheet.columnWidths),
  );

  if (maxRow < 0 || maxCol < 0) {
    return { ...sheet, rows: [[{ ...EMPTY_SHEET_CELL }]], columnWidths: undefined, rowHeights: undefined };
  }

  const rowCount = maxRow + 1;
  const columnCount = maxCol + 1;
  const rows = sheet.rows.slice(0, rowCount).map((row) => padRow(row, columnCount));

  return {
    ...sheet,
    rows,
    columnWidths: sheet.columnWidths?.slice(0, columnCount),
    rowHeights: sheet.rowHeights?.slice(0, rowCount),
  };
}
