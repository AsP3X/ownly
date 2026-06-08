// Human: Extract numeric chart series from a selected sheet range for Insert Chart.
// Agent: READS labels from first column/header; VALUES from selected numeric column.

import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetData } from "@/lib/spreadsheet/types";

export type ChartBar = {
  label: string;
  value: number;
};

// Human: Build bar chart data from the selected range — one numeric column required.
// Agent: USES first column as labels; PICKS rightmost numeric column in range.
export function chartBarsFromSelection(sheet: SheetData, range: CellRange): ChartBar[] {
  const normalized = normalizeRange(range);
  let valueCol = normalized.end.col;
  for (let col = normalized.end.col; col >= normalized.start.col; col -= 1) {
    let hasNumber = false;
    for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
      const value = sheet.rows[row]?.[col]?.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        hasNumber = true;
        break;
      }
    }
    if (hasNumber) {
      valueCol = col;
      break;
    }
  }

  const labelCol = normalized.start.col;
  const bars: ChartBar[] = [];

  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    const rawValue = sheet.rows[row]?.[valueCol]?.value;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
    const label =
      String(sheet.rows[row]?.[labelCol]?.display ?? sheet.rows[row]?.[labelCol]?.value ?? `Row ${row + 1}`);
    bars.push({ label, value: rawValue });
  }

  return bars;
}
