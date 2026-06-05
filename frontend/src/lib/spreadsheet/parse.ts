// Human: Parse and serialize spreadsheet workbooks via SheetJS for the Excel dialog.
// Agent: READS ArrayBuffer/Blob; WRITES SpreadsheetWorkbook; SERIALIZES back to xlsx bytes on save.

import * as XLSX from "xlsx";
import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import {
  applyDimensionsToWorksheet,
  columnWidthsFromWorksheet,
  rowHeightsFromWorksheet,
} from "@/lib/spreadsheet/dimensions";
import type { SheetCell, SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import { importConditionalFormatsFromXlsx, exportConditionalFormatsToXlsx } from "@/lib/spreadsheet/xlsx-ooxml";

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

  return {
    value,
    formula,
    display,
    style: {
      numberFormat: numberFormat === "currency" ? "currency" : "general",
      bold: row === 0,
      isHeaderRow: row === 0,
    },
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
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
  const sheetNames = workbook.SheetNames;
  const conditionalBySheet = await importConditionalFormatsFromXlsx(buffer, sheetNames);

  const sheets: SheetData[] = sheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const rows = sheetToRows(worksheet);
    const columnCount = Math.max(...rows.map((row) => row.length), 1);
    return {
      name,
      rows,
      conditionalFormats: conditionalBySheet.get(name),
      columnWidths: columnWidthsFromWorksheet(worksheet, columnCount),
      rowHeights: rowHeightsFromWorksheet(worksheet, rows.length),
    };
  });

  return { sheets: sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [[{ value: null, display: "" }]] }] };
}

// Human: Serialize the edited workbook back to an .xlsx Blob for cloud save.
// Agent: WRITES SheetJS workbook; PATCHES OOXML with conditional formatting rules; RETURNS Blob.
export async function serializeSpreadsheetWorkbook(workbook: SpreadsheetWorkbook): Promise<Blob> {
  const xlsxWorkbook = XLSX.utils.book_new();

  for (const sheet of workbook.sheets) {
    const matrix = sheet.rows.map((row) =>
      row.map((cell) => {
        if (cell.formula) return { f: cell.formula.replace(/^=/, ""), v: cell.value ?? undefined };
        return cell.value ?? "";
      }),
    );
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    applyDimensionsToWorksheet(worksheet, sheet);
    XLSX.utils.book_append_sheet(xlsxWorkbook, worksheet, sheet.name);
  }

  let bytes = XLSX.write(xlsxWorkbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  bytes = await exportConditionalFormatsToXlsx(bytes, workbook.sheets);

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
    const nextRows = sheet.rows.map((sheetRow, rowIndex) =>
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
    return { ...sheet, rows: nextRows };
  });

  return { sheets: nextSheets };
}
