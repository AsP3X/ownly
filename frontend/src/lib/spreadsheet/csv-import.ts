// Human: Parse CSV text into a new sheet for the Excel dialog Data tab import.
// Agent: SPLITS lines on commas/tabs; RETURNS SheetData ready for workbook append.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { normalizeSheetGrid } from "@/lib/spreadsheet/grid";
import type { SheetCell, SheetData } from "@/lib/spreadsheet/types";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function cellFromText(text: string): SheetCell {
  const trimmed = text.trim();
  const numeric = Number(trimmed.replace(/[$,%\s,]/g, ""));
  const value =
    trimmed === "" ? null : Number.isFinite(numeric) && trimmed !== "" ? numeric : trimmed;
  return {
    value,
    display: formatCellDisplay(value, "general"),
  };
}

// Human: Convert CSV/TSV string into a normalized sheet model.
// Agent: DETECTS delimiter from first line; NAMES sheet from caller.
export function csvTextToSheet(text: string, sheetName: string): SheetData {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  const delimiter = lines[0]?.includes("\t") && !lines[0]?.includes(",") ? "\t" : ",";

  const rows = lines.map((line) => {
    const parts = delimiter === "\t" ? line.split("\t") : parseCsvLine(line);
    return parts.map((part) => cellFromText(part));
  });

  return normalizeSheetGrid({
    name: sheetName,
    rows: rows.length > 0 ? rows : [[{ value: null, display: "" }]],
  });
}
