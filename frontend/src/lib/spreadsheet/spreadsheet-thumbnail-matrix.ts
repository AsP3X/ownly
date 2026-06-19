// Human: Build the explorer tile preview matrix from a parsed SheetJS worksheet.
// Agent: TRUNCATES rows/cols and cell text; PADS short rows to a uniform column count.

import * as XLSX from "xlsx";

export const THUMBNAIL_MAX_ROWS = 7;
export const THUMBNAIL_MAX_COLS = 5;
export const CELL_TEXT_MAX_LEN = 10;

// Human: Read the first worksheet into a small string matrix for tile previews.
// Agent: EXPECTS cellFormula disabled upstream; NEVER evaluates formulas here.
export function thumbnailMatrixFromWorkbook(workbook: XLSX.WorkBook): string[][] {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const ref = sheet["!ref"];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const rowEnd = Math.min(range.e.r, range.s.r + THUMBNAIL_MAX_ROWS - 1);
  const colEnd = Math.min(range.e.c, range.s.c + THUMBNAIL_MAX_COLS - 1);
  const colCount = colEnd - range.s.c + 1;

  const rows: string[][] = [];
  for (let row = range.s.r; row <= rowEnd; row += 1) {
    const cells: string[] = [];
    for (let col = range.s.c; col <= colEnd; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const raw = sheet[address] as XLSX.CellObject | undefined;
      const text =
        typeof raw?.w === "string" && raw.w.length > 0
          ? raw.w
          : raw?.v === undefined || raw.v === null
            ? ""
            : String(raw.v);
      cells.push(text.length > CELL_TEXT_MAX_LEN ? `${text.slice(0, CELL_TEXT_MAX_LEN)}…` : text);
    }
    while (cells.length < colCount) cells.push("");
    rows.push(cells);
  }

  return rows;
}
