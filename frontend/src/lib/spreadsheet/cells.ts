// Human: Cell address helpers and display formatting for the spreadsheet grid.
// Agent: CONVERTS row/col indices to A1 notation; FORMATS numbers as currency per cell style.

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

// Human: Parse "D4" style references back to zero-based indices.
// Agent: RETURNS null when input is not a valid cell reference.
export function parseCellAddressLabel(label: string): CellAddress | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(label.trim());
  if (!match) return null;

  const letters = match[1].toUpperCase();
  let col = 0;
  for (const char of letters) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }

  const row = Number.parseInt(match[2], 10) - 1;
  if (!Number.isFinite(row) || row < 0 || col <= 0) return null;
  return { row, col: col - 1 };
}

// Human: Format numeric cell values for grid display according to ribbon number format.
// Agent: READS SheetCell.value + style.numberFormat; RETURNS display string.
export function formatCellDisplay(value: string | number | null, format: NumberFormat = "general"): string {
  if (value === null || value === "") return "";
  if (typeof value === "string") return value;

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    case "number":
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
    default:
      return Number.isInteger(value) ? String(value) : String(value);
  }
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
