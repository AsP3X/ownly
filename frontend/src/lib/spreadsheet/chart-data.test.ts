import { describe, expect, it } from "vitest";
import {
  chartSeriesFromChart,
  chartSeriesFromDataRange,
  chartSeriesFromExplicitRefs,
  numericChartValue,
} from "@/lib/spreadsheet/chart-data";
import type { SheetCell, SheetChart } from "@/lib/spreadsheet/types";

function cell(value: SheetCell["value"], display?: string): SheetCell {
  return { value, display: display ?? String(value ?? "") };
}

describe("chart-data", () => {
  it("coerces formatted currency strings into chart values", () => {
    const sheet = {
      rows: [
        [cell("Product"), cell("$1,200.50", "$1,200.50")],
        [cell("Service"), cell("450", "450")],
      ],
    };

    const series = chartSeriesFromDataRange(sheet, {
      start: { row: 0, col: 0 },
      end: { row: 1, col: 1 },
    });

    expect(series).toEqual([
      { label: "Product", value: 1200.5 },
      { label: "Service", value: 450 },
    ]);
  });

  it("reads horizontal Excel series refs (labels in a header row)", () => {
    const sheet = {
      rows: [
        [cell(null, ""), cell("Q1"), cell("Q2"), cell("Q3")],
        [cell(null, ""), cell(10), cell(20), cell(30)],
      ],
    };

    const series = chartSeriesFromExplicitRefs(
      sheet,
      { startRow: 0, startCol: 1, endRow: 0, endCol: 3 },
      { startRow: 1, startCol: 1, endRow: 1, endCol: 3 },
    );

    expect(series).toEqual([
      { label: "Q1", value: 10 },
      { label: "Q2", value: 20 },
      { label: "Q3", value: 30 },
    ]);
  });

  it("falls back to cached OOXML series when sheet cells are empty", () => {
    const chart: SheetChart = {
      id: "chart-1",
      type: "column",
      title: "Cached",
      anchorRow: 2,
      anchorCol: 4,
      dataStartRow: 1,
      dataStartCol: 0,
      dataEndRow: 2,
      dataEndCol: 1,
      categoryRef: { startRow: 1, startCol: 0, endRow: 2, endCol: 0 },
      valueRef: { startRow: 1, startCol: 1, endRow: 2, endCol: 1 },
      fallbackSeries: [
        { label: "A", value: 5 },
        { label: "B", value: 9 },
      ],
    };

    const series = chartSeriesFromChart({ rows: [[cell(null, "")]] }, chart);
    expect(series).toEqual(chart.fallbackSeries);
  });

  it("parses numeric values from display when value is null", () => {
    expect(numericChartValue(cell(null, "42%"))).toBe(42);
  });
});
