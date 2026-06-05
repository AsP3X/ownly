// Human: Shared spreadsheet workbook types for the Excel preview dialog.
// Agent: DEFINES SheetCell, SheetData, SpreadsheetWorkbook consumed by parse + grid components.

import type { ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type NumberFormat = "general" | "currency" | "percent" | "number";

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  horizontalAlign?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  numberFormat?: NumberFormat;
  backgroundColor?: string;
  isHeaderRow?: boolean;
  isTotalRow?: boolean;
};

export type SheetCell = {
  value: string | number | null;
  formula?: string;
  display: string;
  style?: CellStyle;
};

export type SheetData = {
  name: string;
  rows: SheetCell[][];
  // Human: Per-sheet conditional formatting rules (imported from xlsx or added via ribbon).
  // Agent: READ by grid resolveConditionalFormat; WRITTEN on save via OOXML patch.
  conditionalFormats?: ConditionalFormatRule[];
  // Human: Column widths in on-screen CSS pixels (1.5× Pencil scale) — drag-resized like Excel.
  // Agent: READ by grid; IMPORTED from !cols; WRITTEN on save via SheetJS !cols wpx.
  columnWidths?: number[];
  // Human: Row heights in on-screen CSS pixels — drag-resized like Excel.
  // Agent: READ by virtualizer; IMPORTED from !rows; WRITTEN on save via SheetJS !rows hpx.
  rowHeights?: number[];
};

export type SpreadsheetWorkbook = {
  sheets: SheetData[];
};

export type CellAddress = {
  row: number;
  col: number;
};

export type SelectionStats = {
  average: number | null;
  count: number;
  sum: number | null;
};
