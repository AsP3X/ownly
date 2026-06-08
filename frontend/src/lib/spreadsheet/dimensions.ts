// Human: Column/row sizing helpers — defaults, xlsx conversion, and auto-fit like Excel.
// Agent: READS SheetJS !cols/!rows; WRITES display px arrays; RETURNS auto-fit widths/heights for grid.

import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";
import type * as XLSX from "xlsx";

// Human: Pencil grid baselines for row chrome; column widths match Excel 96 dpi screen pixels.
// Agent: ROW metrics use scaledPx; COLUMN widths use file screen px 1:1 (no dialog scale).
export const GRID_DEFAULT_ROW_HEIGHT_BASE = 25;
export const GRID_HEADER_ROW_HEIGHT_BASE = 26;
export const GRID_ROW_INDEX_WIDTH_BASE = 40;
// Human: Excel default column ≈ 8.43 characters (~64 screen px at 96 dpi).
export const GRID_DEFAULT_COL_WIDTH = 64;
export const GRID_MIN_COL_WIDTH = 20;
export const GRID_MAX_COL_WIDTH = 400;
export const GRID_MIN_ROW_HEIGHT_BASE = 14;

export const GRID_DEFAULT_ROW_HEIGHT = scaledPx(GRID_DEFAULT_ROW_HEIGHT_BASE);
export const GRID_HEADER_ROW_HEIGHT = scaledPx(GRID_HEADER_ROW_HEIGHT_BASE);
export const GRID_ROW_INDEX_WIDTH = scaledPx(GRID_ROW_INDEX_WIDTH_BASE);
export const GRID_MIN_ROW_HEIGHT = scaledPx(GRID_MIN_ROW_HEIGHT_BASE);

// Human: Clamp imported/resized column width to Excel-like bounds.
// Agent: PREVENTS oversized wpx/wch values from stretching the grid.
function clampColumnWidth(width: number): number {
  return Math.min(GRID_MAX_COL_WIDTH, Math.max(GRID_MIN_COL_WIDTH, Math.round(width)));
}

// Human: Excel wpx/wch are already 96 dpi screen pixels — map 1:1 to CSS pixels.
// Agent: DOES NOT apply dialog UI scale; USED on xlsx import/export.
export function wpxToDisplayPx(wpx: number): number {
  return clampColumnWidth(wpx);
}

export function displayPxToWpx(displayPx: number): number {
  return Math.max(1, Math.round(displayPx));
}

export function hpxToDisplayPx(hpx: number): number {
  return Math.max(GRID_MIN_ROW_HEIGHT, Math.round(hpx));
}

export function displayPxToHpx(displayPx: number): number {
  return Math.max(1, Math.round(displayPx));
}

// Human: Detect whether a stored width/height matches Excel defaults (skip OOXML write).
// Agent: USED by trimSheetForSave and xlsx-dimensions-ooxml export.
export function isDefaultColumnWidth(width: number): boolean {
  return Math.abs(width - GRID_DEFAULT_COL_WIDTH) <= 1;
}

export function isDefaultRowHeight(height: number): boolean {
  return Math.abs(height - GRID_DEFAULT_ROW_HEIGHT) <= 1;
}

// Human: Last index with a user-resized column or row (for save-range trimming).
// Agent: EXTENDS trimSheetForSave beyond cell content when dimensions were changed.
export function lastNonDefaultColumnIndex(widths: number[] | undefined): number {
  if (!widths) return -1;
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    if (!isDefaultColumnWidth(widths[index])) return index;
  }
  return -1;
}

export function lastNonDefaultRowIndex(heights: number[] | undefined): number {
  if (!heights) return -1;
  for (let index = heights.length - 1; index >= 0; index -= 1) {
    if (!isDefaultRowHeight(heights[index])) return index;
  }
  return -1;
}

// Human: Points (hpt) → screen pixels at 96 dpi.
// Agent: USED when SheetJS exposes row height in points instead of hpx.
export function hptToDisplayPx(hpt: number): number {
  const screenPx = (hpt * 96) / 72;
  return hpxToDisplayPx(screenPx);
}

// Human: Estimate column width from SheetJS col metadata (prefers wch over inflated wpx).
// Agent: READS !cols entry; RETURNS clamped CSS pixel width.
function columnWidthFromColMeta(meta: { wpx?: number; wch?: number; width?: number } | undefined): number {
  if (!meta) return GRID_DEFAULT_COL_WIDTH;

  if (meta.wch && meta.wch > 0) {
    return clampColumnWidth(meta.wch * 7 + 5);
  }

  if (meta.wpx && meta.wpx > 0) {
    return clampColumnWidth(meta.wpx);
  }

  if (meta.width && meta.width > 0) {
    return clampColumnWidth(meta.width * 7 + 5);
  }

  return GRID_DEFAULT_COL_WIDTH;
}

// Human: Build a full column-width array, filling gaps with the Excel default width.
// Agent: READS optional sheet.columnWidths; PADS to columnCount.
export function resolveColumnWidths(sheet: Pick<SheetData, "rows" | "columnWidths">, columnCount: number): number[] {
  return Array.from({ length: columnCount }, (_, colIndex) => {
    const stored = sheet.columnWidths?.[colIndex];
    if (typeof stored === "number" && stored > 0) return clampColumnWidth(stored);
    return GRID_DEFAULT_COL_WIDTH;
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

// Human: Import !cols metadata from a parsed SheetJS worksheet (data columns only).
// Agent: PREFERS wch; FALLS BACK to wpx; RETURNS clamped CSS pixel widths.
export function columnWidthsFromWorksheet(
  worksheet: XLSX.WorkSheet,
  columnCount: number,
): number[] {
  const cols = worksheet["!cols"] as Array<{ wpx?: number; wch?: number; width?: number }> | undefined;

  return Array.from({ length: columnCount }, (_, colIndex) => columnWidthFromColMeta(cols?.[colIndex]));
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

  return clampColumnWidth(maxContent);
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
