// Human: Apply remote co-editing ops — multi-type last-write-wins under server seq order.
// Agent: USED by useSpreadsheetCollab; centralized sequential apply (server total order = OT-like).

import { parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import { applyStylePatchToCell } from "@/lib/spreadsheet/cell-styles";
import { applyFormulaBarEdit } from "@/lib/spreadsheet/parse";
import type { CellStyle, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import type { SpreadsheetCollabOp } from "@/api/client";
import {
  addSheet,
  clearContentsInRange,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  mergeCellsInRange,
  moveSheet,
  removeSheet,
  renameSheet,
  setCellComment,
  setCellHyperlink,
  unmergeCellsInRange,
} from "@/lib/spreadsheet/workbook-ops";

export type CollabOpType =
  | "cell_edit"
  | "style_patch"
  | "clear_contents"
  | "comment"
  | "hyperlink"
  | "merge"
  | "unmerge"
  | "insert_row"
  | "delete_row"
  | "insert_column"
  | "delete_column"
  | "sheet_add"
  | "sheet_remove"
  | "sheet_rename"
  | "sheet_move";

function sheetIndexByName(workbook: SpreadsheetWorkbook, sheetName: string): number {
  return workbook.sheets.findIndex(
    (sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase(),
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRange(payload: Record<string, unknown>): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} | null {
  const startRow = asNumber(payload.startRow);
  const startCol = asNumber(payload.startCol);
  const endRow = asNumber(payload.endRow) ?? startRow;
  const endCol = asNumber(payload.endCol) ?? startCol;
  if (startRow === undefined || startCol === undefined) return null;
  return { startRow, startCol, endRow: endRow ?? startRow, endCol: endCol ?? startCol };
}

// Human: Apply one remote op; skip local user's echoes when skipUserId matches.
// Agent: RETURNS next workbook; UNKNOWN op types are no-ops.
export function applyCollabOpToWorkbook(
  workbook: SpreadsheetWorkbook,
  op: SpreadsheetCollabOp,
  options?: { skipUserId?: string | null },
): SpreadsheetWorkbook {
  if (options?.skipUserId && op.user_id === options.skipUserId) {
    return workbook;
  }

  const payload = (op.payload ?? {}) as Record<string, unknown>;
  const sheetName = asString(payload.sheet);

  switch (op.op_type as CollabOpType | string) {
    case "cell_edit": {
      if (!sheetName) return workbook;
      const cell = asString(payload.cell);
      if (!cell) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const address = parseCellAddressLabel(cell.replace(/\$/g, ""));
      if (!address) return workbook;
      const value =
        typeof payload.value === "string"
          ? payload.value
          : payload.value === null || payload.value === undefined
            ? ""
            : String(payload.value);
      return applyFormulaBarEdit(workbook, sheetIndex, address.row, address.col, value);
    }
    case "style_patch": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const range = asRange(payload);
      const patch = payload.patch as Partial<CellStyle> | undefined;
      if (!range || !patch || typeof patch !== "object") return workbook;
      return {
        ...workbook,
        sheets: workbook.sheets.map((sheet, index) => {
          if (index !== sheetIndex) return sheet;
          const nextRows = sheet.rows.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              if (
                rowIndex < range.startRow ||
                rowIndex > range.endRow ||
                colIndex < range.startCol ||
                colIndex > range.endCol
              ) {
                return cell;
              }
              return applyStylePatchToCell(cell, patch);
            }),
          );
          return { ...sheet, rows: nextRows };
        }),
      };
    }
    case "clear_contents": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const range = asRange(payload);
      if (!range) return workbook;
      return clearContentsInRange(
        workbook,
        sheetIndex,
        {
          start: { row: range.startRow, col: range.startCol },
          end: { row: range.endRow, col: range.endCol },
        },
        { keepStyle: true, keepComments: true },
      );
    }
    case "comment": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const cell = asString(payload.cell);
      if (!cell) return workbook;
      const address = parseCellAddressLabel(cell.replace(/\$/g, ""));
      if (!address) return workbook;
      const comment = asString(payload.comment) ?? null;
      return setCellComment(workbook, sheetIndex, address.row, address.col, comment);
    }
    case "hyperlink": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const cell = asString(payload.cell);
      if (!cell) return workbook;
      const address = parseCellAddressLabel(cell.replace(/\$/g, ""));
      if (!address) return workbook;
      const url = asString(payload.url) ?? null;
      return setCellHyperlink(workbook, sheetIndex, address.row, address.col, url);
    }
    case "merge": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const range = asRange(payload);
      if (!range) return workbook;
      return mergeCellsInRange(workbook, sheetIndex, {
        start: { row: range.startRow, col: range.startCol },
        end: { row: range.endRow, col: range.endCol },
      });
    }
    case "unmerge": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      if (sheetIndex < 0) return workbook;
      const range = asRange(payload);
      if (!range) return workbook;
      return unmergeCellsInRange(workbook, sheetIndex, {
        start: { row: range.startRow, col: range.startCol },
        end: { row: range.endRow, col: range.endCol },
      });
    }
    case "insert_row": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      const at = asNumber(payload.at);
      if (sheetIndex < 0 || at === undefined) return workbook;
      return insertRow(workbook, sheetIndex, at);
    }
    case "delete_row": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      const at = asNumber(payload.at);
      if (sheetIndex < 0 || at === undefined) return workbook;
      return deleteRow(workbook, sheetIndex, at);
    }
    case "insert_column": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      const at = asNumber(payload.at);
      if (sheetIndex < 0 || at === undefined) return workbook;
      return insertColumn(workbook, sheetIndex, at);
    }
    case "delete_column": {
      if (!sheetName) return workbook;
      const sheetIndex = sheetIndexByName(workbook, sheetName);
      const at = asNumber(payload.at);
      if (sheetIndex < 0 || at === undefined) return workbook;
      return deleteColumn(workbook, sheetIndex, at);
    }
    case "sheet_add": {
      const name = asString(payload.name);
      return addSheet(workbook, name);
    }
    case "sheet_remove": {
      const index = asNumber(payload.index);
      if (index === undefined) return workbook;
      return removeSheet(workbook, index);
    }
    case "sheet_rename": {
      const index = asNumber(payload.index);
      const name = asString(payload.name);
      if (index === undefined || !name) return workbook;
      return renameSheet(workbook, index, name);
    }
    case "sheet_move": {
      const fromIndex = asNumber(payload.fromIndex);
      const toIndex = asNumber(payload.toIndex);
      if (fromIndex === undefined || toIndex === undefined) return workbook;
      return moveSheet(workbook, fromIndex, toIndex);
    }
    default:
      return workbook;
  }
}

// Human: Apply a batch of remote ops in server sequence order (centralized OT total order).
// Agent: SORT by seq; RETURNS final workbook snapshot.
export function applyCollabOpsToWorkbook(
  workbook: SpreadsheetWorkbook,
  ops: SpreadsheetCollabOp[],
  options?: { skipUserId?: string | null },
): SpreadsheetWorkbook {
  const ordered = [...ops].sort((a, b) => a.seq - b.seq);
  let next = workbook;
  for (const op of ordered) {
    next = applyCollabOpToWorkbook(next, op, options);
  }
  return next;
}

// Human: Legacy helper kept for tests.
export function parseCellEditPayload(payload: Record<string, unknown>): {
  sheet?: string;
  cell?: string;
  value?: string;
} | null {
  const sheet = asString(payload.sheet);
  const cell = asString(payload.cell);
  if (!sheet || !cell) return null;
  const value =
    typeof payload.value === "string"
      ? payload.value
      : payload.value === null || payload.value === undefined
        ? ""
        : String(payload.value);
  return { sheet, cell, value };
}
