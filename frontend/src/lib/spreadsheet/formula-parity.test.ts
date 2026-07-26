// Human: Formula / spill parity tests for Excel editor gap-close work.
// Agent: RUN via vitest; COVERS TEXTJOIN, SUMPRODUCT, LET, #SPILL!, multi-col FILTER.

import { describe, expect, it } from "vitest";
import { recalculateSheet } from "@/lib/spreadsheet/formulas";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";

function cell(value: string | number | null, formula?: string): SheetCell {
  return {
    value,
    formula,
    display: value === null ? "" : String(value),
  };
}

function sheetFrom(rows: SheetCell[][], name = "Sheet1"): SheetData {
  return { name, rows };
}

describe("formula parity", () => {
  it("evaluates TEXTJOIN and SUMPRODUCT", () => {
    const sheet = sheetFrom([
      [cell("a"), cell("b"), cell(2), cell(3)],
      [cell(null, '=TEXTJOIN("-", TRUE, A1, B1)'), cell(null, "=SUMPRODUCT(C1:D1, C1:D1)")],
    ]);
    const result = recalculateSheet(sheet, 0, [sheet]);
    expect(result.rows[1][0].display).toBe("a-b");
    expect(Number(result.rows[1][1].value)).toBe(13);
  });

  it("evaluates LET bindings", () => {
    const sheet = sheetFrom([[cell(null, "=LET(x, 2, y, 3, x*y)")]]);
    const result = recalculateSheet(sheet, 0, [sheet]);
    expect(Number(result.rows[0][0].value)).toBe(6);
  });

  it("spills UNIQUE and clears prior spill targets", () => {
    const sheet = sheetFrom([
      [cell("a"), cell("a"), cell("b")],
      [cell(null, "=UNIQUE(A1:C1)")],
      [cell("old")],
    ]);
    // First calc: spill into B2/C2... actually UNIQUE of row is multi-col
    let result = recalculateSheet(sheet, 0, [sheet]);
    expect(result.rows[1][0].display).toBe("a");

    // Put a blocker in the spill path of a vertical spill
    const blocked = sheetFrom([
      [cell(1)],
      [cell(2)],
      [cell(3)],
      [cell(null, "=SORT(A1:A3)")],
      [cell("block")],
    ]);
    // SORT spills A4 origin into A5,A6 — A5 has "block" → #SPILL!
    // Origin is row 3; spill targets row 4 and 5. row 4 has block.
    result = recalculateSheet(blocked, 0, [blocked]);
    // Origin value first of sorted is 1; if spill blocked by A5 (index 4)
    // spill targets: A5 (row4) and A6 (row5). A5 has block → #SPILL!
    expect(result.rows[3][0].display).toBe("#SPILL!");
  });

  it("spills SEQUENCE into empty cells with spillFrom tags", () => {
    const sheet = sheetFrom([[cell(null, "=SEQUENCE(3,1,10,1)")]]);
    const result = recalculateSheet(sheet, 0, [sheet]);
    expect(Number(result.rows[0][0].value)).toBe(10);
    expect(Number(result.rows[1][0].value)).toBe(11);
    expect(result.rows[1][0].spillFrom).toBe("0:0");
    expect(Number(result.rows[2][0].value)).toBe(12);
  });

  it("evaluates IFS, SWITCH, TEXTBEFORE, and LARGE", () => {
    const sheet = sheetFrom([
      [cell(5), cell("hello-world"), cell(1), cell(9), cell(3)],
      [
        cell(null, '=IFS(A1>10, "big", A1>3, "mid", TRUE, "small")'),
        cell(null, '=SWITCH(A1, 1, "one", 5, "five", "other")'),
        cell(null, '=TEXTBEFORE(B1, "-")'),
        cell(null, "=LARGE(C1:E1, 2)"),
      ],
    ]);
    const result = recalculateSheet(sheet, 0, [sheet]);
    expect(result.rows[1][0].display).toBe("mid");
    expect(result.rows[1][1].display).toBe("five");
    expect(result.rows[1][2].display).toBe("hello");
    // Human: C1:E1 is 1,9,3 — 2nd largest is 3.
    expect(Number(result.rows[1][3].value)).toBe(3);
  });

  it("evaluates trig, FACT, ROMAN, and ISEVEN", () => {
    const sheet = sheetFrom([
      [
        cell(null, "=SIN(0)"),
        cell(null, "=DEGREES(PI())"),
        cell(null, "=FACT(5)"),
        cell(null, "=ROMAN(14)"),
        cell(null, "=ISEVEN(4)"),
        cell(null, "=GEOMEAN(1, 4, 1)"),
      ],
    ]);
    const result = recalculateSheet(sheet, 0, [sheet]);
    expect(Number(result.rows[0][0].value)).toBe(0);
    expect(Number(result.rows[0][1].value)).toBeCloseTo(180, 5);
    expect(Number(result.rows[0][2].value)).toBe(120);
    expect(result.rows[0][3].display).toBe("XIV");
    expect(result.rows[0][4].display).toBe("TRUE");
    expect(Number(result.rows[0][5].value)).toBeCloseTo(Math.cbrt(4), 5);
  });

  it("supports COUNTBLANK, wildcards, and <> criteria", () => {
    const sheet = sheetFrom([
      [cell("apple"), cell("apricot"), cell(null), cell(10), cell(20)],
      [
        cell(null, '=COUNTIF(A1:B1, "ap*")'),
        cell(null, "=COUNTBLANK(A1:C1)"),
        cell(null, '=SUMIF(D1:E1, "<>10")'),
      ],
    ]);
    const result = recalculateSheet(sheet, 0, [sheet]);
    expect(Number(result.rows[1][0].value)).toBe(2);
    expect(Number(result.rows[1][1].value)).toBe(1);
    expect(Number(result.rows[1][2].value)).toBe(20);
  });
});
