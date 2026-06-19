// Human: Off-main-thread SheetJS parsing for untrusted spreadsheet uploads.
// Agent: RECEIVES ArrayBuffer + mode; RETURNS workbook snapshot or thumbnail matrix.

import * as XLSX from "xlsx";
import { thumbnailMatrixFromWorkbook } from "@/lib/spreadsheet/spreadsheet-thumbnail-matrix";

type SpreadsheetParseMode = "workbook" | "thumbnail";

type WorkbookParseOptions = {
  cellFormula: boolean;
  cellStyles: boolean;
};

type WorkerRequest = {
  id: number;
  buffer: ArrayBuffer;
  mode: SpreadsheetParseMode;
  options: WorkbookParseOptions;
};

type WorkerResponse =
  | {
      id: number;
      ok: true;
      mode: "workbook";
      sheetNames: string[];
      sheets: Record<string, XLSX.WorkSheet>;
    }
  | { id: number; ok: true; mode: "thumbnail"; matrix: string[][] }
  | { id: number; ok: false; message: string };

function readWorkbook(buffer: ArrayBuffer, options: WorkbookParseOptions): XLSX.WorkBook {
  return XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellFormula: options.cellFormula,
    cellStyles: options.cellStyles,
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, mode, options } = event.data;

  try {
    const workbook = readWorkbook(buffer, options);

    if (mode === "thumbnail") {
      const matrix = thumbnailMatrixFromWorkbook(workbook);
      const response: WorkerResponse = { id, ok: true, mode: "thumbnail", matrix };
      self.postMessage(response);
      return;
    }

    const response: WorkerResponse = {
      id,
      ok: true,
      mode: "workbook",
      sheetNames: workbook.SheetNames,
      sheets: workbook.Sheets,
    };
    self.postMessage(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "spreadsheet parse worker failed";
    const response: WorkerResponse = { id, ok: false, message };
    self.postMessage(response);
  }
};
