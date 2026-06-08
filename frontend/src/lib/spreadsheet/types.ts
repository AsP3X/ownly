// Human: Shared spreadsheet workbook types for the Excel preview dialog.
// Agent: DEFINES SheetCell, SheetData, SpreadsheetWorkbook consumed by parse + grid components.

import type { ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";
import type { DataValidationRule } from "@/lib/spreadsheet/data-validation";
import type { NamedRange } from "@/lib/spreadsheet/named-ranges";

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
  // Human: Direct font color from xlsx cell style (not conditional formatting).
  // Agent: READ from SheetJS cell.s.color; RENDERED in grid when no CF textColor wins.
  textColor?: string;
  // Human: Ribbon font controls — persisted on save via cellStyleToXlsx.
  // Agent: RENDERED in grid inline styles when set.
  fontFamily?: string;
  fontSize?: number;
  wrapText?: boolean;
  // Human: Per-side cell borders from ribbon or xlsx import.
  // Agent: RENDERED as inline CSS borders; EXPORTED via cellStyleToXlsx.
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderColor?: string;
  isHeaderRow?: boolean;
  isTotalRow?: boolean;
};

export type SheetCell = {
  value: string | number | null;
  formula?: string;
  display: string;
  style?: CellStyle;
  // Human: Optional cell note shown via comment indicator in grid.
  // Agent: EDITED via Comment dialog; PERSISTED in workbook JSON on save.
  comment?: string;
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
  // Human: View flags toggled from Page Layout / Formulas ribbon.
  // Agent: READ by grid for display-only modes.
  showGridlines?: boolean;
  showFormulas?: boolean;
  // Human: Freeze panes — rows/cols before these indices stay visible while scrolling.
  // Agent: SET via Page Layout ribbon; RENDERED as sticky sections in grid.
  frozenRows?: number;
  frozenCols?: number;
  // Human: Per-column data validation rules keyed by column index.
  // Agent: CHECKED on commitEdit; SET via Data Validation dialog.
  columnValidations?: Record<number, DataValidationRule>;
  // Human: Excel-style table metadata for banded row styling in grid.
  // Agent: SET via Insert Table; RENDERED as alternating row fills.
  tables?: SpreadsheetTable[];
  // Human: Print area bounds for Page Layout ribbon and xlsx export.
  // Agent: IMPORTED from _xlnm.Print_Area; SHOWN as dashed outline in grid.
  printArea?: SheetPrintArea;
  // Human: Page margins in inches for print/PDF.
  // Agent: IMPORTED/EXPORTED via worksheet pageMargins OOXML.
  pageMargins?: PageMargins;
};

export type SpreadsheetTable = {
  name: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type SheetPrintArea = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type PageMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header?: number;
  footer?: number;
};

export type SpreadsheetWorkbook = {
  sheets: SheetData[];
  // Human: Workbook-level named ranges for formulas and name manager UI.
  // Agent: IMPORTED/EXPORTED via xl/workbook.xml definedNames.
  namedRanges?: NamedRange[];
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
