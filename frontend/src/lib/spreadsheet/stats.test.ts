import { describe, expect, it } from "vitest";
import { computeRangeSelectionStats, formatSelectionStatsLine } from "@/lib/spreadsheet/stats";
import type { SheetCell } from "@/lib/spreadsheet/types";

function cell(value: number | null): SheetCell {
  return { value, display: value === null ? "" : String(value) };
}

describe("selection stats", () => {
  it("aggregates a multi-cell range", () => {
    const rows = [
      [cell(1), cell(2)],
      [cell(3), cell(4)],
    ];
    const stats = computeRangeSelectionStats(rows, {
      start: { row: 0, col: 0 },
      end: { row: 1, col: 1 },
    });
    expect(stats.count).toBe(4);
    expect(stats.sum).toBe(10);
    expect(stats.average).toBe(2.5);
  });

  it("formats compact numbers for small values", () => {
    const line = formatSelectionStatsLine({ average: 2.5, count: 4, sum: 10 });
    expect(line).toContain("Average: 2.5");
    expect(line).toContain("Count: 4");
    expect(line).toContain("Sum: 10");
  });
});
