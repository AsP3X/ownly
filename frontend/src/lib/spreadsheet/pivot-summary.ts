// Human: Lightweight pivot summary — group-by column with sum/count/average on a value column.
// Agent: READS SheetData selection; RETURNS tabular pivot rows for dialog preview + new sheet.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";

export type PivotAggregation = "sum" | "count" | "average" | "max" | "min";

export type PivotSummaryResult = {
  headers: string[];
  rows: SheetCell[][];
};

function cellDisplayValue(cell: SheetCell | undefined): string {
  if (!cell) return "";
  return cell.display || String(cell.value ?? "");
}

function numericFromCell(cell: SheetCell | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const parsed = Number(String(cell.value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregateValues(values: number[], aggregation: PivotAggregation): number {
  if (values.length === 0) return 0;
  switch (aggregation) {
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "count":
      return values.length;
    case "average":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    default:
      return 0;
  }
}

function pivotCell(value: string | number | null): SheetCell {
  return {
    value,
    display: formatCellDisplay(value, typeof value === "number" ? "number" : "general"),
    style: typeof value === "number" ? { numberFormat: "number" } : undefined,
  };
}

// Human: List column indices covered by a normalized selection range.
// Agent: USED by pivot dialog to populate row/value field pickers.
export function columnIndicesInRange(range: CellRange): number[] {
  const normalized = normalizeRange(range);
  const indices: number[] = [];
  for (let col = normalized.start.col; col <= normalized.end.col; col += 1) {
    indices.push(col);
  }
  return indices;
}

// Human: Build a grouped pivot table from the selected range.
// Agent: GROUPS by rowFieldCol; AGGREGATES valueFieldCol; SKIPS blank group keys.
export function computePivotSummary(
  sheet: SheetData,
  range: CellRange,
  rowFieldCol: number,
  valueFieldCol: number,
  aggregation: PivotAggregation,
  skipHeaderRow = true,
): PivotSummaryResult {
  return computeMultiFieldPivotSummary(
    sheet,
    range,
    [rowFieldCol],
    [{ col: valueFieldCol, aggregation }],
    skipHeaderRow,
  );
}

export type PivotValueField = {
  col: number;
  aggregation: PivotAggregation;
};

// Human: Multi-field pivot — group by one or more row fields, aggregate multiple value fields.
// Agent: KEYS groups with unit-separator; HEADERS use header-row labels when present.
export function computeMultiFieldPivotSummary(
  sheet: SheetData,
  range: CellRange,
  rowFieldCols: number[],
  valueFields: PivotValueField[],
  skipHeaderRow = true,
): PivotSummaryResult {
  const normalized = normalizeRange(range);
  const startRow = skipHeaderRow ? normalized.start.row + 1 : normalized.start.row;
  const headerRow = sheet.rows[normalized.start.row];
  const rowFields = rowFieldCols.length > 0 ? rowFieldCols : [normalized.start.col];
  const values =
    valueFields.length > 0
      ? valueFields
      : [{ col: normalized.end.col, aggregation: "sum" as PivotAggregation }];

  const groups = new Map<string, { labels: string[]; buckets: number[][] }>();

  for (let row = startRow; row <= normalized.end.row; row += 1) {
    const labels = rowFields.map(
      (col) => cellDisplayValue(sheet.rows[row]?.[col]).trim() || "(blank)",
    );
    const groupKey = labels.join("\u0001");
    let entry = groups.get(groupKey);
    if (!entry) {
      entry = { labels, buckets: values.map(() => []) };
      groups.set(groupKey, entry);
    }
    values.forEach((field, fieldIndex) => {
      const numeric = numericFromCell(sheet.rows[row]?.[field.col]);
      if (numeric === null && field.aggregation !== "count") return;
      entry!.buckets[fieldIndex].push(numeric ?? 0);
    });
  }

  const rowHeaders = rowFields.map((col, index) => {
    const label = cellDisplayValue(headerRow?.[col]).trim();
    return label || `Row ${index + 1}`;
  });
  const valueHeaders = values.map((field) => {
    const base = cellDisplayValue(headerRow?.[field.col]).trim() || "Value";
    const aggregationLabel =
      field.aggregation === "average"
        ? "Average"
        : field.aggregation.charAt(0).toUpperCase() + field.aggregation.slice(1);
    return `${aggregationLabel} of ${base}`;
  });

  const headers = [...rowHeaders, ...valueHeaders];
  const rows = [...groups.values()]
    .sort((left, right) => left.labels.join("\u0001").localeCompare(right.labels.join("\u0001")))
    .map((entry) => [
      ...entry.labels.map((label) => pivotCell(label)),
      ...entry.buckets.map((bucket, index) =>
        pivotCell(aggregateValues(bucket, values[index].aggregation)),
      ),
    ]);

  return { headers, rows };
}
