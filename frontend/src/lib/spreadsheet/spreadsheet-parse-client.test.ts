// Human: Unit tests for hardened spreadsheet preview parsing and guardrails.
// Agent: ASSERTS thumbnail matrix extraction, cellFormula disabled, and byte limits.

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  assertSpreadsheetBufferWithinLimit,
  SpreadsheetParseLimitError,
  SPREADSHEET_THUMBNAIL_PARSE_MAX_BYTES,
} from "@/lib/spreadsheet/spreadsheet-parse-limits";
import {
  parseSpreadsheetThumbnailMatrix,
  parseSpreadsheetWorkbookInWorker,
} from "@/lib/spreadsheet/spreadsheet-parse-client";
import { thumbnailMatrixFromWorkbook } from "@/lib/spreadsheet/spreadsheet-thumbnail-matrix";

function buildSampleWorkbookBuffer(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Amount"],
    ["Widgets", 42],
    ["Gadgets", 7],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Summary");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("spreadsheet preview parsing", () => {
  it("builds a truncated thumbnail matrix from the first worksheet", () => {
    const buffer = buildSampleWorkbookBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellFormula: false });
    expect(thumbnailMatrixFromWorkbook(workbook)).toEqual([
      ["Name", "Amount"],
      ["Widgets", "42"],
      ["Gadgets", "7"],
    ]);
  });

  it("parses thumbnail previews without evaluating formulas", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([["=SUM(1,2)", "ok"]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const matrix = await parseSpreadsheetThumbnailMatrix(buffer);
    expect(matrix[0]?.[0]).not.toBe("3");
    expect(matrix[0]?.[1]).toBe("ok");
  });

  it("rejects thumbnail buffers above the client parse budget", async () => {
    const oversized = new ArrayBuffer(SPREADSHEET_THUMBNAIL_PARSE_MAX_BYTES + 1);
    await expect(parseSpreadsheetThumbnailMatrix(oversized)).rejects.toBeInstanceOf(
      SpreadsheetParseLimitError,
    );
  });

  it("parses editor workbooks through the hardened client path", async () => {
    const buffer = buildSampleWorkbookBuffer();
    const workbook = await parseSpreadsheetWorkbookInWorker(buffer);
    expect(workbook.SheetNames).toEqual(["Summary"]);
    expect(workbook.Sheets.Summary?.A1).toMatchObject({ v: "Name" });
  });
});

describe("assertSpreadsheetBufferWithinLimit", () => {
  it("throws when the buffer exceeds the configured max bytes", () => {
    const buffer = new ArrayBuffer(8);
    expect(() => assertSpreadsheetBufferWithinLimit(buffer, 4)).toThrow(SpreadsheetParseLimitError);
    expect(() => assertSpreadsheetBufferWithinLimit(buffer, 8)).not.toThrow();
  });
});
