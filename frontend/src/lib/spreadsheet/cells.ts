// Human: Cell address helpers and display formatting for the spreadsheet grid.
// Agent: CONVERTS row/col indices to A1 notation; FORMATS numbers as currency per cell style.

import { formatValueWithNumberFormat } from "@/lib/spreadsheet/number-formats";
import type { CellAddress, NumberFormat, SheetCell } from "@/lib/spreadsheet/types";

const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Human: Zero-based column index to Excel column letters (A, B, …, AA).
// Agent: RETURNS string label for column headers and formula bar name box.
export function columnIndexToLetters(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = COLUMN_LETTERS[remainder] + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

// Human: Build A1-style reference from zero-based row/col indices.
// Agent: RETURNS e.g. "D4" for formula bar and copilot card title.
export function cellAddressLabel(address: CellAddress): string {
  return `${columnIndexToLetters(address.col)}${address.row + 1}`;
}

// Human: Column letters (optional $) to zero-based index — used by CF sqref parsing.
// Agent: RETURNS null when letters are not A–Z.
export function columnLettersToIndex(letters: string): number | null {
  const normalized = letters.replace(/\$/g, "").toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) return null;

  let col = 0;
  for (const char of normalized) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }
  return col - 1;
}

// Human: Parse "D4" / "$D$4" style references back to zero-based indices.
// Agent: RETURNS null when input is not a valid cell reference.
export function parseCellAddressLabel(label: string): CellAddress | null {
  const match = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(label.trim());
  if (!match) {
    const lettersOnly = /^(\$?)([A-Za-z]+)$/.exec(label.trim());
    if (!lettersOnly) return null;
    const col = columnLettersToIndex(lettersOnly[2]);
    return col === null ? null : { row: 0, col };
  }

  const col = columnLettersToIndex(match[2]);
  if (col === null) return null;

  const row = Number.parseInt(match[4], 10) - 1;
  if (!Number.isFinite(row) || row < 0 || col < 0) return null;
  return { row, col };
}

// Human: Format numeric cell values for grid display according to ribbon number format.
// Agent: READS SheetCell.value + style.numberFormat; RETURNS display string.
export function formatCellDisplay(
  value: string | number | null,
  format: NumberFormat = "general",
  customCode?: string,
): string {
  return formatValueWithNumberFormat(value, format, customCode);
}

// Human: Derive the formula bar contents — show formula when present, else raw value.
// Agent: READS SheetCell; RETURNS string for formula input box.
export function formulaBarValue(cell: SheetCell | undefined): string {
  if (!cell) return "";
  if (cell.formula) return cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`;
  if (cell.value === null) return "";
  return String(cell.value);
}

// Human: Detect status badge labels in the Status column (design pill chips).
// Agent: READS display text; RETURNS badge tone for Tailwind styling.
export type StatusBadgeTone = "on-track" | "over-budget" | "under-budget" | null;

export function statusBadgeTone(display: string): StatusBadgeTone {
  const normalized = display.trim().toLowerCase();
  if (normalized === "on track") return "on-track";
  if (normalized === "over budget") return "over-budget";
  if (normalized === "under budget") return "under-budget";
  return null;
}
