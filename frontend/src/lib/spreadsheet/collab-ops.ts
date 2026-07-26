// Human: Apply remote co-editing ops to the local workbook model (last-write-wins cell edits).
// Agent: USED by useSpreadsheetCollab / ExcelSpreadsheetDialog; SKIPS local user's own ops.

import { parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import { applyFormulaBarEdit } from "@/lib/spreadsheet/parse";
import type { SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import type { SpreadsheetCollabOp } from "@/api/client";

export type CellEditPayload = {
  sheet?: string;
  cell?: string;
  value?: string;
};

// Human: Extract a cell_edit payload from a collab op JSON object.
// Agent: RETURNS null when shape is incomplete.
export function parseCellEditPayload(payload: Record<string, unknown>): CellEditPayload | null {
  const sheet = typeof payload.sheet === "string" ? payload.sheet : undefined;
  const cell = typeof payload.cell === "string" ? payload.cell : undefined;
  const value =
    typeof payload.value === "string"
      ? payload.value
      : payload.value === null || payload.value === undefined
        ? ""
        : String(payload.value);
  if (!sheet || !cell) return null;
  return { sheet, cell, value };
}

// Human: Apply one remote op to the workbook; last-write-wins for cell_edit.
// Agent: RETURNS next workbook or same reference when op is skipped/unknown.
export function applyCollabOpToWorkbook(
  workbook: SpreadsheetWorkbook,
  op: SpreadsheetCollabOp,
  options?: { skipUserId?: string | null },
): SpreadsheetWorkbook {
  if (options?.skipUserId && op.user_id === options.skipUserId) {
    return workbook;
  }

  if (op.op_type !== "cell_edit") {
    return workbook;
  }

  const payload = parseCellEditPayload(op.payload as Record<string, unknown>);
  if (!payload?.sheet || !payload.cell) return workbook;

  const sheetIndex = workbook.sheets.findIndex(
    (sheet) => sheet.name.toLowerCase() === payload.sheet!.toLowerCase(),
  );
  if (sheetIndex < 0) return workbook;

  const address = parseCellAddressLabel(payload.cell.replace(/\$/g, ""));
  if (!address) return workbook;

  // Human: Reuse formula-bar path so formulas recalculate and styles stay intact.
  // Agent: DOES NOT append track-changes when trackChangesEnabled unless already on.
  return applyFormulaBarEdit(
    workbook,
    sheetIndex,
    address.row,
    address.col,
    payload.value ?? "",
  );
}

// Human: Apply a batch of remote ops in sequence order.
// Agent: STABLE sort by seq; RETURNS final workbook snapshot.
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
