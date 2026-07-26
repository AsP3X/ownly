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
        rows: [[{ value: value || null, display: value, formula: undefined }]],
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
    op_type: partial.op_type ?? "cell_edit",
    payload: partial.payload,
  };
}

describe("collab-ops", () => {
  it("parses cell_edit payloads", () => {
    expect(parseCellEditPayload({ sheet: "Sheet1", cell: "A1", value: "hi" })).toEqual({
      sheet: "Sheet1",
      cell: "A1",
      value: "hi",
    });
    expect(parseCellEditPayload({ cell: "A1" })).toBeNull();
  });

  it("applies remote cell_edit and skips local user", () => {
    const remote = applyCollabOpToWorkbook(
      book(),
      op({
        seq: 1,
        user_id: "u2",
        payload: { sheet: "Sheet1", cell: "A1", value: "42" },
      }),
      { skipUserId: "u1" },
    );
    expect(remote.sheets[0].rows[0][0].value).toBe(42);

    const skipped = applyCollabOpToWorkbook(
      book("keep"),
      op({
        seq: 2,
        user_id: "u1",
        payload: { sheet: "Sheet1", cell: "A1", value: "x" },
      }),
      { skipUserId: "u1" },
    );
    expect(skipped.sheets[0].rows[0][0].display).toBe("keep");
  });

  it("applies formula edits and ordered batches", () => {
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
    // seq 1 then 2 → formula wins
    expect(next.sheets[0].rows[0][0].formula).toBe("=1+1");
    expect(Number(next.sheets[0].rows[0][0].value)).toBe(2);
  });
});
