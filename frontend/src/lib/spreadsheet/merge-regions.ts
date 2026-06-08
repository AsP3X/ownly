// Human: Helpers for merged cell regions — lookup, normalize, grid render hints.
// Agent: READS MergedRegion[] on SheetData; USED by grid and workbook-ops.

import type { MergedRegion } from "@/lib/spreadsheet/types";

export type MergeAnchorInfo = {
  region: MergedRegion;
  rowSpan: number;
  colSpan: number;
  isAnchor: boolean;
  isCovered: boolean;
};

// Human: Normalize merge bounds so start ≤ end on both axes.
// Agent: RETURNS canonical MergedRegion for storage and OOXML export.
export function normalizeMergedRegion(region: MergedRegion): MergedRegion {
  return {
    startRow: Math.min(region.startRow, region.endRow),
    startCol: Math.min(region.startCol, region.endCol),
    endRow: Math.max(region.startRow, region.endRow),
    endCol: Math.max(region.startCol, region.endCol),
  };
}

// Human: Find merge metadata for a grid cell coordinate.
// Agent: RETURNS anchor span info or covered-slave flag for render skip.
export function mergeInfoAt(
  regions: MergedRegion[] | undefined,
  row: number,
  col: number,
): MergeAnchorInfo | null {
  if (!regions?.length) return null;

  for (const raw of regions) {
    const region = normalizeMergedRegion(raw);
    const inRegion =
      row >= region.startRow &&
      row <= region.endRow &&
      col >= region.startCol &&
      col <= region.endCol;
    if (!inRegion) continue;

    const isAnchor = row === region.startRow && col === region.startCol;
    return {
      region,
      rowSpan: region.endRow - region.startRow + 1,
      colSpan: region.endCol - region.startCol + 1,
      isAnchor,
      isCovered: !isAnchor,
    };
  }

  return null;
}

// Human: Add or replace a merge region covering the same top-left anchor.
// Agent: CALLED from mergeCellsInRange after cell content merge.
export function upsertMergedRegion(regions: MergedRegion[] | undefined, next: MergedRegion): MergedRegion[] {
  const normalized = normalizeMergedRegion(next);
  const without = (regions ?? []).filter(
    (entry) =>
      !(
        entry.startRow === normalized.startRow &&
        entry.startCol === normalized.startCol
      ),
  );
  return [...without, normalized];
}

// Human: Remove any merge region that intersects a rectangular range.
// Agent: USED before unmerge or re-merge operations.
export function removeMergesIntersecting(
  regions: MergedRegion[] | undefined,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): MergedRegion[] {
  if (!regions?.length) return [];
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);

  return regions.filter((raw) => {
    const region = normalizeMergedRegion(raw);
    const disjoint =
      region.endRow < minRow ||
      region.startRow > maxRow ||
      region.endCol < minCol ||
      region.startCol > maxCol;
    return disjoint;
  });
}
