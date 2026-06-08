// Human: Copy, cut, and paste for spreadsheet cell ranges.
// Agent: READS/WRITES SheetCell blocks; SUPPORTS values-only paste mode.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { expandSheetToAddress } from "@/lib/spreadsheet/grid";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetCell, SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

export type ClipboardPayload = {
  cells: SheetCell[][];
  rows: number;
  cols: number;
};

function emptyCell(): SheetCell {
  return { value: null, display: "" };
}

function cloneCell(cell: SheetCell): SheetCell {
  return JSON.parse(JSON.stringify(cell)) as SheetCell;
}

// Human: Extract a rectangular block from the active sheet for clipboard storage.
// Agent: RETURNS cloned cells sized to normalized range dimensions.
export function copyRangeFromSheet(sheet: SheetData, range: CellRange): ClipboardPayload {
  const normalized = normalizeRange(range);
  const rows = normalized.end.row - normalized.start.row + 1;
  const cols = normalized.end.col - normalized.start.col + 1;
  const cells: SheetCell[][] = [];

  for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
    const rowCells: SheetCell[] = [];
    for (let colOffset = 0; colOffset < cols; colOffset += 1) {
      const row = normalized.start.row + rowOffset;
      const col = normalized.start.col + colOffset;
      const source = sheet.rows[row]?.[col] ?? emptyCell();
      rowCells.push(cloneCell(source));
    }
    cells.push(rowCells);
  }

  return { cells, rows, cols };
}

export type PasteMode = "all" | "values";

export type PasteOptions = {
  mode?: PasteMode;
  transpose?: boolean;
};

// Human: Swap rows/cols on a clipboard block for Paste Special → Transpose.
// Agent: RETURNS new ClipboardPayload with dimensions flipped.
export function transposeClipboardPayload(payload: ClipboardPayload): ClipboardPayload {
  const cells: SheetCell[][] = [];
  for (let col = 0; col < payload.cols; col += 1) {
    const rowCells: SheetCell[] = [];
    for (let row = 0; row < payload.rows; row += 1) {
      rowCells.push(payload.cells[row]?.[col] ?? emptyCell());
    }
    cells.push(rowCells);
  }
  return { cells, rows: payload.cols, cols: payload.rows };
}

// Human: Paste clipboard block starting at target cell; grows sheet as needed.
// Agent: WRITES cells into workbook; STRIPS formulas/styles when mode is values.
export function pasteRangeIntoWorkbook(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  target: { row: number; col: number },
  payload: ClipboardPayload,
  mode: PasteMode,
  transpose = false,
): SpreadsheetWorkbook {
  const effective = transpose ? transposeClipboardPayload(payload) : payload;
  const nextSheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;

    let expanded = sheet;
    const endRow = target.row + effective.rows - 1;
    const endCol = target.col + effective.cols - 1;
    expanded = expandSheetToAddress(expanded, endRow, endCol);

    const nextRows = expanded.rows.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const relRow = rowIndex - target.row;
        const relCol = colIndex - target.col;
        if (relRow < 0 || relCol < 0 || relRow >= effective.rows || relCol >= effective.cols) {
          return cell;
        }

        const source = effective.cells[relRow][relCol];
        if (mode === "values") {
          const value = source.formula ? source.value : source.value;
          return {
            ...cell,
            formula: undefined,
            value,
            display: formatCellDisplay(value, cell.style?.numberFormat ?? "general"),
          };
        }

        return cloneCell(source);
      }),
    );

    return { ...expanded, rows: nextRows };
  });

  return { sheets: nextSheets };
}

// Human: Clear source range after cut (values emptied, styles kept).
// Agent: CALLED after copy to clipboard during cut operation.
export function clearRangeInWorkbook(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  range: CellRange,
): SpreadsheetWorkbook {
  const nextSheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;

    const normalized = normalizeRange(range);
    const nextRows = sheet.rows.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const inRange =
          rowIndex >= normalized.start.row &&
          rowIndex <= normalized.end.row &&
          colIndex >= normalized.start.col &&
          colIndex <= normalized.end.col;
        if (!inRange) return cell;
        return { ...cell, value: null, formula: undefined, display: "" };
      }),
    );

    return { ...sheet, rows: nextRows };
  });

  return { sheets: nextSheets };
}

// Human: Serialize clipboard block to TSV for system clipboard API.
// Agent: USES display strings; TABS between cols, newlines between rows.
export function clipboardToTsv(payload: ClipboardPayload): string {
  return payload.cells.map((row) => row.map((cell) => cell.display).join("\t")).join("\n");
}

// Human: Parse TSV from system clipboard into a cell block.
// Agent: FALLBACK when internal clipboard empty; VALUES only.
export function tsvToClipboardPayload(text: string): ClipboardPayload {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cells = lines.map((line) =>
    line.split("\t").map((display) => {
      const trimmed = display.trim();
      const numeric = Number(trimmed.replace(/[$,%\s,]/g, ""));
      const value =
        trimmed === "" ? null : Number.isFinite(numeric) && trimmed !== "" ? numeric : trimmed;
      return {
        value,
        display: trimmed,
      };
    }),
  );
  const rows = cells.length;
  const cols = Math.max(...cells.map((row) => row.length), 1);
  return { cells, rows, cols };
}
