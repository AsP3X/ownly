// Human: Excel conditional-formatting formula helpers — cell refs and simple expressions.
// Agent: RESOLVES CF formula operands relative to rule range top-left; EVALUATES boolean expressions.

import { parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import type { CellRange } from "@/lib/spreadsheet/conditional-formatting";
import type { SheetCell } from "@/lib/spreadsheet/types";

type ParsedCellRef = {
  colAbsolute: boolean;
  col: number;
  rowAbsolute: boolean;
  row: number;
};

const CELL_REF_PATTERN = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/;

// Human: Parse a single A1-style reference token (optional $ for absolute row/col).
// Agent: RETURNS zero-based indices; NULL when token is not a cell reference.
export function parseCfCellRef(token: string): ParsedCellRef | null {
  const match = CELL_REF_PATTERN.exec(token.trim());
  if (!match) return null;

  const colLabel = match[2].toUpperCase();
  let col = 0;
  for (const char of colLabel) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }

  const row = Number.parseInt(match[4], 10) - 1;
  if (!Number.isFinite(row) || row < 0 || col <= 0) return null;

  return {
    colAbsolute: match[1] === "$",
    col: col - 1,
    rowAbsolute: match[3] === "$",
    row,
  };
}

// Human: Shift a formula reference from the range anchor cell to the cell being evaluated.
// Agent: APPLIES Excel-style relative offsets for non-absolute row/col parts.
function resolveCfCellRef(
  ref: ParsedCellRef,
  anchor: { row: number; col: number },
  target: { row: number; col: number },
): { row: number; col: number } {
  const deltaRow = target.row - anchor.row;
  const deltaCol = target.col - anchor.col;
  return {
    row: ref.rowAbsolute ? ref.row : ref.row + deltaRow,
    col: ref.colAbsolute ? ref.col : ref.col + deltaCol,
  };
}

function cellOperandValue(cell: SheetCell | undefined): string | number | null {
  if (!cell) return null;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  if (typeof cell.value === "string" && cell.value.length > 0) return cell.value;
  if (cell.display.trim().length > 0) return cell.display;
  return null;
}

// Human: Resolve one <formula> operand for cellIs rules (literal, number, or cell reference).
// Agent: READS formula text relative to rule.range top-left; RETURNS comparison operand.
export function resolveCfOperand(
  formula: string | undefined,
  range: CellRange,
  row: number,
  col: number,
  rows: SheetCell[][],
): number | string | null | undefined {
  if (formula === undefined) return undefined;

  const trimmed = formula.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }

  const cellRef = parseCfCellRef(trimmed);
  if (cellRef) {
    const resolved = resolveCfCellRef(cellRef, { row: range.startRow, col: range.startCol }, { row, col });
    const value = cellOperandValue(rows[resolved.row]?.[resolved.col]);
    if (typeof value === "number") return value;
    if (typeof value === "string") return value;
    return null;
  }

  const address = parseCellAddressLabel(trimmed);
  if (address) {
    const value = cellOperandValue(rows[address.row]?.[address.col]);
    if (typeof value === "number") return value;
    if (typeof value === "string") return value;
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;

  return trimmed;
}

function literalForExpression(value: string | number | null): string {
  if (value === null) return '""';
  if (typeof value === "number") return String(value);
  return `"${value.replace(/"/g, '""')}"`;
}

// Human: Replace cell references in a CF expression with literal values for eval.
// Agent: SUBSTITUTES refs relative to range anchor; RETURNS JS-evaluable expression string.
function substituteCfExpression(
  formula: string,
  range: CellRange,
  row: number,
  col: number,
  rows: SheetCell[][],
): string {
  const anchor = { row: range.startRow, col: range.startCol };
  const target = { row, col };

  return formula.replace(/(\$?[A-Za-z]+\$?\d+)/g, (token) => {
    const ref = parseCfCellRef(token);
    if (!ref) return token;
    const resolved = resolveCfCellRef(ref, anchor, target);
    const value = cellOperandValue(rows[resolved.row]?.[resolved.col]);
    return literalForExpression(value);
  });
}

// Human: Evaluate Excel `type="expression"` CF formulas (e.g. =$A1>0, =AND(C1>0,D1<10)).
// Agent: SUBSTITUTES cell refs then evaluates boolean result; RETURNS false on parse errors.
export function evaluateCfExpression(
  formula: string,
  range: CellRange,
  row: number,
  col: number,
  rows: SheetCell[][],
): boolean {
  const expr = formula.trim().replace(/^=/, "");
  if (expr.length === 0) return false;

  const substituted = substituteCfExpression(expr, range, row, col, rows)
    .replace(/\bTRUE\b/gi, "true")
    .replace(/\bFALSE\b/gi, "false");

  if (!/^[\d\s.+\-*/%<>=!&|()"'A-Za-z_]+$/.test(substituted)) return false;

  try {
    return Boolean(Function(`"use strict"; return (${substituted});`)());
  } catch {
    return false;
  }
}
