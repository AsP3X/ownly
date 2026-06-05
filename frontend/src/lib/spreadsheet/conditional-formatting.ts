// Human: Conditional formatting rule types and evaluation for spreadsheet cells.
// Agent: READS ConditionalFormatRule[] + SheetCell; RETURNS ResolvedConditionalFormat for grid paint.

import { evaluateCfExpression, resolveCfOperand } from "@/lib/spreadsheet/cf-formula";
import { parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import type { SheetCell } from "@/lib/spreadsheet/types";

export type CellRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type CfOperator =
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "equal"
  | "notEqual"
  | "between"
  | "textContains"
  | "notContains"
  | "beginsWith"
  | "endsWith"
  | "containsBlanks"
  | "notContainsBlanks";

export type ConditionalFormatStyle = {
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  badge?: "on-track" | "over-budget" | "under-budget";
};

export type ConditionalFormatRule = {
  id: string;
  priority: number;
  range: CellRange;
  type: "cellIs" | "text" | "expression" | "colorScale" | "dataBar";
  operator?: CfOperator;
  // Human: Raw <formula> text from xlsx (literal, number, or cell reference).
  value?: string;
  value2?: string;
  // Human: Full expression for type="expression" rules (e.g. =$A1>0).
  formula?: string;
  style?: ConditionalFormatStyle;
  colorScale?: { minColor: string; maxColor: string };
  dataBar?: { color: string };
};

export type ResolvedConditionalFormat = {
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  badge?: "on-track" | "over-budget" | "under-budget";
  dataBarPercent?: number;
  dataBarColor?: string;
};

// Human: Parse Excel A1-style sqref strings (e.g. "A1:B10 D5") into zero-based ranges.
// Agent: RETURNS CellRange[]; SKIPS invalid tokens.
export function parseSqref(sqref: string): CellRange[] {
  return sqref
    .trim()
    .split(/\s+/)
    .map((token) => {
      const parts = token.split(":");
      const start = parseCellAddressLabel(parts[0]);
      const end = parseCellAddressLabel(parts[parts.length - 1] ?? parts[0]);
      if (!start || !end) return null;
      return {
        startRow: Math.min(start.row, end.row),
        startCol: Math.min(start.col, end.col),
        endRow: Math.max(start.row, end.row),
        endCol: Math.max(start.col, end.col),
      };
    })
    .filter((range): range is CellRange => range !== null);
}

// Human: True when a zero-based cell address lies inside a range (inclusive).
// Agent: READS row/col + CellRange; RETURNS boolean.
export function cellInRange(row: number, col: number, range: CellRange): boolean {
  return row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol;
}

// Human: Numeric value for rule comparisons — prefers raw value over parsed display text.
// Agent: READS SheetCell; RETURNS finite number or null.
export function cellNumericValue(cell: SheetCell): number | null {
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const parsed = Number(String(cell.display).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareCellIs(
  cell: SheetCell,
  operator: CfOperator,
  value: number | string | null | undefined,
  value2: number | string | null | undefined,
): boolean {
  const numeric = cellNumericValue(cell);
  const text = String(cell.display ?? cell.value ?? "").trim().toLowerCase();
  const needle = String(value ?? "").trim().toLowerCase();

  switch (operator) {
    case "greaterThan":
      return numeric !== null && typeof value === "number" && numeric > value;
    case "greaterThanOrEqual":
      return numeric !== null && typeof value === "number" && numeric >= value;
    case "lessThan":
      return numeric !== null && typeof value === "number" && numeric < value;
    case "lessThanOrEqual":
      return numeric !== null && typeof value === "number" && numeric <= value;
    case "equal":
      if (typeof value === "number") return numeric === value;
      return text === needle;
    case "notEqual":
      if (typeof value === "number") return numeric !== null && numeric !== value;
      return text !== needle;
    case "between": {
      const low = typeof value === "number" ? value : null;
      const high = typeof value2 === "number" ? value2 : null;
      return numeric !== null && low !== null && high !== null && numeric >= low && numeric <= high;
    }
    case "textContains":
      return text.includes(needle);
    case "notContains":
      return !text.includes(needle);
    case "beginsWith":
      return text.startsWith(needle);
    case "endsWith":
      return text.endsWith(needle);
    case "containsBlanks":
      return text.length === 0 && cell.value === null;
    case "notContainsBlanks":
      return text.length > 0 || cell.value !== null;
    default:
      return false;
  }
}

function lerpChannel(min: number, max: number, t: number): number {
  return Math.round(min + (max - min) * t);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function interpolateColor(minColor: string, maxColor: string, ratio: number): string {
  const min = hexToRgb(minColor);
  const max = hexToRgb(maxColor);
  if (!min || !max) return minColor;
  const t = Math.min(1, Math.max(0, ratio));
  return rgbToHex(
    lerpChannel(min.r, max.r, t),
    lerpChannel(min.g, max.g, t),
    lerpChannel(min.b, max.b, t),
  );
}

function evaluateColorScale(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
): ResolvedConditionalFormat | null {
  if (!rule.colorScale || !cellInRange(row, col, rule.range)) return null;

  const values: number[] = [];
  for (let r = rule.range.startRow; r <= rule.range.endRow; r += 1) {
    for (let c = rule.range.startCol; c <= rule.range.endCol; c += 1) {
      const numeric = cellNumericValue(rows[r]?.[c] ?? { value: null, display: "" });
      if (numeric !== null) values.push(numeric);
    }
  }
  if (values.length === 0) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const ratio = max === min ? 0.5 : (numeric - min) / (max - min);

  return {
    backgroundColor: interpolateColor(rule.colorScale.minColor, rule.colorScale.maxColor, ratio),
  };
}

function evaluateDataBar(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
): ResolvedConditionalFormat | null {
  if (!rule.dataBar || !cellInRange(row, col, rule.range)) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const values: number[] = [];
  for (let r = rule.range.startRow; r <= rule.range.endRow; r += 1) {
    for (let c = rule.range.startCol; c <= rule.range.endCol; c += 1) {
      const value = cellNumericValue(rows[r]?.[c] ?? { value: null, display: "" });
      if (value !== null) values.push(value);
    }
  }
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min;
  const percent = span <= 0 ? 0 : (numeric - min) / span;

  return {
    dataBarPercent: Math.min(1, Math.max(0, percent)),
    dataBarColor: rule.dataBar.color,
  };
}

function evaluateRule(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
): ResolvedConditionalFormat | null {
  if (!cellInRange(row, col, rule.range)) return null;

  switch (rule.type) {
    case "cellIs":
    case "text": {
      if (!rule.operator) return null;
      const operand = resolveCfOperand(rule.value, rule.range, row, col, rows);
      const operand2 = resolveCfOperand(rule.value2, rule.range, row, col, rows);
      if (!compareCellIs(cell, rule.operator, operand, operand2)) return null;
      return rule.style ?? null;
    }
    case "expression": {
      if (!rule.formula || !evaluateCfExpression(rule.formula, rule.range, row, col, rows)) return null;
      return rule.style ?? null;
    }
    case "colorScale":
      return evaluateColorScale(cell, rule, row, col, rows);
    case "dataBar":
      return evaluateDataBar(cell, rule, row, col, rows);
    default:
      return null;
  }
}

// Human: Resolve the winning conditional format for a grid cell (Excel priority order).
// Agent: READS rules sorted by descending priority; RETURNS highest-priority match.
export function resolveConditionalFormat(
  rules: ConditionalFormatRule[] | undefined,
  rows: SheetCell[][],
  row: number,
  col: number,
): ResolvedConditionalFormat | null {
  if (!rules || rules.length === 0) return null;

  const cell = rows[row]?.[col] ?? { value: null, display: "" };
  // Human: OOXML priority — higher value is applied later and wins when multiple rules match.
  // Agent: SORT descending so the first matching rule is the effective Excel format.
  const sorted = [...rules].sort((left, right) => right.priority - left.priority);

  for (const rule of sorted) {
    const resolved = evaluateRule(cell, rule, row, col, rows);
    if (resolved) return resolved;
  }
  return null;
}

// Human: Build a column range from the active cell — data rows below the header row.
// Agent: READS selection + row count; RETURNS CellRange for ribbon-applied rules.
export function columnRangeFromSelection(
  selection: { row: number; col: number },
  rowCount: number,
): CellRange {
  // Human: Skip row 0 when the sheet has a header; otherwise include all rows.
  // Agent: startRow is 1 when rowCount > 1, else 0.
  const startRow = rowCount > 1 ? 1 : 0;
  return {
    startRow,
    startCol: selection.col,
    endRow: Math.max(startRow, rowCount - 1),
    endCol: selection.col,
  };
}

// Human: Preset status badge rules matching the Pencil budget spreadsheet design.
// Agent: RETURNS three text-equals rules for On Track / Over Budget / Under Budget.
export function statusBadgePresetRules(range: CellRange, nextPriority: number): ConditionalFormatRule[] {
  const presets: Array<{ text: string; badge: ConditionalFormatStyle["badge"]; style: ConditionalFormatStyle }> = [
    { text: "On Track", badge: "on-track", style: { backgroundColor: "#D1FAE5", textColor: "#047857", badge: "on-track" } },
    { text: "Over Budget", badge: "over-budget", style: { backgroundColor: "#FEE2E2", textColor: "#B91C1C", badge: "over-budget" } },
    { text: "Under Budget", badge: "under-budget", style: { backgroundColor: "#DBEAFE", textColor: "#1D4ED8", badge: "under-budget" } },
  ];

  return presets.map((preset, index) => ({
    id: `status-${preset.badge}-${crypto.randomUUID()}`,
    priority: nextPriority + index,
    range,
    type: "text",
    operator: "equal",
    value: `"${preset.text}"`,
    style: preset.style,
  }));
}

export function createRuleId(): string {
  return crypto.randomUUID();
}
