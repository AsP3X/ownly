// Human: Column filter helpers — distinct values and hidden-row computation for AutoFilter.
// Agent: READS SheetData column; RETURNS value list + row indices to hide in grid.

import type { SheetData } from "@/lib/spreadsheet/types";

export type ColumnFilterConfig = {
  textQuery: string;
  selectedValues: Set<string> | null;
};

const BLANK_LABEL = "(Blanks)";

// Human: Normalize a cell display string for filter checkbox labels.
// Agent: MAPS empty cells to (Blanks) token used in filter UI.
export function filterValueLabel(display: string): string {
  const trimmed = display.trim();
  return trimmed.length > 0 ? trimmed : BLANK_LABEL;
}

// Human: Collect sorted unique display values from a column (skips header row).
// Agent: USED by AutoFilter dialog checkbox list.
export function distinctColumnValues(sheet: SheetData, colIndex: number): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const label = filterValueLabel(String(row[colIndex]?.display ?? ""));
    if (seen.has(label)) return;
    seen.add(label);
    values.push(label);
  });

  return values.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

// Human: Compute which row indices should be hidden for the active column filter.
// Agent: APPLIES text search AND optional value checklist; row 0 always visible.
export function hiddenRowsForColumnFilter(
  sheet: SheetData,
  colIndex: number,
  filter: ColumnFilterConfig,
): Set<number> {
  const hidden = new Set<number>();
  const query = filter.textQuery.trim().toLowerCase();
  const selected = filter.selectedValues;

  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const label = filterValueLabel(String(row[colIndex]?.display ?? ""));

    if (selected && !selected.has(label)) {
      hidden.add(rowIndex);
      return;
    }

    if (query && !label.toLowerCase().includes(query)) {
      hidden.add(rowIndex);
    }
  });

  return hidden;
}

export { BLANK_LABEL };
