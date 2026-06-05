// Human: Shared spreadsheet workbook types for the Excel preview dialog.
// Agent: DEFINES SheetCell, SheetData, SpreadsheetWorkbook consumed by parse + grid components.

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
