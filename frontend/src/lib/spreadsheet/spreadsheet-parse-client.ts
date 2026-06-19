// Human: Main-thread dispatch for hardened spreadsheet parsing with worker fallback.
// Agent: ENFORCES byte/time limits; PREFERS spreadsheet-parse.worker; FALLBACK sync parse in tests.

import * as XLSX from "xlsx";
import {
  assertSpreadsheetBufferWithinLimit,
  SPREADSHEET_EDITOR_PARSE_MAX_BYTES,
  SPREADSHEET_EDITOR_PARSE_TIMEOUT_MS,
  SPREADSHEET_THUMBNAIL_PARSE_MAX_BYTES,
  SPREADSHEET_THUMBNAIL_PARSE_TIMEOUT_MS,
} from "@/lib/spreadsheet/spreadsheet-parse-limits";
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

let worker: Worker | null = null;
let workerRequestId = 0;
const workerWaiters = new Map<
  number,
  { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }
>();

function getSpreadsheetParseWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;

  worker = new Worker(new URL("./spreadsheet-parse.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data;
    const waiter = workerWaiters.get(data.id);
    if (!waiter) return;
    workerWaiters.delete(data.id);
    if (data.ok) {
      waiter.resolve(data);
      return;
    }
    waiter.reject(new Error(data.message));
  };

  worker.onerror = () => {
    for (const [, waiter] of workerWaiters) {
      waiter.reject(new Error("spreadsheet parse worker crashed"));
    }
    workerWaiters.clear();
    worker = null;
  };

  return worker;
}

function withParseTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function readWorkbookOnMainThread(buffer: ArrayBuffer, options: WorkbookParseOptions): XLSX.WorkBook {
  return XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellFormula: options.cellFormula,
    cellStyles: options.cellStyles,
  });
}

function dispatchParseRequest(
  buffer: ArrayBuffer,
  mode: SpreadsheetParseMode,
  options: WorkbookParseOptions,
  timeoutMs: number,
): Promise<WorkerResponse> {
  const activeWorker = getSpreadsheetParseWorker();
  if (!activeWorker) {
    const workbook = readWorkbookOnMainThread(buffer, options);
    if (mode === "thumbnail") {
      return Promise.resolve({
        id: -1,
        ok: true,
        mode: "thumbnail",
        matrix: thumbnailMatrixFromWorkbook(workbook),
      });
    }
    return Promise.resolve({
      id: -1,
      ok: true,
      mode: "workbook",
      sheetNames: workbook.SheetNames,
      sheets: workbook.Sheets,
    });
  }

  const id = workerRequestId + 1;
  workerRequestId = id;

  const requestPromise = new Promise<WorkerResponse>((resolve, reject) => {
    workerWaiters.set(id, { resolve, reject });
    // Human: Keep buffer on the main thread — editor parsing still needs it for OOXML imports.
    // Agent: POST without transfer list so ArrayBuffer remains readable after worker parse.
    activeWorker.postMessage({ id, buffer, mode, options } satisfies WorkerRequest);
  });

  return withParseTimeout(requestPromise, timeoutMs, "Spreadsheet parsing");
}

// Human: Parse spreadsheet bytes into a SheetJS workbook snapshot off the main thread.
// Agent: USED by parseSpreadsheetBuffer; ENABLES formulas/styles for the Excel editor path.
export async function parseSpreadsheetWorkbookInWorker(
  buffer: ArrayBuffer,
  options: WorkbookParseOptions = { cellFormula: true, cellStyles: true },
): Promise<XLSX.WorkBook> {
  assertSpreadsheetBufferWithinLimit(buffer, SPREADSHEET_EDITOR_PARSE_MAX_BYTES);

  const response = await dispatchParseRequest(
    buffer,
    "workbook",
    options,
    SPREADSHEET_EDITOR_PARSE_TIMEOUT_MS,
  );

  if (!response.ok || response.mode !== "workbook") {
    throw new Error("Spreadsheet workbook parse failed.");
  }

  return {
    SheetNames: response.sheetNames,
    Sheets: response.sheets,
  };
}

// Human: Parse only enough sheet data for explorer tile previews.
// Agent: DISABLES cellFormula/cellStyles; RETURNS truncated string matrix.
export async function parseSpreadsheetThumbnailMatrix(buffer: ArrayBuffer): Promise<string[][]> {
  assertSpreadsheetBufferWithinLimit(buffer, SPREADSHEET_THUMBNAIL_PARSE_MAX_BYTES);

  const previewOptions: WorkbookParseOptions = { cellFormula: false, cellStyles: false };
  const response = await dispatchParseRequest(
    buffer,
    "thumbnail",
    previewOptions,
    SPREADSHEET_THUMBNAIL_PARSE_TIMEOUT_MS,
  );

  if (!response.ok || response.mode !== "thumbnail") {
    throw new Error("Spreadsheet thumbnail parse failed.");
  }

  return response.matrix;
}
