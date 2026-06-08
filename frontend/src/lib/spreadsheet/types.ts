// Human: Shared spreadsheet workbook types for the Excel preview dialog.
// Agent: DEFINES SheetCell, SheetData, SpreadsheetWorkbook consumed by parse + grid components.

import type { ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";
import type { DataValidationRule } from "@/lib/spreadsheet/data-validation";
import type { NamedRange } from "@/lib/spreadsheet/named-ranges";

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type NumberFormat =
  | "general"
  | "currency"
  | "percent"
  | "number"
  | "accounting"
  | "date"
  | "time"
  | "datetime"
  | "scientific"
  | "fraction"
  | "text"
  | "custom";

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  horizontalAlign?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  numberFormat?: NumberFormat;
  // Human: Excel custom format code when numberFormat is "custom".
  // Agent: IMPORTED/EXPORTED via cell.z on serialize.
  customNumberFormat?: string;
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
  // Human: Hyperlink URL shown as blue underlined text in grid.
  // Agent: EDITED via Insert Link; EXPORTED via cell.l in SheetJS.
  hyperlink?: string;
};

// Human: Rectangular merged cell region (zero-based indices, inclusive).
// Agent: IMPORTED/EXPORTED via OOXML mergeCells; RENDERED in grid from top-left anchor.
export type MergedRegion = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type SheetChartType = "bar" | "line" | "pie" | "column";

export type SheetChart = {
  id: string;
  type: SheetChartType;
  title: string;
  anchorRow: number;
  anchorCol: number;
  dataStartRow: number;
  dataStartCol: number;
  dataEndRow: number;
  dataEndCol: number;
};

export type PageOrientation = "portrait" | "landscape";

export type PageSetup = {
  orientation?: PageOrientation;
  paperSize?: "letter" | "a4" | "legal";
  scalePercent?: number;
  fitToWidth?: number;
  fitToHeight?: number;
  printTitlesRows?: string;
  printTitlesCols?: string;
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
};

export type SheetProtection = {
  password?: string;
  locked?: boolean;
};

export type TrackChangeEntry = {
  id: string;
  timestamp: string;
  author: string;
  sheetName: string;
  cell: string;
  before: string;
  after: string;
};

export type SheetDrawingStroke = {
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
};

export type RowOutlineLevel = Record<number, number>;

export type SheetData = {
  name: string;
  rows: SheetCell[][];
  // Human: Per-sheet conditional formatting rules (imported from xlsx or added via ribbon).
  // Agent: READ by grid resolveConditionalFormat; WRITTEN on save via OOXML patch.
  conditionalFormats?: ConditionalFormatRule[];
  // Human: Column widths in on-screen CSS pixels (1.5× Pencil scale) — drag-resized like Excel.
  // Agent: IMPORTED from OOXML cols/row ht; WRITTEN on save via xlsx-dimensions-ooxml patch.
  columnWidths?: number[];
  // Human: Row heights in on-screen CSS pixels — drag-resized like Excel.
  // Agent: READ by virtualizer; IMPORTED from OOXML row ht; WRITTEN on save via OOXML patch.
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
  // Human: Merged cell regions for grid rendering and OOXML round-trip.
  // Agent: SET via mergeCellsInRange; READ by merge-regions helpers.
  mergedRegions?: MergedRegion[];
  // Human: Embedded charts anchored on the sheet grid.
  // Agent: INSERTED via chart dialog; EXPORTED via xlsx-charts-ooxml.
  charts?: SheetChart[];
  // Human: Page setup beyond margins — orientation, scale, titles, headers/footers.
  // Agent: EDITED via Page Setup dialog; EXPORTED via worksheet OOXML.
  pageSetup?: PageSetup;
  // Human: Sheet protection flag — blocks edits when locked without password.
  // Agent: SET via Protect Sheet dialog; CHECKED in useSpreadsheetEditor.
  protection?: SheetProtection;
  // Human: Row/column indices hidden from grid (View → Hide).
  // Agent: TOGGLED via workbook-ops; SKIPPED in virtualizer render.
  hiddenRows?: number[];
  hiddenCols?: number[];
  // Human: Tab color shown on sheet tabs bar.
  // Agent: SET via sheet tab context; RENDERED in ExcelSheetTabsBar.
  tabColor?: string;
  // Human: Ink strokes from Draw tab overlay.
  // Agent: STORED per sheet; RENDERED as SVG overlay on grid.
  drawings?: SheetDrawingStroke[];
  // Human: Row outline levels for group/ungroup (Data → Group).
  // Agent: INCREMENTED by groupRowsInRange; RENDERED as indent in grid.
  rowOutlineLevels?: RowOutlineLevel;
  // Human: View zoom percentage (50–200).
  // Agent: SET via status bar; APPLIED as CSS scale on grid container.
  zoomPercent?: number;
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
  // Human: Workbook-level change log for Review → Track Changes.
  // Agent: APPENDED on cell commits when tracking enabled.
  trackChanges?: TrackChangeEntry[];
  // Human: When true, new edits append to trackChanges.
  // Agent: TOGGLED from Review ribbon.
  trackChangesEnabled?: boolean;
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
