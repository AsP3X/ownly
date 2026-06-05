// Human: Scrollable spreadsheet grid with column headers, row indices, and cell selection.
// Agent: READS SheetCell matrix; EMITS cell select; RENDERS status badges + active cell highlight per Pencil grid.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { cellAddressLabel, columnIndexToLetters, statusBadgeTone } from "@/lib/spreadsheet/cells";
import type { CellAddress, SheetCell } from "@/lib/spreadsheet/types";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 25;
const ROW_INDEX_WIDTH = 40;
const DEFAULT_COL_WIDTH = 100;
const FIRST_COL_WIDTH = 179;

type ExcelSpreadsheetGridProps = {
  rows: SheetCell[][];
  selection: CellAddress | null;
  onSelectCell: (address: CellAddress) => void;
};

function badgeClasses(tone: ReturnType<typeof statusBadgeTone>) {
  switch (tone) {
    case "on-track":
      return "bg-[#D1FAE5] text-[#047857]";
    case "over-budget":
      return "bg-[#FEE2E2] text-[#B91C1C]";
    case "under-budget":
      return "bg-[#DBEAFE] text-[#1D4ED8]";
    default:
      return "";
  }
}

function CellContent({ cell }: { cell: SheetCell }) {
  const badge = statusBadgeTone(cell.display);
  if (badge) {
    return (
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeClasses(badge))}>
        {cell.display}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "truncate text-xs text-[#1A1A1A]",
        cell.style?.bold && "font-bold",
        cell.style?.italic && "italic",
        cell.style?.underline && "underline",
        cell.style?.horizontalAlign === "center" && "text-center",
        cell.style?.horizontalAlign === "right" && "text-right",
        (cell.style?.numberFormat === "currency" || typeof cell.value === "number") && "ml-auto text-right",
      )}
    >
      {cell.display}
    </span>
  );
}

export function ExcelSpreadsheetGrid({ rows, selection, onSelectCell }: ExcelSpreadsheetGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const columnCount = Math.max(...rows.map((row) => row.length), 1);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const colWidths = Array.from({ length: columnCount }, (_, index) =>
    index === 0 ? FIRST_COL_WIDTH : DEFAULT_COL_WIDTH,
  );
  const gridWidth = ROW_INDEX_WIDTH + colWidths.reduce((sum, width) => sum + width, 0);

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto bg-[#F7F8FA]">
      <div style={{ width: gridWidth, minWidth: "100%" }}>
        {/* Human: Column header row — corner cell + A…N labels per Pencil AOdk5. */}
        <div className="sticky top-0 z-20 flex h-[26px] border-b border-[#E5E7EB] bg-[#F3F4F6]">
          <div className="w-10 shrink-0 border-r border-[#E5E7EB] bg-[#E5E7EB]" aria-hidden />
          {Array.from({ length: columnCount }, (_, colIndex) => (
            <div
              key={colIndex}
              style={{ width: colWidths[colIndex] }}
              className="flex shrink-0 items-center justify-center border-r border-[#E5E7EB] text-xs font-medium text-[#666666]"
            >
              {columnIndexToLetters(colIndex)}
            </div>
          ))}
        </div>

        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = virtualRow.index;
            const row = rows[rowIndex] ?? [];
            const isHeader = rowIndex === 0;
            const isTotalRow = row[0]?.display?.toLowerCase().includes("total");

            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 flex"
                style={{
                  top: virtualRow.start,
                  height: virtualRow.size,
                  width: gridWidth,
                }}
              >
                <div className="flex w-10 shrink-0 items-center justify-center border-r border-b border-[#E5E7EB] bg-[#F3F4F6] text-[11px] text-[#666666]">
                  {rowIndex + 1}
                </div>

                {Array.from({ length: columnCount }, (_, colIndex) => {
                  const cell = row[colIndex] ?? { value: null, display: "" };
                  const selected = selection?.row === rowIndex && selection.col === colIndex;
                  const isNumericCol = colIndex > 0 && colIndex < columnCount - 1;

                  return (
                    <button
                      key={colIndex}
                      type="button"
                      style={{ width: colWidths[colIndex] }}
                      aria-label={`Cell ${cellAddressLabel({ row: rowIndex, col: colIndex })}`}
                      onClick={() => onSelectCell({ row: rowIndex, col: colIndex })}
                      className={cn(
                        "flex shrink-0 items-center border-r border-b border-[#E5E7EB] px-2 text-left transition-colors",
                        isHeader && "bg-[#FAFAFA] font-bold",
                        isTotalRow && "bg-[#EFF6FF]",
                        !isHeader && !isTotalRow && "bg-white",
                        selected && "z-10 border-2 border-[#2563EB] bg-[#EFF6FF] ring-1 ring-[#2563EB]",
                        isNumericCol && "justify-end",
                      )}
                    >
                      <CellContent cell={cell} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
