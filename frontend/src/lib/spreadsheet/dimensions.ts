// Human: Column/row sizing helpers — defaults, xlsx conversion, and auto-fit like Excel.
// Agent: READS SheetJS !cols/!rows; WRITES display px arrays; RETURNS auto-fit widths/heights for grid.

import { scaledPx, EXCEL_DIALOG_SCALE } from "@/components/drive/excel/excel-dialog-scale";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";
import type * as XLSX from "xlsx";

// Human: Pencil grid baselines (pre-1.5× scale) — match ExcelSpreadsheetGrid design tokens.
// Agent: CONVERTED via scaledPx for on-screen CSS pixels.
export const GRID_DEFAULT_ROW_HEIGHT_BASE = 25;
export const GRID_HEADER_ROW_HEIGHT_BASE = 26;
export const GRID_ROW_INDEX_WIDTH_BASE = 40;
export const GRID_DEFAULT_COL_WIDTH_BASE = 100;
export const GRID_FIRST_COL_WIDTH_BASE = 179;
export const GRID_MIN_COL_WIDTH_BASE = 20;
export const GRID_MIN_ROW_HEIGHT_BASE = 14;

export const GRID_DEFAULT_ROW_HEIGHT = scaledPx(GRID_DEFAULT_ROW_HEIGHT_BASE);
export const GRID_HEADER_ROW_HEIGHT = scaledPx(GRID_HEADER_ROW_HEIGHT_BASE);
export const GRID_ROW_INDEX_WIDTH = scaledPx(GRID_ROW_INDEX_WIDTH_BASE);
export const GRID_DEFAULT_COL_WIDTH = scaledPx(GRID_DEFAULT_COL_WIDTH_BASE);
export const GRID_FIRST_COL_WIDTH = scaledPx(GRID_FIRST_COL_WIDTH_BASE);
export const GRID_MIN_COL_WIDTH = scaledPx(GRID_MIN_COL_WIDTH_BASE);
export const GRID_MIN_ROW_HEIGHT = scaledPx(GRID_MIN_ROW_HEIGHT_BASE);

// Human: Excel stores widths/heights in 96 dpi screen pixels; our UI is 1.5× Pencil scale.
// Agent: MULTIPLIES/DIVIDES by EXCEL_DIALOG_SCALE when crossing model ↔ file boundary.
export function wpxToDisplayPx(wpx: number): number {
  return Math.max(GRID_MIN_COL_WIDTH, Math.round(wpx * EXCEL_DIALOG_SCALE));
}

export function displayPxToWpx(displayPx: number): number {
  return Math.max(1, Math.round(displayPx / EXCEL_DIALOG_SCALE));
}

export function hpxToDisplayPx(hpx: number): number {
  return Math.max(GRID_MIN_ROW_HEIGHT, Math.round(hpx * EXCEL_DIALOG_SCALE));
}

export function displayPxToHpx(displayPx: number): number {
  return Math.max(1, Math.round(displayPx / EXCEL_DIALOG_SCALE));
}

// Human: Points (hpt) → screen pixels at 96 dpi, then apply dialog scale.
// Agent: USED when SheetJS exposes row height in points instead of hpx.
export function hptToDisplayPx(hpt: number): number {
  const screenPx = (hpt * 96) / 72;
  return hpxToDisplayPx(screenPx);
}

function defaultColumnWidth(colIndex: number): number {
  return colIndex === 0 ? GRID_FIRST_COL_WIDTH : GRID_DEFAULT_COL_WIDTH;
}

// Human: Build a full column-width array, filling gaps with Excel-like defaults.
// Agent: READS optional sheet.columnWidths; PADS to columnCount.
export function resolveColumnWidths(sheet: Pick<SheetData, "rows" | "columnWidths">, columnCount: number): number[] {
  return Array.from({ length: columnCount }, (_, colIndex) => {
    const stored = sheet.columnWidths?.[colIndex];
    if (typeof stored === "number" && stored > 0) return stored;
    return defaultColumnWidth(colIndex);
  });
}

// Human: Build a full row-height array, filling gaps with the default row height.
// Agent: READS optional sheet.rowHeights; PADS to rowCount.
export function resolveRowHeights(sheet: Pick<SheetData, "rows" | "rowHeights">, rowCount: number): number[] {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const stored = sheet.rowHeights?.[rowIndex];
    if (typeof stored === "number" && stored > 0) return stored;
    return GRID_DEFAULT_ROW_HEIGHT;
  });
}

// Human: Import !cols metadata from a parsed SheetJS worksheet.
// Agent: PREFERS wpx; FALLS BACK to wch/width; RETURNS display-pixel widths.
export function columnWidthsFromWorksheet(
  worksheet: XLSX.WorkSheet,
  columnCount: number,
): number[] {
  const cols = worksheet["!cols"] as Array<{ wpx?: number; wch?: number; width?: number }> | undefined;

  return Array.from({ length: columnCount }, (_, colIndex) => {
    const meta = cols?.[colIndex];
    if (meta?.wpx && meta.wpx > 0) return wpxToDisplayPx(meta.wpx);
    if (meta?.wch && meta.wch > 0) return wpxToDisplayPx(meta.wch * 7 + 5);
    if (meta?.width && meta.width > 0) return wpxToDisplayPx(meta.width * 7);
    return defaultColumnWidth(colIndex);
  });
}

// Human: Import !rows metadata from a parsed SheetJS worksheet.
// Agent: PREFERS hpx; FALLS BACK to hpt; RETURNS display-pixel heights.
export function rowHeightsFromWorksheet(worksheet: XLSX.WorkSheet, rowCount: number): number[] {
  const rowMeta = worksheet["!rows"] as Array<{ hpx?: number; hpt?: number }> | undefined;

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const meta = rowMeta?.[rowIndex];
    if (meta?.hpx && meta.hpx > 0) return hpxToDisplayPx(meta.hpx);
    if (meta?.hpt && meta.hpt > 0) return hptToDisplayPx(meta.hpt);
    return GRID_DEFAULT_ROW_HEIGHT;
  });
}

// Human: Persist grid dimensions onto a SheetJS worksheet before xlsx write.
// Agent: WRITES !cols and !rows using wpx/hpx derived from display pixels.
export function applyDimensionsToWorksheet(worksheet: XLSX.WorkSheet, sheet: SheetData): void {
  const columnCount = Math.max(...sheet.rows.map((row) => row.length), 1);
  const rowCount = sheet.rows.length;
  const widths = resolveColumnWidths(sheet, columnCount);
  const heights = resolveRowHeights(sheet, rowCount);

  worksheet["!cols"] = widths.map((width) => ({ wpx: displayPxToWpx(width) }));
  worksheet["!rows"] = heights.map((height) => ({ hpx: displayPxToHpx(height) }));
}

let measureCanvas: HTMLCanvasElement | null = null;

// Human: Measure rendered text width for auto-fit (Excel double-click column border).
// Agent: USES canvas measureText with grid font; RETURNS pixel width at display scale.
function measureTextWidth(text: string, fontSize: number, bold: boolean): number {
  if (typeof document === "undefined") {
    return text.length * fontSize * 0.55;
  }
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * fontSize * 0.55;
  context.font = `${bold ? "700" : "400"} ${fontSize}px Inter, system-ui, sans-serif`;
  return context.measureText(text).width;
}

// Human: Auto-fit one column to its widest cell content (Excel double-click column divider).
// Agent: SCANS rows[colIndex]; RETURNS clamped display width including cell padding.
export function autoFitColumnWidth(rows: SheetCell[][], colIndex: number): number {
  const fontSize = scaledPx(12);
  const badgeFontSize = scaledPx(10);
  const horizontalPadding = scaledPx(16);

  let maxContent = GRID_MIN_COL_WIDTH;
  for (const row of rows) {
    const cell = row[colIndex];
    if (!cell?.display) continue;
    const bold = Boolean(cell.style?.bold);
    const width = measureTextWidth(cell.display, fontSize, bold) + horizontalPadding;
    maxContent = Math.max(maxContent, width);
    if (cell.style?.isHeaderRow) {
      const badgeWidth = measureTextWidth(cell.display, badgeFontSize, true) + scaledPx(16);
      maxContent = Math.max(maxContent, badgeWidth);
    }
  }

  return Math.round(maxContent);
}

// Human: Auto-fit one row to tallest cell content (Excel double-click row divider).
// Agent: ESTIMATES wrapped line count from column width; RETURNS display height.
export function autoFitRowHeight(
  rows: SheetCell[][],
  rowIndex: number,
  columnWidths: number[],
): number {
  const row = rows[rowIndex] ?? [];
  const fontSize = scaledPx(12);
  const lineHeight = scaledPx(16);
  const verticalPadding = scaledPx(8);
  const minHeight = GRID_MIN_ROW_HEIGHT;

  let maxLines = 1;
  row.forEach((cell, colIndex) => {
    if (!cell?.display) return;
    const colWidth = columnWidths[colIndex] ?? GRID_DEFAULT_COL_WIDTH;
    const innerWidth = Math.max(colWidth - scaledPx(16), scaledPx(20));
    const textWidth = measureTextWidth(cell.display, fontSize, Boolean(cell.style?.bold));
    const lines = Math.max(1, Math.ceil(textWidth / innerWidth));
    maxLines = Math.max(maxLines, lines);
  });

  return Math.max(minHeight, maxLines * lineHeight + verticalPadding);
}
