// Human: Structural workbook mutations — sheets, rows, columns, sort, filter.
// Agent: RETURNS new SpreadsheetWorkbook snapshots for undo integration.

import { csvTextToSheet } from "@/lib/spreadsheet/csv-import";
import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import type { DataValidationRule } from "@/lib/spreadsheet/data-validation";
import { expandSheetToAddress, GRID_MIN_COLUMN_COUNT, GRID_MIN_ROW_COUNT, normalizeSheetGrid } from "@/lib/spreadsheet/grid";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { PivotSummaryResult } from "@/lib/spreadsheet/pivot-summary";
import type { NamedRange } from "@/lib/spreadsheet/named-ranges";
import { upsertMergedRegion, removeMergesIntersecting } from "@/lib/spreadsheet/merge-regions";
import type {
  PageMargins,
  PageSetup,
  SheetCell,
  SheetChart,
  SheetData,
  SheetProtection,
  SpreadsheetWorkbook,
  TrackChangeEntry,
} from "@/lib/spreadsheet/types";

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
    const mergedRegions = upsertMergedRegion(
      removeMergesIntersecting(
        sheet.mergedRegions,
        normalized.start.row,
        normalized.start.col,
        normalized.end.row,
        normalized.end.col,
      ),
      {
        startRow: normalized.start.row,
        startCol: normalized.start.col,
        endRow: normalized.end.row,
        endCol: normalized.end.col,
      },
    );
    return { ...sheet, rows: nextRows, mergedRegions };
  });
  return { sheets: nextSheets };
}

// Human: Clear merge metadata and restore inner cell placeholders for a range.
// Agent: REMOVES intersecting mergedRegions; USED by unmerge ribbon action.
export function unmergeCellsInRange(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  range: CellRange,
): SpreadsheetWorkbook {
  const normalized = normalizeRange(range);
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      return {
        ...sheet,
        mergedRegions: removeMergesIntersecting(
          sheet.mergedRegions,
          normalized.start.row,
          normalized.start.col,
          normalized.end.row,
          normalized.end.col,
        ),
      };
    }),
  };
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

// Human: Format a selected range as an Excel-style table with header + banded rows.
// Agent: APPLIES styles; APPENDS SpreadsheetTable metadata on the active sheet.
export function formatRangeAsTable(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  range: CellRange,
  tableName: string,
): SpreadsheetWorkbook {
  const normalized = normalizeRange(range);
  const trimmedName = tableName.trim() || `Table${(workbook.sheets[sheetIndex]?.tables?.length ?? 0) + 1}`;

  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;

      const nextRows = sheet.rows.map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          const inRange =
            rowIndex >= normalized.start.row &&
            rowIndex <= normalized.end.row &&
            colIndex >= normalized.start.col &&
            colIndex <= normalized.end.col;
          if (!inRange) return cell;

          const isHeader = rowIndex === normalized.start.row;
          const bandIndex = rowIndex - normalized.start.row;
          const style = {
            ...cell.style,
            bold: isHeader ? true : cell.style?.bold,
            textColor: isHeader ? "#FFFFFF" : cell.style?.textColor,
            backgroundColor: isHeader
              ? "#1F4E79"
              : bandIndex % 2 === 1
                ? "#DEEBF7"
                : "#FFFFFF",
          };

          return { ...cell, style };
        }),
      );

      const tables = [...(sheet.tables ?? []), {
        name: trimmedName,
        startRow: normalized.start.row,
        startCol: normalized.start.col,
        endRow: normalized.end.row,
        endCol: normalized.end.col,
      }];

      return { ...sheet, rows: nextRows, tables };
    }),
  };
}

// Human: Add or replace a workbook-level named range from the current selection.
// Agent: WRITES namedRanges array used by formulas + OOXML export.
export function setNamedRange(workbook: SpreadsheetWorkbook, range: NamedRange): SpreadsheetWorkbook {
  const existing = workbook.namedRanges ?? [];
  const without = existing.filter((entry) => entry.name.toLowerCase() !== range.name.toLowerCase());
  return { ...workbook, namedRanges: [...without, range] };
}

export function removeNamedRange(workbook: SpreadsheetWorkbook, name: string): SpreadsheetWorkbook {
  const existing = workbook.namedRanges ?? [];
  const normalized = name.trim().toLowerCase();
  const next = existing.filter((entry) => entry.name.toLowerCase() !== normalized);
  return { ...workbook, namedRanges: next.length > 0 ? next : undefined };
}

// Human: Set the printable region on a sheet from the current selection.
// Agent: WRITES printArea bounds exported as _xlnm.Print_Area.
export function setPrintArea(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  range: CellRange,
): SpreadsheetWorkbook {
  const normalized = normalizeRange(range);
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex
        ? {
            ...sheet,
            printArea: {
              startRow: normalized.start.row,
              startCol: normalized.start.col,
              endRow: normalized.end.row,
              endCol: normalized.end.col,
            },
          }
        : sheet,
    ),
  };
}

// Human: Clear the printable region on a sheet.
// Agent: REMOVES printArea so export omits Print_Area defined name.
export function clearPrintArea(workbook: SpreadsheetWorkbook, sheetIndex: number): SpreadsheetWorkbook {
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const next = { ...sheet };
      delete next.printArea;
      return next;
    }),
  };
}

// Human: Apply page margin inches on a sheet for print layout.
// Agent: WRITES pageMargins exported via worksheet OOXML.
export function setPageMargins(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  margins: PageMargins,
): SpreadsheetWorkbook {
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex ? { ...sheet, pageMargins: margins } : sheet,
    ),
  };
}

// Human: Append a pivot summary table as a new worksheet.
// Agent: BUILDS header + data rows from PivotSummaryResult; RETURNS workbook with extra sheet.
export function insertPivotSummaryAsNewSheet(
  workbook: SpreadsheetWorkbook,
  sheetName: string,
  summary: PivotSummaryResult,
): SpreadsheetWorkbook {
  const headerRow = summary.headers.map((header) => ({
    value: header,
    display: header,
    style: { bold: true, isHeaderRow: true },
  }));
  const dataRows = summary.rows.map((row) => row.map((cell) => ({ ...cell })));
  const rows = [headerRow, ...dataRows];
  const sheet = normalizeSheetGrid({ name: sheetName, rows });
  return { ...workbook, sheets: [...workbook.sheets, sheet] };
}

// Human: Sort by multiple columns with stable tie-breaking (Excel Data → Sort).
// Agent: KEEPS header row fixed; COMPARES each sort key in order.
export function sortSheetByColumns(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  sortKeys: Array<{ colIndex: number; direction: SortDirection }>,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const header = sheet.rows[0] ? [sheet.rows[0]] : [];
      const body = [...sheet.rows.slice(1)];
      body.sort((rowA, rowB) => {
        for (const key of sortKeys) {
          const a = rowA[key.colIndex]?.value ?? rowA[key.colIndex]?.display ?? "";
          const b = rowB[key.colIndex]?.value ?? rowB[key.colIndex]?.display ?? "";
          const numA = Number(a);
          const numB = Number(b);
          const bothNumeric = Number.isFinite(numA) && Number.isFinite(numB);
          const cmp = bothNumeric
            ? numA - numB
            : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
          if (cmp !== 0) return key.direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
      return { ...sheet, rows: [...header, ...body] };
    }),
  };
}

// Human: Toggle hide state for a row index on the active sheet.
// Agent: WRITES hiddenRows array; GRID skips hidden indices.
export function toggleRowHidden(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  rowIndex: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const hidden = new Set(sheet.hiddenRows ?? []);
      if (hidden.has(rowIndex)) hidden.delete(rowIndex);
      else hidden.add(rowIndex);
      const next = [...hidden].sort((a, b) => a - b);
      return { ...sheet, hiddenRows: next.length > 0 ? next : undefined };
    }),
  };
}

export function toggleColumnHidden(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  colIndex: number,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const hidden = new Set(sheet.hiddenCols ?? []);
      if (hidden.has(colIndex)) hidden.delete(colIndex);
      else hidden.add(colIndex);
      const next = [...hidden].sort((a, b) => a - b);
      return { ...sheet, hiddenRows: sheet.hiddenRows, hiddenCols: next.length > 0 ? next : undefined };
    }),
  };
}

// Human: Split delimited text in a column into adjacent columns (Text to Columns).
// Agent: SPLITS on delimiter; WRITES values across row cells from startCol.
export function textToColumns(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  startCol: number,
  delimiter: string,
): SpreadsheetWorkbook {
  const delim = delimiter || ",";
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const nextRows = sheet.rows.map((row) => {
        const source = row[startCol];
        const raw = String(source?.value ?? source?.display ?? "");
        const parts = raw.split(delim).map((part) => part.trim());
        const copy = [...row];
        parts.forEach((part, offset) => {
          const col = startCol + offset;
          while (copy.length <= col) copy.push(emptyCell());
          copy[col] = {
            ...copy[col],
            value: part,
            formula: undefined,
            display: part,
          };
        });
        return copy;
      });
      return { ...sheet, rows: nextRows };
    }),
  };
}

export function setSheetProtection(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  protection: SheetProtection | null,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      if (!protection) {
        const next = { ...sheet };
        delete next.protection;
        return next;
      }
      return { ...sheet, protection };
    }),
  };
}

export function setPageSetup(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  pageSetup: PageSetup,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex ? { ...sheet, pageSetup: { ...sheet.pageSetup, ...pageSetup } } : sheet,
    ),
  };
}

export function insertChartOnSheet(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  chart: SheetChart,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      return { ...sheet, charts: [...(sheet.charts ?? []), chart] };
    }),
  };
}

export function setSheetZoom(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  zoomPercent: number,
): SpreadsheetWorkbook {
  const clamped = Math.min(200, Math.max(50, Math.round(zoomPercent)));
  return {
    sheets: workbook.sheets.map((sheet, index) =>
      index === sheetIndex ? { ...sheet, zoomPercent: clamped } : sheet,
    ),
  };
}

export function setSheetTabColor(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  color: string | null,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      if (!color) {
        const next = { ...sheet };
        delete next.tabColor;
        return next;
      }
      return { ...sheet, tabColor: color };
    }),
  };
}

export function appendTrackChange(
  workbook: SpreadsheetWorkbook,
  entry: TrackChangeEntry,
): SpreadsheetWorkbook {
  if (!workbook.trackChangesEnabled) return workbook;
  return {
    ...workbook,
    trackChanges: [...(workbook.trackChanges ?? []), entry],
  };
}

export function setTrackChangesEnabled(
  workbook: SpreadsheetWorkbook,
  enabled: boolean,
): SpreadsheetWorkbook {
  return { ...workbook, trackChangesEnabled: enabled };
}

export function groupRowsInRange(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  startRow: number,
  endRow: number,
): SpreadsheetWorkbook {
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const levels = { ...(sheet.rowOutlineLevels ?? {}) };
      for (let row = minRow; row <= maxRow; row += 1) {
        levels[row] = (levels[row] ?? 0) + 1;
      }
      return { ...sheet, rowOutlineLevels: levels };
    }),
  };
}

export function setCellHyperlink(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  row: number,
  col: number,
  url: string | null,
): SpreadsheetWorkbook {
  return {
    sheets: workbook.sheets.map((sheet, index) => {
      if (index !== sheetIndex) return sheet;
      const expanded = expandSheetToAddress(sheet, row, col);
      const nextRows = expanded.rows.map((sheetRow, rowIndex) =>
        sheetRow.map((cell, colIndex) => {
          if (rowIndex !== row || colIndex !== col) return cell;
          if (!url?.trim()) {
            const nextCell = { ...cell };
            delete nextCell.hyperlink;
            return nextCell;
          }
          return {
            ...cell,
            hyperlink: url.trim(),
            style: { ...cell.style, textColor: "#2563EB", underline: true },
          };
        }),
      );
      return { ...sheet, rows: nextRows };
    }),
  };
}
