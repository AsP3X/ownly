// Human: Parse and serialize spreadsheet workbooks via SheetJS for the Excel dialog.
// Agent: READS ArrayBuffer/Blob; WRITES SpreadsheetWorkbook; SERIALIZES back to xlsx bytes on save.

import * as XLSX from "xlsx";
import { cellStyleFromXlsx, cellStyleToXlsx } from "@/lib/spreadsheet/cell-styles";
import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { recalculateWorkbook } from "@/lib/spreadsheet/formulas";
import {
  applyDimensionsToWorksheet,
  columnWidthsFromWorksheet,
  rowHeightsFromWorksheet,
  storedCustomColumnExtent,
  storedCustomRowExtent,
} from "@/lib/spreadsheet/dimensions";
import { normalizeSheetGrid, expandSheetToAddress, trimSheetForSave } from "@/lib/spreadsheet/grid";
import type { SheetCell, SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import { importConditionalFormatsFromXlsx, exportConditionalFormatsToXlsx, importFreezePanesFromXlsx, exportFreezePanesToXlsx } from "@/lib/spreadsheet/xlsx-ooxml";
import {
  exportWorkbookMetadataToXlsx,
  importCommentsFromXlsx,
  importDataValidationsFromXlsx,
  importNamedRangesFromXlsx,
  mergeCommentsIntoSheet,
} from "@/lib/spreadsheet/xlsx-metadata-ooxml";
import {
  exportPageSettingsToXlsx,
  importPageMarginsFromXlsx,
  importPrintAreasFromXlsx,
} from "@/lib/spreadsheet/xlsx-page-settings-ooxml";
import {
  exportDimensionsToXlsx,
  importDimensionsFromXlsx,
} from "@/lib/spreadsheet/xlsx-dimensions-ooxml";

function cellFromSheet(sheet: XLSX.WorkSheet, row: number, col: number): SheetCell {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const raw = sheet[address] as XLSX.CellObject | undefined;
  if (!raw) {
    return { value: null, display: "" };
  }

  const formula = typeof raw.f === "string" ? raw.f : undefined;
  const value =
    raw.v === undefined || raw.v === null
      ? null
      : typeof raw.v === "number" || typeof raw.v === "string"
        ? raw.v
        : String(raw.v);

  const numberFormat =
    typeof value === "number" && (String(raw.z ?? "").includes("$") || String(raw.w ?? "").includes("$"))
      ? "currency"
      : "general";

  const display =
    typeof raw.w === "string" && raw.w.length > 0
      ? raw.w
      : formatCellDisplay(value, numberFormat === "currency" ? "currency" : "general");

  const resolvedNumberFormat = numberFormat === "currency" ? "currency" : "general";

  return {
    value,
    formula,
    display,
    style: cellStyleFromXlsx(raw.s, resolvedNumberFormat, { bold: row === 0, isHeaderRow: row === 0 }),
  };
}

function sheetToRows(sheet: XLSX.WorkSheet): SheetCell[][] {
  const ref = sheet["!ref"];
  if (!ref) return [[{ value: null, display: "" }]];

  const range = XLSX.utils.decode_range(ref);
  const rows: SheetCell[][] = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells: SheetCell[] = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      cells.push(cellFromSheet(sheet, row, col));
    }
    rows.push(cells);
  }
  return rows.length > 0 ? rows : [[{ value: null, display: "" }]];
}

// Human: Parse uploaded spreadsheet bytes into an in-memory workbook model.
// Agent: READS ArrayBuffer; IMPORTS conditional formatting from OOXML; RETURNS SpreadsheetWorkbook.
export async function parseSpreadsheetBuffer(buffer: ArrayBuffer): Promise<SpreadsheetWorkbook> {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true, cellStyles: true });
  const sheetNames = workbook.SheetNames;
  const conditionalBySheet = await importConditionalFormatsFromXlsx(buffer, sheetNames);
  const freezeBySheet = await importFreezePanesFromXlsx(buffer, sheetNames);
  const commentsBySheet = await importCommentsFromXlsx(buffer, sheetNames);
  const validationsBySheet = await importDataValidationsFromXlsx(buffer, sheetNames);
  const namedRanges = await importNamedRangesFromXlsx(buffer);
  const printAreasBySheet = await importPrintAreasFromXlsx(buffer, sheetNames);
  const marginsBySheet = await importPageMarginsFromXlsx(buffer);
  const dimensionsBySheet = await importDimensionsFromXlsx(buffer, sheetNames);

  const sheets: SheetData[] = sheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const rows = sheetToRows(worksheet);
    const ooxmlDimensions = dimensionsBySheet.get(name);
    const importColumnCount = Math.max(
      ...rows.map((row) => row.length),
      1,
      storedCustomColumnExtent(ooxmlDimensions?.columnWidths),
    );
    const importRowCount = Math.max(
      rows.length,
      storedCustomRowExtent(ooxmlDimensions?.rowHeights),
    );
    const sheetJsColumnWidths = columnWidthsFromWorksheet(worksheet, importColumnCount);
    const sheetJsRowHeights = rowHeightsFromWorksheet(worksheet, importRowCount);
    const freeze = freezeBySheet.get(name);
    const imported: SheetData = {
      name,
      rows,
      conditionalFormats: conditionalBySheet.get(name),
      columnWidths: mergeImportedDimensions(importColumnCount, ooxmlDimensions?.columnWidths, sheetJsColumnWidths),
      rowHeights: mergeImportedDimensions(importRowCount, ooxmlDimensions?.rowHeights, sheetJsRowHeights),
      frozenRows: freeze?.frozenRows,
      frozenCols: freeze?.frozenCols,
      columnValidations: validationsBySheet.get(name),
      printArea: printAreasBySheet.get(name),
      pageMargins: marginsBySheet.get(name),
    };
    return normalizeSheetGrid(mergeCommentsIntoSheet(imported, commentsBySheet.get(name)));
  });

  return {
    sheets:
      sheets.length > 0
        ? sheets
        : [normalizeSheetGrid({ name: "Sheet1", rows: [[{ value: null, display: "" }]] })],
    namedRanges: namedRanges.length > 0 ? namedRanges : undefined,
  };
}

// Human: Prefer OOXML dimension arrays over SheetJS !cols/!rows (SheetJS often omits them).
// Agent: MERGES sparse OOXML arrays with SheetJS fallbacks per index.
function mergeImportedDimensions(
  count: number,
  ooxmlValues: number[] | undefined,
  fallbackValues: number[],
): number[] {
  return Array.from({ length: count }, (_, index) => ooxmlValues?.[index] ?? fallbackValues[index]);
}

// Human: Serialize the edited workbook back to an .xlsx Blob for cloud save.
// Agent: WRITES SheetJS workbook; PATCHES OOXML with conditional formatting rules; RETURNS Blob.
export async function serializeSpreadsheetWorkbook(workbook: SpreadsheetWorkbook): Promise<Blob> {
  const xlsxWorkbook = XLSX.utils.book_new();

  for (const sheet of workbook.sheets) {
    const trimmed = trimSheetForSave(sheet);
    const matrix = trimmed.rows.map((row) =>
      row.map((cell) => {
        if (cell.formula) return { f: cell.formula.replace(/^=/, ""), v: cell.value ?? undefined };
        return cell.value ?? "";
      }),
    );
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);

    // Human: Write per-cell styles from our model back into SheetJS cells.
    // Agent: PATCHES worksheet[addr].s after aoa_to_sheet for round-trip formatting.
    trimmed.rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const xlsxStyle = cellStyleToXlsx(cell.style);
        if (!xlsxStyle) return;
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const target = worksheet[address] as XLSX.CellObject | undefined;
        if (target) target.s = xlsxStyle;
      });
    });

    applyDimensionsToWorksheet(worksheet, trimmed);
    XLSX.utils.book_append_sheet(xlsxWorkbook, worksheet, sheet.name);
  }

  let bytes = XLSX.write(xlsxWorkbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  bytes = await exportConditionalFormatsToXlsx(bytes, workbook.sheets);
  bytes = await exportFreezePanesToXlsx(bytes, workbook.sheets);
  bytes = await exportWorkbookMetadataToXlsx(bytes, workbook);
  bytes = await exportPageSettingsToXlsx(bytes, workbook.sheets);
  bytes = await exportDimensionsToXlsx(bytes, workbook.sheets);

  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Human: Apply a formula-bar edit to the active cell in the workbook model.
// Agent: WRITES formula or literal value; UPDATES display string for grid rendering.
export function applyFormulaBarEdit(
  workbook: SpreadsheetWorkbook,
  sheetIndex: number,
  row: number,
  col: number,
  input: string,
): SpreadsheetWorkbook {
  const nextSheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;

    const expanded = expandSheetToAddress(sheet, row, col);
    const nextRows = expanded.rows.map((sheetRow, rowIndex) =>
      rowIndex === row
        ? sheetRow.map((cell, colIndex) => {
            if (colIndex !== col) return cell;
            const trimmed = input.trim();
            if (trimmed.startsWith("=")) {
              return {
                ...cell,
                formula: trimmed,
                value: trimmed,
                display: trimmed,
              };
            }
            const numeric = Number(trimmed.replace(/[$,%\s,]/g, ""));
            const value: string | number | null =
              trimmed === "" ? null : Number.isFinite(numeric) && trimmed !== "" ? numeric : trimmed;
            return {
              ...cell,
              formula: undefined,
              value,
              display: formatCellDisplay(value, cell.style?.numberFormat ?? "general"),
            };
          })
        : [...sheetRow],
    );
    return { ...expanded, rows: nextRows };
  });

  return recalculateWorkbook({ sheets: nextSheets });
}
