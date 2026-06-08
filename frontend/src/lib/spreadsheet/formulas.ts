// Human: Formula parser and evaluator for spreadsheet recalculation.
// Agent: READS cell refs + ranges; EVALUATES common Excel functions; UPDATES display values.

import { columnIndexToLetters, columnLettersToIndex, formatCellDisplay } from "@/lib/spreadsheet/cells";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

export type FormulaError = "#ERROR!" | "#DIV/0!" | "#REF!" | "#VALUE!" | "#N/A";

type EvalContext = {
  sheets: SheetData[];
  sheetIndex: number;
  row: number;
  col: number;
  visiting: Set<string>;
  cache: Map<string, string | number | boolean | null | FormulaError>;
};

function cellKey(sheetIndex: number, row: number, col: number): string {
  return `${sheetIndex}:${row}:${col}`;
}

function parseCellRef(raw: string): { row: number; col: number } | null {
  const match = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const col = columnLettersToIndex(match[2].toUpperCase());
  const row = Number(match[4]) - 1;
  if (col === null || !Number.isFinite(row) || row < 0) return null;
  return { row, col };
}

function parseRangeRef(raw: string): CellRange | null {
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return null;
  return normalizeRange({ start, end });
}

function coerceNumber(value: string | number | boolean | null | FormulaError): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === "") return 0;
  if (typeof value === "string" && value.startsWith("#")) return NaN;
  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getRawCellValue(ctx: EvalContext, sheetIndex: number, row: number, col: number) {
  const cell = ctx.sheets[sheetIndex]?.rows[row]?.[col];
  if (!cell) return null;
  if (cell.formula) return evaluateFormulaCell(ctx, sheetIndex, row, col, cell.formula);
  return cell.value;
}

function evaluateFormulaCell(
  ctx: EvalContext,
  sheetIndex: number,
  row: number,
  col: number,
  formula: string,
): string | number | boolean | null | FormulaError {
  const key = cellKey(sheetIndex, row, col);
  if (ctx.visiting.has(key)) return "#ERROR!" as FormulaError;
  if (ctx.cache.has(key)) return ctx.cache.get(key)!;

  ctx.visiting.add(key);
  const expression = formula.startsWith("=") ? formula.slice(1) : formula;
  const result = evaluateExpression(ctx, sheetIndex, row, col, expression);
  ctx.visiting.delete(key);
  ctx.cache.set(key, result);
  return result;
}

function collectRangeValues(ctx: EvalContext, sheetIndex: number, range: CellRange) {
  const values: Array<string | number | boolean | null | FormulaError> = [];
  const normalized = normalizeRange(range);
  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    for (let col = normalized.start.col; col <= normalized.end.col; col += 1) {
      values.push(getRawCellValue(ctx, sheetIndex, row, col));
    }
  }
  return values;
}

function collectRangeValuesFromArg(
  ctx: EvalContext,
  sheetIndex: number,
  _row: number,
  _col: number,
  arg: string,
): Array<string | number | boolean | null | FormulaError> {
  const range = parseRangeRef(arg.replace(/\$/g, ""));
  if (range) return collectRangeValues(ctx, sheetIndex, range);
  const single = parseCellRef(arg.replace(/\$/g, ""));
  if (single) return [getRawCellValue(ctx, sheetIndex, single.row, single.col)];
  return [];
}

function getTableFromRangeArg(
  ctx: EvalContext,
  sheetIndex: number,
  arg: string,
): Array<Array<string | number | boolean | null | FormulaError>> {
  const range = parseRangeRef(arg.replace(/\$/g, ""));
  if (!range) return [];
  const normalized = normalizeRange(range);
  const table: Array<Array<string | number | boolean | null | FormulaError>> = [];
  for (let r = normalized.start.row; r <= normalized.end.row; r += 1) {
    const rowValues: Array<string | number | boolean | null | FormulaError> = [];
    for (let c = normalized.start.col; c <= normalized.end.col; c += 1) {
      rowValues.push(getRawCellValue(ctx, sheetIndex, r, c));
    }
    table.push(rowValues);
  }
  return table;
}

function countIfValues(
  values: Array<string | number | boolean | null | FormulaError>,
  criteria: string,
): number {
  const trimmed = criteria.trim();
  const opMatch = /^([><]=?|=)(.+)$/.exec(trimmed);
  if (opMatch) {
    const op = opMatch[1];
    const target = Number(opMatch[2].replace(/[$,%\s,]/g, ""));
    return values.filter((value) => {
      const num = coerceNumber(value);
      if (!Number.isFinite(num) || !Number.isFinite(target)) return false;
      switch (op) {
        case ">":
          return num > target;
        case ">=":
          return num >= target;
        case "<":
          return num < target;
        case "<=":
          return num <= target;
        case "=":
          return num === target;
        default:
          return false;
      }
    }).length;
  }

  const normalizedCriteria = trimmed.replace(/^"|"$/g, "").toLowerCase();
  return values.filter((value) => String(value ?? "").toLowerCase().includes(normalizedCriteria)).length;
}

function evaluateFunction(
  ctx: EvalContext,
  sheetIndex: number,
  row: number,
  col: number,
  name: string,
  argsRaw: string,
): string | number | boolean | null | FormulaError {
  const upper = name.toUpperCase();
  const args = splitFunctionArgs(argsRaw).map((arg) =>
    evaluateExpression(ctx, sheetIndex, row, col, arg.trim()),
  );

  const numericArgs = args.map((value) => coerceNumber(value)).filter((value) => Number.isFinite(value));

  switch (upper) {
    case "SUM":
      return numericArgs.reduce((sum, value) => sum + value, 0);
    case "AVERAGE":
      return numericArgs.length === 0 ? "#DIV/0!" : numericArgs.reduce((a, b) => a + b, 0) / numericArgs.length;
    case "COUNT":
      return numericArgs.length;
    case "MIN":
      return numericArgs.length === 0 ? 0 : Math.min(...numericArgs);
    case "MAX":
      return numericArgs.length === 0 ? 0 : Math.max(...numericArgs);
    case "ABS":
      return Math.abs(coerceNumber(args[0]));
    case "ROUND":
      return Math.round(coerceNumber(args[0]));
    case "IF": {
      const condition = Boolean(args[0]);
      return condition ? args[1] ?? null : args[2] ?? null;
    }
    case "AND":
      return args.every(Boolean);
    case "OR":
      return args.some(Boolean);
    case "NOT":
      return !args[0];
    case "CONCATENATE":
    case "CONCAT":
      return args.map((value) => (value === null ? "" : String(value))).join("");
    case "LEN":
      return String(args[0] ?? "").length;
    case "UPPER":
      return String(args[0] ?? "").toUpperCase();
    case "LOWER":
      return String(args[0] ?? "").toLowerCase();
    case "TRIM":
      return String(args[0] ?? "").trim();
    case "TODAY":
      return new Date().toISOString().slice(0, 10);
    case "NOW":
      return new Date().toISOString().replace("T", " ").slice(0, 19);
    case "COUNTIF": {
      const parts = splitFunctionArgs(argsRaw);
      const rangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const criteria = parts[1]?.trim() ?? String(args[1] ?? "");
      return countIfValues(rangeValues, criteria);
    }
    case "VLOOKUP": {
      const lookup = args[0];
      const tableArg = splitFunctionArgs(argsRaw)[1]?.trim() ?? "";
      const colIndex = Math.max(1, Math.round(coerceNumber(args[2])));
      const table = getTableFromRangeArg(ctx, sheetIndex, tableArg);
      if (!table.length) return "#N/A" as FormulaError;
      const lookupText = String(lookup ?? "").toLowerCase();
      for (const tableRow of table) {
        const first = tableRow[0];
        if (String(first ?? "").toLowerCase() === lookupText) {
          return tableRow[colIndex - 1] ?? "#N/A";
        }
      }
      return "#N/A" as FormulaError;
    }
    case "MATCH": {
      const lookup = String(args[0] ?? "").toLowerCase();
      const rangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, splitFunctionArgs(argsRaw)[1]?.trim() ?? "");
      const index = rangeValues.findIndex((value) => String(value ?? "").toLowerCase() === lookup);
      return index >= 0 ? index + 1 : "#N/A";
    }
    default:
      return "#NAME?" as FormulaError;
  }
}

function splitFunctionArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      inString = !inString;
      current += char;
      continue;
    }
    if (!inString && char === "(") depth += 1;
    if (!inString && char === ")") depth -= 1;
    if (!inString && depth === 0 && char === ",") {
      args.push(current);
      current = "";
      continue;
    }
    if (!inString && depth === 0 && char === ";") {
      args.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current);
  return args;
}

function evaluateExpression(
  ctx: EvalContext,
  sheetIndex: number,
  row: number,
  col: number,
  expression: string,
): string | number | boolean | null | FormulaError {
  let expr = expression.trim();
  if (!expr) return null;

  // Human: Replace quoted strings with placeholders so range parsing does not break.
  const strings: string[] = [];
  expr = expr.replace(/"([^"]*)"/g, (_match, value: string) => {
    strings.push(value);
    return `__STR${strings.length - 1}__`;
  });

  // Human: Function calls like SUM(A1:A10).
  expr = expr.replace(/([A-Za-z_][A-Za-z0-9_]*)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (_match, fn: string, args: string) => {
    const value = evaluateFunction(ctx, sheetIndex, row, col, fn, args);
    if (typeof value === "string" && value.startsWith("#")) return `"${value}"`;
    if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
    return String(value);
  });

  // Human: Range references in standalone function args already handled; expand A1:A3 patterns for inline math.
  expr = expr.replace(/([A-Za-z]+\d+):([A-Za-z]+\d+)/g, (match) => {
    const range = parseRangeRef(match);
    if (!range) return match;
    const values = collectRangeValues(ctx, sheetIndex, range)
      .map((value) => coerceNumber(value))
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? values.join("+") : "0";
  });

  // Human: Single cell references.
  expr = expr.replace(/([A-Za-z]+\d+)/g, (match) => {
    const ref = parseCellRef(match);
    if (!ref) return match;
    const value = getRawCellValue(ctx, sheetIndex, ref.row, ref.col);
    if (typeof value === "string" && value.startsWith("#")) return "0";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "1" : "0";
    if (value === null) return "0";
    const numeric = coerceNumber(value);
    return Number.isFinite(numeric) ? String(numeric) : `"${String(value)}"`;
  });

  expr = expr.replace(/__STR(\d+)__/g, (_match, index: string) => `"${strings[Number(index)]}"`);

  // Human: Excel string concatenation with &.
  expr = expr.replace(/&/g, "+");

  try {
    if (/[^0-9+\-*/().\s"]/.test(expr.replace(/"[^"]*"/g, ""))) return "#ERROR!";
    const evaluated = Function(`"use strict"; return (${expr});`)() as unknown;
    if (typeof evaluated === "number" && !Number.isFinite(evaluated)) return "#DIV/0!";
    if (typeof evaluated === "boolean") return evaluated;
    if (typeof evaluated === "number") return evaluated;
    if (typeof evaluated === "string") return evaluated.replace(/^"|"$/g, "");
    return evaluated === undefined || evaluated === null ? null : String(evaluated);
  } catch {
    return "#ERROR!";
  }
}

function displayFromEvaluated(
  value: string | number | boolean | null | FormulaError,
  numberFormat?: "general" | "currency" | "percent" | "number",
): string {
  if (typeof value === "string" && value.startsWith("#")) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return formatCellDisplay(value as string | number | null, numberFormat ?? "general");
}

// Human: Recalculate every formula cell in one sheet and refresh display strings.
// Agent: USES dependency cache per recalc pass; RETURNS updated SheetData.
export function recalculateSheet(sheet: SheetData, sheetIndex: number, allSheets: SheetData[]): SheetData {
  const ctx: EvalContext = {
    sheets: allSheets,
    sheetIndex,
    row: 0,
    col: 0,
    visiting: new Set(),
    cache: new Map(),
  };

  const nextRows = sheet.rows.map((row, rowIndex) =>
    row.map((cell, colIndex) => {
      if (!cell.formula) return cell;
      const evaluated = evaluateFormulaCell(ctx, sheetIndex, rowIndex, colIndex, cell.formula);
      return {
        ...cell,
        value: typeof evaluated === "boolean" ? (evaluated ? 1 : 0) : evaluated,
        display: displayFromEvaluated(evaluated, cell.style?.numberFormat),
      };
    }),
  );

  return { ...sheet, rows: nextRows };
}

// Human: Recalculate all sheets in workbook after edits.
// Agent: CALLS recalculateSheet per index; RETURNS new workbook reference.
export function recalculateWorkbook(workbook: SpreadsheetWorkbook): SpreadsheetWorkbook {
  try {
    let sheets = workbook.sheets;
    sheets = sheets.map((sheet, index) => recalculateSheet(sheet, index, sheets));
    return { sheets };
  } catch {
    return workbook;
  }
}

// Human: Insert AutoSum formula for selected column range above active cell.
// Agent: RETURNS formula string like =SUM(A2:A10).
export function buildAutoSumFormula(range: CellRange): string {
  const normalized = normalizeRange(range);
  const startLabel = `${columnIndexToLetters(normalized.start.col)}${normalized.start.row + 1}`;
  const endLabel = `${columnIndexToLetters(normalized.end.col)}${normalized.end.row + 1}`;
  if (startLabel === endLabel) return `=${startLabel}`;
  return `=SUM(${startLabel}:${endLabel})`;
}
