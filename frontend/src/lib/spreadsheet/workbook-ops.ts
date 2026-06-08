// Human: Structural workbook mutations — sheets, rows, columns, sort, filter.
// Agent: RETURNS new SpreadsheetWorkbook snapshots for undo integration.

import { csvTextToSheet } from "@/lib/spreadsheet/csv-import";
import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import type { DataValidationRule } from "@/lib/spreadsheet/data-validation";
import { expandSheetToAddress, GRID_MIN_COLUMN_COUNT, GRID_MIN_ROW_COUNT, normalizeSheetGrid } from "@/lib/spreadsheet/grid";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetCell, SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

function emptyCell(): SheetCell {
  return { value: null, display: "" };
}

function emptyRow(cols: number): SheetCell[] {
  return Array.from({ length: cols }, () => emptyCell());
}

function padRows(rows: SheetCell[][], minRows: number, minCols: number): SheetCell[][] {
  const cols = Math.max(minCols, ...rows.map((row) => row.length), 1);
  const next = rows.map((row) => {
    const copy = [...row];
    while (copy.length < cols) copy.push(emptyCell());
    return copy;
  });
  while (next.length < minRows) next.push(emptyRow(cols));
  return next;
}

export function addSheet(workbook: SpreadsheetWorkbook, name?: string): SpreadsheetWorkbook {
  const baseName = name ?? `Sheet${workbook.sheets.length + 1}`;
  const sheet = normalizeSheetGrid({
    name: baseName,
    rows: [[emptyCell()]],
  });
  return { sheets: [...workbook.sheets, sheet] };
}

export function removeSheet(workbook: SpreadsheetWorkbook, sheetIndex: number): SpreadsheetWorkbook {
  if (workbook.sheets.length <= 1) return workbook;
  return { sheets: workbook.sheets.filter((_, index) => index !== sheetIndex) };
}

export function renameSheet(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  name: string,
): SpreadsheetWorkbook {
  const trimmed = name.trim();
  if (!trimmed) return workbook;
  return {
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex ? { ...sheet, name: trimmed } : sheet,
    ),
  };
}

export function insertRow(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  atRow: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const colCount = Math.max(...sheet.rows.map((row) => row.length), GRID_MIN_COLUMN_COUNT);
      const nextRows = [...sheet.rows];
      nextRows.splice(atRow, 0, emptyRow(colCount));
      const rowHeights = sheet.rowHeights ? [...sheet.rowHeights] : undefined;
      rowHeights?.splice(atRow, 0, rowHeights[atRow] ?? rowHeights[atRow - 1] ?? 24);
      return { ...sheet, rows: padRows(nextRows, GRID_MIN_ROW_COUNT, colCount), rowHeights };
    }),
  };
}

export function deleteRow(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  atRow: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      if (sheet.rows.length <= 1) return sheet;
      const nextRows = sheet.rows.filter((_, rowIndex) => rowIndex !== atRow);
      const rowHeights = sheet.rowHeights?.filter((_, rowIndex) => rowIndex !== atRow);
      return { ...sheet, rows: nextRows, rowHeights };
    }),
  };
}

export function insertColumn(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  atCol: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const nextRows = sheet.rows.map((row) => {
        const copy = [...row];
        copy.splice(atCol, 0, emptyCell());
        return copy;
      });
      const columnWidths = sheet.columnWidths ? [...sheet.columnWidths] : undefined;
      columnWidths?.splice(atCol, 0, columnWidths[atCol] ?? columnWidths[atCol - 1] ?? 80);
      return { ...sheet, rows: nextRows, columnWidths };
    }),
  };
}

export function deleteColumn(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  atCol: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const nextRows = sheet.rows.map((row) => {
        if (row.length <= 1) return row;
        return row.filter((_, colIndex) => colIndex !== atCol);
      });
      const columnWidths = sheet.columnWidths?.filter((_, colIndex) => colIndex !== atCol);
      return { ...sheet, rows: nextRows, columnWidths };
    }),
  };
}

export type SortDirection = "asc" | "desc";

// Human: Sort rows by a column value, keeping header row (row 0) fixed.
// Agent: MUTATES copy; NUMERIC compare when both sides numeric.
export function sortSheetByColumn(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  colIndex: number,
  direction: SortDirection,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const header = sheet.rows[0] ? [sheet.rows[0]] : [];
      const body = sheet.rows.slice(1);
      const sorted = [...body].sort((rowA, rowB) => {
        const a = rowA[colIndex]?.value ?? rowA[colIndex]?.display ?? "";
        const b = rowB[colIndex]?.value ?? rowB[colIndex]?.display ?? "";
        const numA = Number(a);
        const numB = Number(b);
        const bothNumeric = Number.isFinite(numA) && Number.isFinite(numB);
        const cmp = bothNumeric
          ? numA - numB
          : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
        return direction === "asc" ? cmp : -cmp;
      });
      return { ...sheet, rows: [...header, ...sorted] };
    }),
  };
}

export type FilterMode = "clear" | "nonEmpty";

// Human: Hide rows that do not match filter — stores hidden flag on row 0 metadata via display prefix.
// Agent: SIMPLE filter marks non-matching rows with empty overlay row skip in grid via filterHiddenRows set.
export function applyColumnFilter(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  colIndex: number,
  query: string,
): SpreadsheetWorkbook & { filterHiddenRows?: Set<number> } {
  const normalizedQuery = query.trim().toLowerCase();
  const hidden = new Set<number>();

  const sheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;
    sheet.rows.forEach((row, rowIndex) => {
      if (rowIndex === 0) return;
      const display = String(row[colIndex]?.display ?? "").toLowerCase();
      if (normalizedQuery && !display.includes(normalizedQuery)) hidden.add(rowIndex);
    });
    return sheet;
  });

  return { sheets, filterHiddenRows: hidden };
}

export function findInSheet(
  sheet: SheetData,
  query: string,
  start: { row: number; col: number },
): { row: number; col: number } | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const rows = sheet.rows.length;
  const cols = Math.max(...sheet.rows.map((row) => row.length), 1);

  for (let offset = 0; offset < rows * cols; offset += 1) {
    const flat = (start.row * cols + start.col + offset + 1) % (rows * cols);
    const row = Math.floor(flat / cols);
    const col = flat % cols;
    const display = String(sheet.rows[row]?.[col]?.display ?? "").toLowerCase();
    if (display.includes(normalized)) return { row, col };
  }
  return null;
}

export function replaceInWorkbook(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  range: CellRange | null,
  findText: string,
  replaceText: string,
  replaceAll: boolean,
): SpreadsheetWorkbook {
  const findLower = findText.toLowerCase();
  if (!findLower) return workbook;

  let replaced = false;
  const nextSheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;

    const nextRows = sheet.rows.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const inRange = range ? normalizeRange(range) : null;
        if (inRange) {
          const inside =
            rowIndex >= inRange.start.row &&
            rowIndex <= inRange.end.row &&
            colIndex >= inRange.start.col &&
            colIndex <= inRange.end.col;
          if (!inside) return cell;
        }

        const display = cell.display ?? "";
        if (!display.toLowerCase().includes(findLower)) return cell;
        if (replaced && !replaceAll) return cell;

        const nextDisplay = display.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replaceText);
        replaced = true;
        const numeric = Number(nextDisplay.replace(/[$,%\s,]/g, ""));
        const value =
          nextDisplay === "" ? null : Number.isFinite(numeric) && nextDisplay !== "" ? numeric : nextDisplay;
        return {
          ...cell,
          formula: undefined,
          value,
          display: formatCellDisplay(value, cell.style?.numberFormat ?? "general"),
        };
      }),
    );

    return { ...sheet, rows: nextRows };
  });

  return { sheets: nextSheets };
}

export function mergeCellsInRange(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  range: CellRange,
): SpreadsheetWorkbook {
  const normalized = normalizeRange(range);
  const nextSheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;

    const topLeft = sheet.rows[normalized.start.row]?.[normalized.start.col] ?? emptyCell();
    const mergedDisplay = topLeft.display;
    const nextRows = sheet.rows.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const inRange =
          rowIndex >= normalized.start.row &&
          rowIndex <= normalized.end.row &&
          colIndex >= normalized.start.col &&
          colIndex <= normalized.end.col;
        if (!inRange) return cell;
        if (rowIndex === normalized.start.row && colIndex === normalized.start.col) {
          return {
            ...cell,
            display: mergedDisplay,
            style: { ...cell.style, horizontalAlign: "center" as const },
          };
        }
        return { ...cell, value: null, formula: undefined, display: "" };
      }),
    );
    return { ...sheet, rows: nextRows };
  });
  return { sheets: nextSheets };
}

// Human: Remove duplicate data rows keyed by a column value (header row preserved).
// Agent: KEEPS first occurrence; COMPARES display/value text in chosen column.
export function removeDuplicateRows(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  columnIndex: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;

      const header = sheet.rows[0] ? [sheet.rows[0]] : [];
      const seen = new Set<string>();
      const body = sheet.rows.slice(1).filter((row) => {
        const key = String(row[columnIndex]?.display ?? row[columnIndex]?.value ?? "").toLowerCase();
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { ...sheet, rows: [...header, ...body] };
    }),
  };
}

// Human: Move a sheet tab to a new index for reordering.
// Agent: SPLICES sheets array; USED by tab drag or menu (future).
export function moveSheet(
  workbook: SpreadsheetWorkbook,
  fromIndex: number,
  toIndex: number,
): SpreadsheetWorkbook {
  if (fromIndex === toIndex) return workbook;
  const sheets = [...workbook.sheets];
  const [sheet] = sheets.splice(fromIndex, 1);
  if (!sheet) return workbook;
  sheets.splice(toIndex, 0, sheet);
  return { sheets };
}

// Human: Compute the active tab index after reordering sheets by drag-and-drop.
// Agent: ADJUSTS index when another tab moves past the active tab.
export function activeSheetIndexAfterMove(active: number, fromIndex: number, toIndex: number): number {
  if (active === fromIndex) return toIndex;
  if (fromIndex < toIndex) {
    if (active > fromIndex && active <= toIndex) return active - 1;
  } else if (fromIndex > toIndex) {
    if (active >= toIndex && active < fromIndex) return active + 1;
  }
  return active;
}

// Human: Set freeze panes at the active cell — rows above and columns left stay fixed.
// Agent: WRITES frozenRows/frozenCols on active sheet from cell address.
export function freezePanesAt(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  row: number,
  col: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex ? { ...sheet, frozenRows: row, frozenCols: col } : sheet,
    ),
  };
}

export function unfreezePanes(workbook: SpreadsheetWorkbook, sheetIndex: number): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex ? { ...sheet, frozenRows: 0, frozenCols: 0 } : sheet,
    ),
  };
}

// Human: Append CSV/TSV import as a new sheet tab.
// Agent: PARSES text via csvTextToSheet; RETURNS workbook with extra sheet.
export function importCsvAsNewSheet(
  workbook: SpreadsheetWorkbook,
  csvText: string,
  sheetName: string,
): SpreadsheetWorkbook {
  const sheet = csvTextToSheet(csvText, sheetName);
  return { sheets: [...workbook.sheets, sheet] };
}

// Human: Set or clear a data validation rule on a column.
// Agent: WRITES columnValidations map entry; UNDO via commitWorkbookMutation.
export function setColumnValidation(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  colIndex: number,
  rule: DataValidationRule | null,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const nextValidations = { ...(sheet.columnValidations ?? {}) };
      if (rule) nextValidations[colIndex] = rule;
      else delete nextValidations[colIndex];
      return {
        ...sheet,
        columnValidations: Object.keys(nextValidations).length > 0 ? nextValidations : undefined,
      };
    }),
  };
}

// Human: Attach or remove a comment note on a single cell.
// Agent: EXPANDS sheet grid; WRITES SheetCell.comment string.
export function setCellComment(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  row: number,
  col: number,
  comment: string | null,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const expanded = expandSheetToAddress(sheet, row, col);
      const nextRows = expanded.rows.map((sheetRow, rowIndex) =>
        sheetRow.map((cell, colIndex) => {
          if (rowIndex !== row || colIndex !== col) return cell;
          const trimmed = comment?.trim() ?? "";
          if (!trimmed) {
            const nextCell = { ...cell };
            delete nextCell.comment;
            return nextCell;
          }
          return { ...cell, comment: trimmed };
        }),
      );
      return { ...sheet, rows: nextRows };
    }),
  };
}
