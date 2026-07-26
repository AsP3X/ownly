import { describe, expect, it } from "vitest";
import { computeMultiFieldPivotSummary } from "@/lib/spreadsheet/pivot-summary";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";

function cell(value: string | number | null): SheetCell {
  return { value, display: value === null ? "" : String(value) };
}

describe("computeMultiFieldPivotSummary", () => {
  it("groups by two row fields and aggregates two value fields", () => {
    const sheet: SheetData = {
      name: "Data",
      rows: [
        [cell("Region"), cell("Product"), cell("Qty"), cell("Rev")],
        [cell("East"), cell("A"), cell(2), cell(20)],
        [cell("East"), cell("B"), cell(1), cell(15)],
        [cell("West"), cell("A"), cell(3), cell(30)],
        [cell("East"), cell("A"), cell(1), cell(10)],
      ],
    };
    const result = computeMultiFieldPivotSummary(
      sheet,
      { start: { row: 0, col: 0 }, end: { row: 4, col: 3 } },
      [0, 1],
      [
        { col: 2, aggregation: "sum" },
        { col: 3, aggregation: "sum" },
      ],
    );
    expect(result.headers.length).toBe(4);
    expect(result.rows.length).toBe(3);
    const eastA = result.rows.find((row) => row[0].display === "East" && row[1].display === "A");
    expect(eastA?.[2].value).toBe(3);
    expect(eastA?.[3].value).toBe(30);
  });
});
