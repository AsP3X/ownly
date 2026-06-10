import { describe, expect, it } from "vitest";
import {
  CHART_EMU_PER_PX,
  chartAnchorFromPixelRect,
  chartLayoutRect,
} from "@/lib/spreadsheet/chart-layout";
import {
  GRID_DEFAULT_COL_WIDTH,
  GRID_DEFAULT_ROW_HEIGHT,
  GRID_HEADER_ROW_HEIGHT,
  GRID_ROW_INDEX_WIDTH,
} from "@/lib/spreadsheet/dimensions";
import type { SheetChart } from "@/lib/spreadsheet/types";

describe("chart-layout", () => {
  const columnWidths = [64, 64, 64, 64];
  const rowHeights = [
    GRID_DEFAULT_ROW_HEIGHT,
    GRID_DEFAULT_ROW_HEIGHT,
    GRID_DEFAULT_ROW_HEIGHT,
    GRID_DEFAULT_ROW_HEIGHT,
    GRID_DEFAULT_ROW_HEIGHT,
  ];

  it("round-trips a chart pixel rect through anchor conversion", () => {
    const chart: SheetChart = {
      id: "chart-1",
      type: "column",
      title: "Sales",
      anchorRow: 1,
      anchorCol: 2,
      anchorEndRow: 4,
      anchorEndCol: 5,
      dataStartRow: 0,
      dataStartCol: 0,
      dataEndRow: 2,
      dataEndCol: 1,
    };

    const layout = chartLayoutRect(chart, columnWidths, rowHeights);
    const anchor = chartAnchorFromPixelRect(
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      columnWidths,
      rowHeights,
    );

    expect(anchor.anchorRow).toBe(1);
    expect(anchor.anchorCol).toBe(2);
    expect(anchor.anchorEndRow).toBeGreaterThanOrEqual(anchor.anchorRow);
    expect(anchor.anchorEndCol).toBeGreaterThanOrEqual(anchor.anchorCol);
  });

  it("writes EMU offsets for sub-cell drag positions", () => {
    const x = GRID_ROW_INDEX_WIDTH + 2 * GRID_DEFAULT_COL_WIDTH + 10;
    const y = GRID_HEADER_ROW_HEIGHT + 1 * GRID_DEFAULT_ROW_HEIGHT + 8;
    const anchor = chartAnchorFromPixelRect(
      x,
      y,
      GRID_DEFAULT_COL_WIDTH * 2,
      GRID_DEFAULT_ROW_HEIGHT * 2,
      columnWidths,
      rowHeights,
    );

    expect(anchor.anchorCol).toBe(2);
    expect(anchor.anchorRow).toBe(1);
    expect(anchor.anchorColOff).toBe(Math.round(10 * CHART_EMU_PER_PX));
    expect(anchor.anchorRowOff).toBe(Math.round(8 * CHART_EMU_PER_PX));
  });
});
