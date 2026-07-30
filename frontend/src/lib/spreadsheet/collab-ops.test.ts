import { describe, expect, it } from "vitest";
import {
  applyCollabOpToWorkbook,
  applyCollabOpsToWorkbook,
  parseCellEditPayload,
} from "@/lib/spreadsheet/collab-ops";
import type { SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import type { SpreadsheetCollabOp } from "@/api/client";

function book(value = ""): SpreadsheetWorkbook {
  return {
    sheets: [
      {
        name: "Sheet1",
        rows: [
          [
            { value: value || null, display: value },
            { value: null, display: "" },
          ],
          [
            { value: null, display: "" },
            { value: null, display: "" },
          ],
        ],
      },
    ],
  };
}

function op(
  partial: Partial<SpreadsheetCollabOp> & Pick<SpreadsheetCollabOp, "seq" | "user_id" | "payload">,
): SpreadsheetCollabOp {
  return {
    id: partial.id ?? `op-${partial.seq}`,
    seq: partial.seq,
    user_id: partial.user_id,
    ts: partial.ts ?? 1,
    base_seq: partial.base_seq ?? Math.max(0, partial.seq - 1),
    op_type: partial.op_type ?? "cell_edit",
    payload: partial.payload,
  };
}

describe("collab-ops multi-type", () => {
  it("parses cell_edit payloads", () => {
    expect(parseCellEditPayload({ sheet: "Sheet1", cell: "A1", value: "hi" })).toEqual({
      sheet: "Sheet1",
      cell: "A1",
      value: "hi",
    });
  });

  it("applies style_patch, clear_contents, insert_row, sheet_rename", () => {
    let wb = book("x");
    wb = applyCollabOpToWorkbook(
      wb,
      op({
        seq: 1,
        user_id: "u2",
        op_type: "style_patch",
        payload: {
          sheet: "Sheet1",
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: 0,
          patch: { bold: true },
        },
      }),
    );
    expect(wb.sheets[0].rows[0][0].style?.bold).toBe(true);

    wb = applyCollabOpToWorkbook(
      wb,
      op({
        seq: 2,
        user_id: "u2",
        op_type: "clear_contents",
        payload: { sheet: "Sheet1", startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      }),
    );
    expect(wb.sheets[0].rows[0][0].value).toBeNull();
    expect(wb.sheets[0].rows[0][0].style?.bold).toBe(true);

    const beforeRows = wb.sheets[0].rows.length;
    wb = applyCollabOpToWorkbook(
      wb,
      op({
        seq: 3,
        user_id: "u2",
        op_type: "insert_row",
        payload: { sheet: "Sheet1", at: 0 },
      }),
    );
    // Human: insertRow may pad to GRID_MIN_ROW_COUNT after normalize.
    expect(wb.sheets[0].rows.length).toBeGreaterThanOrEqual(beforeRows + 1);

    wb = applyCollabOpToWorkbook(
      wb,
      op({
        seq: 4,
        user_id: "u2",
        op_type: "sheet_rename",
        payload: { index: 0, name: "Budget" },
      }),
    );
    expect(wb.sheets[0].name).toBe("Budget");
  });

  it("applies ordered formula batch and skips local user", () => {
    const next = applyCollabOpsToWorkbook(book(), [
      op({
        seq: 2,
        user_id: "u2",
        payload: { sheet: "Sheet1", cell: "A1", value: "=1+1" },
      }),
      op({
        seq: 1,
        user_id: "u2",
        payload: { sheet: "Sheet1", cell: "A1", value: "9" },
      }),
    ]);
    expect(next.sheets[0].rows[0][0].formula).toBe("=1+1");
    expect(Number(next.sheets[0].rows[0][0].value)).toBe(2);

    const skipped = applyCollabOpToWorkbook(
      book("keep"),
      op({
        seq: 5,
        user_id: "me",
        payload: { sheet: "Sheet1", cell: "A1", value: "nope" },
      }),
      { skipUserId: "me" },
    );
    expect(skipped.sheets[0].rows[0][0].display).toBe("keep");
  });
});
