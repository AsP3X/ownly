// Human: Conditional formatting rule types and evaluation for spreadsheet cells.
// Agent: READS ConditionalFormatRule[] + SheetCell; RETURNS ResolvedConditionalFormat for grid paint.

import { evaluateCfExpression, resolveCfOperand } from "@/lib/spreadsheet/cf-formula";
import { columnLettersToIndex, parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import type { SheetCell } from "@/lib/spreadsheet/types";

// Human: Excel max row/col for full-column/full-row sqref tokens (A:A, 1:5).
// Agent: CLAMPED to actual grid size in cellInRange.
const SQREF_FULL_COLUMN_END_ROW = 1_048_575;
const SQREF_FULL_ROW_END_COL = 16_383;

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
  type:
    | "cellIs"
    | "text"
    | "expression"
    | "colorScale"
    | "dataBar"
    | "aboveAverage"
    | "top10"
    | "duplicateValues"
    | "uniqueValues"
    | "iconSet";
  operator?: CfOperator;
  // Human: Raw <formula> text from xlsx (literal, number, or cell reference).
  value?: string;
  value2?: string;
  // Human: Full expression for type="expression" rules (e.g. =$A1>0).
  formula?: string;
  style?: ConditionalFormatStyle;
  colorScale?: { minColor: string; midColor?: string; maxColor: string };
  dataBar?: { color: string };
  aboveAverage?: { above: boolean; equalAverage?: boolean; stdDev?: number };
  top10?: { rank: number; percent: boolean; bottom: boolean };
  iconSet?: { colors: string[] };
  stopIfTrue?: boolean;
};

export type ResolvedConditionalFormat = {
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  badge?: "on-track" | "over-budget" | "under-budget";
  dataBarPercent?: number;
  dataBarColor?: string;
};

type SqrefEndpoint = { row: number; col: number };

// Human: Parse one corner of an sqref token (cell, column-only, or row-only).
// Agent: RETURNS zero-based row/col; NULL when token is invalid.
function parseSqrefEndpoint(token: string): SqrefEndpoint | null {
  const trimmed = token.trim();
  const cell = parseCellAddressLabel(trimmed);
  if (cell) return cell;

  const colOnly = /^(\$?)([A-Za-z]+)$/.exec(trimmed);
  if (colOnly) {
    const col = columnLettersToIndex(colOnly[2]);
    return col === null ? null : { row: 0, col };
  }

  const rowOnly = /^(\$?)(\d+)$/.exec(trimmed);
  if (rowOnly) {
    const row = Number.parseInt(rowOnly[2], 10) - 1;
    return Number.isFinite(row) && row >= 0 ? { row, col: 0 } : null;
  }

  return null;
}

// Human: Parse Excel A1-style sqref strings (e.g. "$A$1:$B$10", "A:A", "D5") into ranges.
// Agent: RETURNS CellRange[]; SKIPS invalid tokens.
export function parseSqref(sqref: string): CellRange[] {
  return sqref
    .trim()
    .split(/\s+/)
    .map((token) => {
      const parts = token.split(":");
      const start = parseSqrefEndpoint(parts[0]);
      const end = parseSqrefEndpoint(parts[parts.length - 1] ?? parts[0]);
      if (!start || !end) return null;

      const startIsColOnly = /^(\$?)[A-Za-z]+$/.test(parts[0].trim());
      const endIsColOnly = /^(\$?)[A-Za-z]+$/.test((parts[parts.length - 1] ?? parts[0]).trim());
      const startIsRowOnly = /^(\$?)\d+$/.test(parts[0].trim());
      const endIsRowOnly = /^(\$?)\d+$/.test((parts[parts.length - 1] ?? parts[0]).trim());

      return {
        startRow: Math.min(start.row, end.row),
        startCol: Math.min(start.col, end.col),
        endRow: Math.max(
          start.row,
          end.row,
          startIsColOnly || endIsColOnly ? SQREF_FULL_COLUMN_END_ROW : start.row,
        ),
        endCol: Math.max(
          start.col,
          end.col,
          startIsRowOnly || endIsRowOnly ? SQREF_FULL_ROW_END_COL : start.col,
        ),
      };
    })
    .filter((range): range is CellRange => range !== null);
}

// Human: True when a zero-based cell address lies inside a range (inclusive).
// Agent: CLAMPS full-column/full-row sqref bounds to the live grid dimensions.
export function cellInRange(
  row: number,
  col: number,
  range: CellRange,
  bounds?: { rowCount: number; colCount: number },
): boolean {
  const endRow =
    bounds && range.endRow >= SQREF_FULL_COLUMN_END_ROW
      ? Math.max(0, bounds.rowCount - 1)
      : range.endRow;
  const endCol =
    bounds && range.endCol >= SQREF_FULL_ROW_END_COL ? Math.max(0, bounds.colCount - 1) : range.endCol;
  return row >= range.startRow && row <= endRow && col >= range.startCol && col <= endCol;
}

// Human: True when a resolved CF payload would change grid paint.
// Agent: USED to skip empty dxf matches and continue to lower-priority rules.
function hasVisibleResolved(cf: ResolvedConditionalFormat | null): boolean {
  if (!cf) return false;
  return Boolean(
    cf.backgroundColor ||
      cf.textColor ||
      cf.bold ||
      cf.badge ||
      cf.dataBarPercent !== undefined ||
      cf.dataBarColor,
  );
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

function rangeNumericValues(
  rule: ConditionalFormatRule,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): number[] {
  const values: number[] = [];
  for (let r = rule.range.startRow; r <= rule.range.endRow; r += 1) {
    if (r >= bounds.rowCount) break;
    for (let c = rule.range.startCol; c <= rule.range.endCol; c += 1) {
      if (c >= bounds.colCount) break;
      if (!cellInRange(r, c, rule.range, bounds)) continue;
      const numeric = cellNumericValue(rows[r]?.[c] ?? { value: null, display: "" });
      if (numeric !== null) values.push(numeric);
    }
  }
  return values;
}

function evaluateColorScale(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): ResolvedConditionalFormat | null {
  if (!rule.colorScale || !cellInRange(row, col, rule.range, bounds)) return null;

  const values = rangeNumericValues(rule, rows, bounds);
  if (values.length === 0) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const ratio = max === min ? 0.5 : (numeric - min) / (max - min);

  const { minColor, midColor, maxColor } = rule.colorScale;
  const backgroundColor = midColor
    ? ratio <= 0.5
      ? interpolateColor(minColor, midColor, ratio / 0.5)
      : interpolateColor(midColor, maxColor, (ratio - 0.5) / 0.5)
    : interpolateColor(minColor, maxColor, ratio);

  return { backgroundColor };
}

function evaluateDataBar(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): ResolvedConditionalFormat | null {
  if (!rule.dataBar || !cellInRange(row, col, rule.range, bounds)) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const values = rangeNumericValues(rule, rows, bounds);
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

function rangeDisplayKeys(
  rule: ConditionalFormatRule,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): string[] {
  const keys: string[] = [];
  for (let r = rule.range.startRow; r <= rule.range.endRow; r += 1) {
    if (r >= bounds.rowCount) break;
    for (let c = rule.range.startCol; c <= rule.range.endCol; c += 1) {
      if (c >= bounds.colCount) break;
      if (!cellInRange(r, c, rule.range, bounds)) continue;
      const cell = rows[r]?.[c] ?? { value: null, display: "" };
      const key = String(cell.display ?? cell.value ?? "")
        .trim()
        .toLowerCase();
      keys.push(key);
    }
  }
  return keys;
}

function evaluateAboveAverage(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): ResolvedConditionalFormat | null {
  if (!rule.aboveAverage || !cellInRange(row, col, rule.range, bounds)) return null;

  const values = rangeNumericValues(rule, rows, bounds);
  if (values.length === 0) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  const stdDevMultiplier = rule.aboveAverage.stdDev ?? 0;
  const threshold = rule.aboveAverage.above
    ? average + stdDevMultiplier * standardDeviation
    : average - stdDevMultiplier * standardDeviation;

  const matches = rule.aboveAverage.above
    ? rule.aboveAverage.equalAverage
      ? numeric >= threshold
      : numeric > threshold
    : rule.aboveAverage.equalAverage
      ? numeric <= threshold
      : numeric < threshold;

  return matches ? (rule.style ?? null) : null;
}

function evaluateTop10(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): ResolvedConditionalFormat | null {
  if (!rule.top10 || !cellInRange(row, col, rule.range, bounds)) return null;

  const values = rangeNumericValues(rule, rows, bounds);
  if (values.length === 0) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const sorted = [...values].sort((left, right) => right - left);
  const rank = Math.max(1, rule.top10.rank);
  const cutoffIndex = rule.top10.percent
    ? Math.max(0, Math.ceil((sorted.length * rank) / 100) - 1)
    : Math.min(sorted.length - 1, rank - 1);
  const topThreshold = sorted[cutoffIndex];
  const bottomThreshold = sorted[sorted.length - 1 - cutoffIndex];

  const matches = rule.top10.bottom ? numeric <= bottomThreshold : numeric >= topThreshold;
  return matches ? (rule.style ?? null) : null;
}

function evaluateDuplicateValues(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
  duplicates: boolean,
): ResolvedConditionalFormat | null {
  if (!cellInRange(row, col, rule.range, bounds)) return null;

  const key = String(cell.display ?? cell.value ?? "")
    .trim()
    .toLowerCase();
  if (key.length === 0) return null;

  const keys = rangeDisplayKeys(rule, rows, bounds);
  const count = keys.filter((entry) => entry === key).length;
  const matches = duplicates ? count > 1 : count === 1;
  return matches ? (rule.style ?? null) : null;
}

function evaluateIconSet(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): ResolvedConditionalFormat | null {
  if (!rule.iconSet || !cellInRange(row, col, rule.range, bounds)) return null;

  const values = rangeNumericValues(rule, rows, bounds);
  if (values.length === 0) return null;

  const numeric = cellNumericValue(cell);
  if (numeric === null) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const ratio = max === min ? 0.5 : (numeric - min) / (max - min);
  const bucket = Math.min(
    rule.iconSet.colors.length - 1,
    Math.max(0, Math.floor(ratio * rule.iconSet.colors.length)),
  );

  return { backgroundColor: rule.iconSet.colors[bucket] };
}

function evaluateRule(
  cell: SheetCell,
  rule: ConditionalFormatRule,
  row: number,
  col: number,
  rows: SheetCell[][],
  bounds: { rowCount: number; colCount: number },
): ResolvedConditionalFormat | null {
  if (!cellInRange(row, col, rule.range, bounds)) return null;

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
      return evaluateColorScale(cell, rule, row, col, rows, bounds);
    case "dataBar":
      return evaluateDataBar(cell, rule, row, col, rows, bounds);
    case "aboveAverage":
      return evaluateAboveAverage(cell, rule, row, col, rows, bounds);
    case "top10":
      return evaluateTop10(cell, rule, row, col, rows, bounds);
    case "duplicateValues":
      return evaluateDuplicateValues(cell, rule, row, col, rows, bounds, true);
    case "uniqueValues":
      return evaluateDuplicateValues(cell, rule, row, col, rows, bounds, false);
    case "iconSet":
      return evaluateIconSet(cell, rule, row, col, rows, bounds);
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
  const bounds = {
    rowCount: rows.length,
    colCount: Math.max(...rows.map((sheetRow) => sheetRow.length), 1),
  };
  // Human: OOXML priority — higher value is applied later and wins when multiple rules match.
  // Agent: SORT descending; SKIP empty dxf matches so lower-priority paint can apply.
  const sorted = [...rules].sort((left, right) => right.priority - left.priority);

  for (const rule of sorted) {
    const resolved = evaluateRule(cell, rule, row, col, rows, bounds);
    if (hasVisibleResolved(resolved)) return resolved;
    if (resolved && rule.stopIfTrue) break;
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
