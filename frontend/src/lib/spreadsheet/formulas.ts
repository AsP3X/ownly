// Human: Formula parser and evaluator for spreadsheet recalculation.
// Agent: READS cell refs + ranges; EVALUATES common Excel functions; UPDATES display values.

import { columnIndexToLetters, columnLettersToIndex, formatCellDisplay } from "@/lib/spreadsheet/cells";
import {
  evalArrayFirstValue,
  evalFilter,
  evalSequence,
  evalSort,
  evalSortBy,
  evalUnique,
  isEvalArray,
  type EvalArray,
} from "@/lib/spreadsheet/formula-dynamic-arrays";
import { evaluateExtendedFunction } from "@/lib/spreadsheet/formula-extended";
import {
  SHEET_QUALIFIED_CELL_PATTERN,
  SHEET_QUALIFIED_RANGE_PATTERN,
  splitSheetQualifiedToken,
} from "@/lib/spreadsheet/formula-sheet-refs";
import { parseTableColumnRef, resolveTableColumnIndex } from "@/lib/spreadsheet/formula-table-refs";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import { findNamedRange } from "@/lib/spreadsheet/named-ranges";

export type FormulaEvalResult = string | number | boolean | null | FormulaError | EvalArray;

export type FormulaError = "#ERROR!" | "#DIV/0!" | "#REF!" | "#VALUE!" | "#N/A" | "#NUM!" | "#NAME?";

type FormulaScalar = string | number | boolean | null | FormulaError;

// Human: Collapse dynamic-array results to a single scalar for legacy formula paths.
// Agent: RETURNS first spill value when result is EvalArray.
function toScalar(value: FormulaEvalResult): FormulaScalar {
  if (isEvalArray(value)) return evalArrayFirstValue(value);
  return value;
}

type EvalContext = {
  sheets: SheetData[];
  sheetIndex: number;
  row: number;
  col: number;
  visiting: Set<string>;
  cache: Map<string, FormulaEvalResult>;
  namedRanges?: SpreadsheetWorkbook["namedRanges"];
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

function coerceNumber(value: FormulaEvalResult | FormulaScalar): number {
  const scalar = toScalar(value as FormulaEvalResult);
  if (typeof scalar === "number") return scalar;
  if (typeof scalar === "boolean") return scalar ? 1 : 0;
  if (scalar === null || scalar === "") return 0;
  if (typeof scalar === "string" && scalar.startsWith("#")) return NaN;
  const parsed = Number(String(scalar).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getRawCellValue(ctx: EvalContext, sheetIndex: number, row: number, col: number): FormulaScalar {
  const cell = ctx.sheets[sheetIndex]?.rows[row]?.[col];
  if (!cell) return null;
  if (cell.formula) return toScalar(evaluateFormulaCell(ctx, sheetIndex, row, col, cell.formula));
  return cell.value;
}

function evaluateFormulaCell(
  ctx: EvalContext,
  sheetIndex: number,
  row: number,
  col: number,
  formula: string,
): FormulaEvalResult {
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
  const trimmed = arg.trim();

  const tableRef = parseTableColumnRef(trimmed);
  if (tableRef) {
    const sheet = ctx.sheets[sheetIndex];
    const resolved = resolveTableColumnIndex(sheet, tableRef.tableName, tableRef.columnName);
    if (resolved) {
      const values: Array<string | number | boolean | null | FormulaError> = [];
      for (let row = resolved.tableStartRow + 1; row <= resolved.tableEndRow; row += 1) {
        values.push(getRawCellValue(ctx, sheetIndex, row, resolved.col));
      }
      return values;
    }
  }

  const named = findNamedRange(ctx.namedRanges, trimmed);
  if (named) {
    const targetSheetIndex = ctx.sheets.findIndex((sheet) => sheet.name === named.sheetName);
    const resolvedSheetIndex = targetSheetIndex >= 0 ? targetSheetIndex : sheetIndex;
    return collectRangeValues(ctx, resolvedSheetIndex, {
      start: { row: named.startRow, col: named.startCol },
      end: { row: named.endRow, col: named.endCol },
    });
  }

  const { sheetIndex: resolvedSheetIndex, refPart } = splitSheetQualifiedToken(
    trimmed,
    ctx.sheets,
    sheetIndex,
  );
  const range = parseRangeRef(refPart.replace(/\$/g, ""));
  if (range) return collectRangeValues(ctx, resolvedSheetIndex, range);
  const single = parseCellRef(refPart.replace(/\$/g, ""));
  if (single) return [getRawCellValue(ctx, resolvedSheetIndex, single.row, single.col)];
  return [];
}

function getTableFromRangeArg(
  ctx: EvalContext,
  sheetIndex: number,
  arg: string,
): Array<Array<string | number | boolean | null | FormulaError>> {
  const trimmed = arg.trim();
  const named = findNamedRange(ctx.namedRanges, trimmed);
  if (named) {
    const targetSheetIndex = ctx.sheets.findIndex((sheet) => sheet.name === named.sheetName);
    const resolvedSheetIndex = targetSheetIndex >= 0 ? targetSheetIndex : sheetIndex;
    const table: Array<Array<string | number | boolean | null | FormulaError>> = [];
    for (let r = named.startRow; r <= named.endRow; r += 1) {
      const rowValues: Array<string | number | boolean | null | FormulaError> = [];
      for (let c = named.startCol; c <= named.endCol; c += 1) {
        rowValues.push(getRawCellValue(ctx, resolvedSheetIndex, r, c));
      }
      table.push(rowValues);
    }
    return table;
  }

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

// Human: Test whether a row index satisfies paired range/criteria args for SUMIFS/COUNTIFS.
// Agent: READS criteria ranges at valueIndex; RETURNS true when every pair matches.
function matchesAllCriteria(
  ctx: EvalContext,
  sheetIndex: number,
  row: number,
  col: number,
  parts: string[],
  valueIndex: number,
  startPairIndex: number,
): boolean {
  for (let pairIndex = startPairIndex; pairIndex + 1 < parts.length; pairIndex += 2) {
    const rangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[pairIndex]?.trim() ?? "");
    const criteria = parts[pairIndex + 1]?.trim() ?? "";
    const value = rangeValues[valueIndex];
    if (countIfValues([value], criteria) <= 0) return false;
  }
  return true;
}

function evaluateFunction(
  ctx: EvalContext,
  sheetIndex: number,
  row: number,
  col: number,
  name: string,
  argsRaw: string,
): FormulaEvalResult {
  const upper = name.toUpperCase();
  const args = splitFunctionArgs(argsRaw).map((arg) =>
    toScalar(evaluateExpression(ctx, sheetIndex, row, col, arg.trim())),
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
    case "ROUND": {
      const value = coerceNumber(args[0]);
      const digits = args.length > 1 ? Math.round(coerceNumber(args[1])) : 0;
      if (!Number.isFinite(value)) return "#VALUE!" as FormulaError;
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    }
    case "ROUNDUP": {
      const value = coerceNumber(args[0]);
      const digits = args.length > 1 ? Math.round(coerceNumber(args[1])) : 0;
      if (!Number.isFinite(value)) return "#VALUE!" as FormulaError;
      const factor = 10 ** digits;
      return value >= 0 ? Math.ceil(value * factor) / factor : Math.floor(value * factor) / factor;
    }
    case "ROUNDDOWN": {
      const value = coerceNumber(args[0]);
      const digits = args.length > 1 ? Math.round(coerceNumber(args[1])) : 0;
      if (!Number.isFinite(value)) return "#VALUE!" as FormulaError;
      const factor = 10 ** digits;
      return value >= 0 ? Math.floor(value * factor) / factor : Math.ceil(value * factor) / factor;
    }
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
    case "LEFT": {
      const text = String(args[0] ?? "");
      const count = Math.max(0, Math.round(coerceNumber(args[1] ?? 1)));
      return text.slice(0, count);
    }
    case "RIGHT": {
      const text = String(args[0] ?? "");
      const count = Math.max(0, Math.round(coerceNumber(args[1] ?? 1)));
      return text.slice(Math.max(0, text.length - count));
    }
    case "MID": {
      const text = String(args[0] ?? "");
      const start = Math.max(1, Math.round(coerceNumber(args[1])));
      const length = Math.max(0, Math.round(coerceNumber(args[2] ?? 0)));
      return text.slice(start - 1, start - 1 + length);
    }
    case "TEXT": {
      const value = args[0];
      const format = String(args[1] ?? "General");
      if (typeof value === "number" && format.includes("%")) {
        return `${(value * 100).toFixed(format.split("%").length > 1 ? 0 : 0)}%`;
      }
      if (typeof value === "number" && (format.includes("$") || format.includes("0.00"))) {
        return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
      }
      if (typeof value === "number") return String(value);
      return String(value ?? "");
    }
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
    case "SUMIF": {
      const parts = splitFunctionArgs(argsRaw);
      const rangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const criteria = parts[1]?.trim() ?? String(args[1] ?? "");
      const sumRangeValues =
        parts[2]?.trim()
          ? collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[2].trim())
          : rangeValues;
      let total = 0;
      rangeValues.forEach((value, index) => {
        const matches = countIfValues([value], criteria) > 0;
        if (!matches) return;
        const numeric = coerceNumber(sumRangeValues[index] ?? value);
        if (Number.isFinite(numeric)) total += numeric;
      });
      return total;
    }
    case "AVERAGEIF": {
      const parts = splitFunctionArgs(argsRaw);
      const rangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const criteria = parts[1]?.trim() ?? String(args[1] ?? "");
      const averageRangeValues =
        parts[2]?.trim()
          ? collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[2].trim())
          : rangeValues;
      let total = 0;
      let count = 0;
      rangeValues.forEach((value, index) => {
        if (countIfValues([value], criteria) <= 0) return;
        const numeric = coerceNumber(averageRangeValues[index] ?? value);
        if (!Number.isFinite(numeric)) return;
        total += numeric;
        count += 1;
      });
      return count === 0 ? ("#DIV/0!" as FormulaError) : total / count;
    }
    case "SUMIFS": {
      const parts = splitFunctionArgs(argsRaw);
      const sumRangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      let total = 0;
      for (let index = 0; index < sumRangeValues.length; index += 1) {
        if (!matchesAllCriteria(ctx, sheetIndex, row, col, parts, index, 1)) continue;
        const numeric = coerceNumber(sumRangeValues[index]);
        if (Number.isFinite(numeric)) total += numeric;
      }
      return total;
    }
    case "COUNTIFS": {
      const parts = splitFunctionArgs(argsRaw);
      const firstRangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      let count = 0;
      for (let index = 0; index < firstRangeValues.length; index += 1) {
        if (matchesAllCriteria(ctx, sheetIndex, row, col, parts, index, 0)) count += 1;
      }
      return count;
    }
    case "COUNTA": {
      const parts = splitFunctionArgs(argsRaw);
      const rangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      return rangeValues.filter((value) => value !== null && value !== "").length;
    }
    case "MEDIAN": {
      const sorted = [...numericArgs].sort((left, right) => left - right);
      if (sorted.length === 0) return "#NUM!" as FormulaError;
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
    case "INDEX": {
      const parts = splitFunctionArgs(argsRaw);
      const table = getTableFromRangeArg(ctx, sheetIndex, parts[0]?.trim() ?? "");
      const rowNum = Math.max(1, Math.round(coerceNumber(args[1])));
      const colNum = parts.length > 2 ? Math.max(1, Math.round(coerceNumber(args[2]))) : 1;
      const value = table[rowNum - 1]?.[colNum - 1];
      return value === undefined ? ("#REF!" as FormulaError) : value;
    }
    case "IFERROR": {
      const first = args[0];
      if (typeof first === "string" && first.startsWith("#")) return args[1] ?? null;
      return first;
    }
    case "XLOOKUP": {
      const parts = splitFunctionArgs(argsRaw);
      const lookup = String(args[0] ?? "").toLowerCase();
      const lookupValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[1]?.trim() ?? "");
      const returnValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[2]?.trim() ?? "");
      const matchIndex = lookupValues.findIndex((value) => String(value ?? "").toLowerCase() === lookup);
      if (matchIndex < 0) {
        if (parts[3]) return evaluateExpression(ctx, sheetIndex, row, col, parts[3].trim());
        return "#N/A" as FormulaError;
      }
      return returnValues[matchIndex] ?? ("#N/A" as FormulaError);
    }
    case "HLOOKUP": {
      const tableArg = splitFunctionArgs(argsRaw)[1]?.trim() ?? "";
      const table = getTableFromRangeArg(ctx, sheetIndex, tableArg);
      const rowIndex = Math.max(1, Math.round(coerceNumber(args[2])));
      const lookupText = String(args[0] ?? "").toLowerCase();
      if (!table.length) return "#N/A" as FormulaError;
      const headerRow = table[0] ?? [];
      const colIndex = headerRow.findIndex((value) => String(value ?? "").toLowerCase() === lookupText);
      if (colIndex < 0) return "#N/A" as FormulaError;
      return table[rowIndex - 1]?.[colIndex] ?? ("#N/A" as FormulaError);
    }
    case "YEAR": {
      const date = new Date(String(args[0] ?? ""));
      return Number.isFinite(date.getTime()) ? date.getFullYear() : ("#VALUE!" as FormulaError);
    }
    case "MONTH": {
      const date = new Date(String(args[0] ?? ""));
      return Number.isFinite(date.getTime()) ? date.getMonth() + 1 : ("#VALUE!" as FormulaError);
    }
    case "DAY": {
      const date = new Date(String(args[0] ?? ""));
      return Number.isFinite(date.getTime()) ? date.getDate() : ("#VALUE!" as FormulaError);
    }
    case "DATE": {
      const year = Math.round(coerceNumber(args[0]));
      const month = Math.round(coerceNumber(args[1]));
      const day = Math.round(coerceNumber(args[2]));
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return "#VALUE!" as FormulaError;
      }
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    case "ROW": {
      const refArg = splitFunctionArgs(argsRaw)[0]?.trim();
      if (!refArg) return row + 1;
      const single = parseCellRef(refArg.replace(/\$/g, ""));
      return single ? single.row + 1 : row + 1;
    }
    case "COLUMN": {
      const refArg = splitFunctionArgs(argsRaw)[0]?.trim();
      if (!refArg) return col + 1;
      const single = parseCellRef(refArg.replace(/\$/g, ""));
      return single ? single.col + 1 : col + 1;
    }
    case "OFFSET": {
      const parts = splitFunctionArgs(argsRaw);
      const anchor = parseCellRef(parts[0]?.trim().replace(/\$/g, "") ?? "");
      if (!anchor) return "#REF!" as FormulaError;
      const rowOffset = Math.round(coerceNumber(args[1]));
      const colOffset = Math.round(coerceNumber(args[2]));
      const targetRow = anchor.row + rowOffset;
      const targetCol = anchor.col + colOffset;
      if (targetRow < 0 || targetCol < 0) return "#REF!" as FormulaError;
      return getRawCellValue(ctx, sheetIndex, targetRow, targetCol);
    }
    case "ISBLANK":
      return args[0] === null || args[0] === "";
    case "IFNA": {
      const first = args[0];
      if (first === "#N/A" || first === ("#N/A" as FormulaError)) return args[1] ?? null;
      return first;
    }
    case "SUBSTITUTE": {
      const text = String(args[0] ?? "");
      const search = String(args[1] ?? "");
      const replacement = String(args[2] ?? "");
      const instance = args[3] !== undefined ? Math.max(1, Math.round(coerceNumber(args[3]))) : null;
      if (!search) return text;
      if (instance === null) return text.split(search).join(replacement);
      let count = 0;
      let result = "";
      let start = 0;
      while (true) {
        const index = text.indexOf(search, start);
        if (index < 0) {
          result += text.slice(start);
          break;
        }
        count += 1;
        result += text.slice(start, index) + (count === instance ? replacement : search);
        start = index + search.length;
        if (count === instance) {
          result += text.slice(start);
          break;
        }
      }
      return result;
    }
    case "MAXIFS": {
      const parts = splitFunctionArgs(argsRaw);
      const maxRangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const matches: number[] = [];
      for (let index = 0; index < maxRangeValues.length; index += 1) {
        if (!matchesAllCriteria(ctx, sheetIndex, row, col, parts, index, 1)) continue;
        const numeric = coerceNumber(maxRangeValues[index]);
        if (Number.isFinite(numeric)) matches.push(numeric);
      }
      return matches.length === 0 ? 0 : Math.max(...matches);
    }
    case "MINIFS": {
      const parts = splitFunctionArgs(argsRaw);
      const minRangeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const matches: number[] = [];
      for (let index = 0; index < minRangeValues.length; index += 1) {
        if (!matchesAllCriteria(ctx, sheetIndex, row, col, parts, index, 1)) continue;
        const numeric = coerceNumber(minRangeValues[index]);
        if (Number.isFinite(numeric)) matches.push(numeric);
      }
      return matches.length === 0 ? 0 : Math.min(...matches);
    }
    case "FILTER": {
      const parts = splitFunctionArgs(argsRaw);
      const arrayValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const includeValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[1]?.trim() ?? "");
      return evalFilter(arrayValues as FormulaScalar[], includeValues as FormulaScalar[]);
    }
    case "SORT": {
      const parts = splitFunctionArgs(argsRaw);
      const arrayValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      return evalSort(arrayValues as FormulaScalar[]);
    }
    case "UNIQUE": {
      const parts = splitFunctionArgs(argsRaw);
      const arrayValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      return evalUnique(arrayValues as FormulaScalar[]);
    }
    case "SEQUENCE": {
      const rows = Math.round(coerceNumber(args[0]));
      const cols = args[1] !== undefined ? Math.round(coerceNumber(args[1])) : 1;
      const start = args[2] !== undefined ? coerceNumber(args[2]) : 1;
      const step = args[3] !== undefined ? coerceNumber(args[3]) : 1;
      return evalSequence(rows, cols, start, step);
    }
    case "SORTBY": {
      const parts = splitFunctionArgs(argsRaw);
      const arrayValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[0]?.trim() ?? "");
      const byValues = collectRangeValuesFromArg(ctx, sheetIndex, row, col, parts[1]?.trim() ?? "");
      return evalSortBy(arrayValues as FormulaScalar[], byValues as FormulaScalar[]);
    }
    default: {
      const extended = evaluateExtendedFunction(upper, args as FormulaScalar[]);
      if (extended !== undefined) return extended;
      return "#NAME?" as FormulaError;
    }
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
): FormulaEvalResult {
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

  // Human: Sheet-qualified ranges like Sheet2!A1:B3 in inline math.
  expr = expr.replace(SHEET_QUALIFIED_RANGE_PATTERN, (match) => {
    const { sheetIndex: resolvedIndex, refPart } = splitSheetQualifiedToken(match, ctx.sheets, sheetIndex);
    const range = parseRangeRef(refPart.replace(/\$/g, ""));
    if (!range) return match;
    const values = collectRangeValues(ctx, resolvedIndex, range)
      .map((value) => coerceNumber(value))
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? values.join("+") : "0";
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

  // Human: Sheet-qualified single cells like Sheet1!A1.
  expr = expr.replace(SHEET_QUALIFIED_CELL_PATTERN, (match) => {
    const { sheetIndex: resolvedIndex, refPart } = splitSheetQualifiedToken(match, ctx.sheets, sheetIndex);
    const ref = parseCellRef(refPart.replace(/\$/g, ""));
    if (!ref) return match;
    const value = getRawCellValue(ctx, resolvedIndex, ref.row, ref.col);
    if (typeof value === "string" && value.startsWith("#")) return "0";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "1" : "0";
    if (value === null) return "0";
    const numeric = coerceNumber(value);
    return Number.isFinite(numeric) ? String(numeric) : `"${String(value)}"`;
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
  value: FormulaEvalResult,
  numberFormat?: import("@/lib/spreadsheet/types").NumberFormat,
  customNumberFormat?: string,
): string {
  if (isEvalArray(value)) return String(evalArrayFirstValue(value) ?? "");
  if (typeof value === "string" && value.startsWith("#")) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return formatCellDisplay(
    value as string | number | null,
    numberFormat ?? "general",
    customNumberFormat,
  );
}

// Human: Write dynamic-array spill values into cells below/right of the formula cell.
// Agent: EXPANDS sheet rows/cols; SKIPS cells that already hold data.
function applySpillResult(
  sheet: SheetData,
  originRow: number,
  originCol: number,
  result: EvalArray,
): SheetData {
  let rows = sheet.rows.map((row) => [...row]);
  const neededRows = originRow + result.spillRows;
  const neededCols = originCol + result.spillCols;
  while (rows.length < neededRows) rows.push([]);
  rows = rows.map((row) => {
    const copy = [...row];
    while (copy.length < neededCols) copy.push({ value: null, display: "" });
    return copy;
  });

  for (let spillRow = 0; spillRow < result.spillRows; spillRow += 1) {
    for (let spillCol = 0; spillCol < result.spillCols; spillCol += 1) {
      const targetRow = originRow + spillRow;
      const targetCol = originCol + spillCol;
      const flatIndex = spillRow * result.spillCols + spillCol;
      const spillValue = result.values[flatIndex] ?? null;
      if (targetRow === originRow && targetCol === originCol) continue;
      const existing = rows[targetRow]?.[targetCol];
      if (existing?.formula) continue;
      rows[targetRow][targetCol] = {
        ...existing,
        value: typeof spillValue === "boolean" ? (spillValue ? 1 : 0) : spillValue,
        display: displayFromEvaluated(spillValue),
        formula: undefined,
      };
    }
  }

  return { ...sheet, rows };
}

// Human: Recalculate every formula cell in one sheet and refresh display strings.
// Agent: USES dependency cache per recalc pass; RETURNS updated SheetData.
export function recalculateSheet(
  sheet: SheetData,
  sheetIndex: number,
  allSheets: SheetData[],
  namedRanges?: SpreadsheetWorkbook["namedRanges"],
): SheetData {
  const ctx: EvalContext = {
    sheets: allSheets,
    sheetIndex,
    row: 0,
    col: 0,
    visiting: new Set(),
    cache: new Map(),
    namedRanges,
  };

  // Human: Evaluate formulas first, then apply spills so spill rows are not overwritten.
  // Agent: TWO-PASS — formula display updates, then sequential applySpillResult.
  const spills: Array<{ row: number; col: number; result: EvalArray }> = [];
  const nextRows = sheet.rows.map((row, rowIndex) =>
    row.map((cell, colIndex) => {
      if (!cell.formula) return cell;
      const evaluated = evaluateFormulaCell(ctx, sheetIndex, rowIndex, colIndex, cell.formula);
      if (isEvalArray(evaluated)) {
        spills.push({ row: rowIndex, col: colIndex, result: evaluated });
      }
      const scalar = isEvalArray(evaluated) ? evalArrayFirstValue(evaluated) : evaluated;
      return {
        ...cell,
        value: typeof scalar === "boolean" ? (scalar ? 1 : 0) : scalar,
        display: displayFromEvaluated(scalar, cell.style?.numberFormat, cell.style?.customNumberFormat),
      };
    }),
  );

  let result: SheetData = { ...sheet, rows: nextRows };
  for (const spill of spills) {
    result = applySpillResult(result, spill.row, spill.col, spill.result);
  }
  return result;
}

// Human: Recalculate all sheets in workbook after edits.
// Agent: CALLS recalculateSheet per index; RETURNS new workbook reference.
export function recalculateWorkbook(workbook: SpreadsheetWorkbook): SpreadsheetWorkbook {
  try {
    let sheets = workbook.sheets;
    sheets = sheets.map((sheet, index) => recalculateSheet(sheet, index, sheets, workbook.namedRanges));
    return { ...workbook, sheets };
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
