// Human: Scrollable spreadsheet grid with column headers, row indices, and cell selection.
// Agent: READS SheetCell matrix + dimensions; EMITS cell select + column/row resize like Excel.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cellAddressLabel, columnIndexToLetters, statusBadgeTone } from "@/lib/spreadsheet/cells";
import { resolveConditionalFormat } from "@/lib/spreadsheet/conditional-formatting";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import {
  GRID_HEADER_ROW_HEIGHT,
  GRID_MIN_COL_WIDTH,
  GRID_MIN_ROW_HEIGHT,
  GRID_ROW_INDEX_WIDTH,
  autoFitColumnWidth,
  autoFitRowHeight,
  resolveColumnWidths,
  resolveRowHeights,
} from "@/lib/spreadsheet/dimensions";
import type { ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";
import type { CellAddress, SheetCell } from "@/lib/spreadsheet/types";
import { cn } from "@/lib/utils";

type ExcelSpreadsheetGridProps = {
  sheetKey: string;
  rows: SheetCell[][];
  conditionalFormats?: ConditionalFormatRule[];
  columnWidths?: number[];
  rowHeights?: number[];
  readOnly?: boolean;
  selection: CellAddress | null;
  onSelectCell: (address: CellAddress) => void;
  onColumnWidthsChange?: (widths: number[]) => void;
  onRowHeightsChange?: (heights: number[]) => void;
};

type ResizeDrag =
  | { axis: "column"; index: number; startClient: number; startSize: number }
  | { axis: "row"; index: number; startClient: number; startSize: number };

function badgeClasses(tone: "on-track" | "over-budget" | "under-budget") {
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

function CellContent({
  cell,
  row,
  col,
  rows,
  conditionalFormats,
}: {
  cell: SheetCell;
  row: number;
  col: number;
  rows: SheetCell[][];
  conditionalFormats?: ConditionalFormatRule[];
}) {
  const cf = resolveConditionalFormat(conditionalFormats, rows, row, col);
  const badge = cf?.badge ?? statusBadgeTone(cell.display);

  if (badge) {
    return (
      <span
        className={cn("rounded-full font-semibold", badgeClasses(badge))}
        style={{ fontSize: scaledPx(10), padding: `${scaledPx(2)}px ${scaledPx(8)}px` }}
      >
        {cell.display}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "truncate",
        cell.style?.bold && "font-bold",
        cell.style?.italic && "italic",
        cell.style?.underline && "underline",
        cell.style?.horizontalAlign === "center" && "text-center",
        cell.style?.horizontalAlign === "right" && "text-right",
        (cell.style?.numberFormat === "currency" || typeof cell.value === "number") && "ml-auto text-right",
      )}
      style={{
        fontSize: scaledPx(12),
        color: cf?.textColor ?? cell.style?.textColor ?? "#1A1A1A",
        fontWeight: cf?.bold ? 700 : undefined,
      }}
    >
      {cell.display}
    </span>
  );
}

// Human: Hit target on column header right edge — drag to resize, double-click to auto-fit.
// Agent: CAPTURES pointer; STOPS propagation so header does not steal cell selection.
function ColumnResizeHandle({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      className="absolute top-0 -right-px bottom-0 z-30 translate-x-1/2 cursor-col-resize touch-none select-none hover:bg-[#2563EB]/20"
      style={{ width: scaledPx(6) }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

// Human: Hit target on row index bottom edge — drag to resize, double-click to auto-fit.
// Agent: CAPTURES pointer; STOPS propagation so row index does not select cells.
function RowResizeHandle({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize row"
      className="absolute right-0 -bottom-px left-0 z-30 translate-y-1/2 cursor-row-resize touch-none select-none hover:bg-[#2563EB]/20"
      style={{ height: scaledPx(6) }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export function ExcelSpreadsheetGrid({
  sheetKey,
  rows,
  conditionalFormats,
  columnWidths: columnWidthsProp,
  rowHeights: rowHeightsProp,
  readOnly = false,
  selection,
  onSelectCell,
  onColumnWidthsChange,
  onRowHeightsChange,
}: ExcelSpreadsheetGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const columnCount = Math.max(...rows.map((row) => row.length), 1);

  const baseColumnWidths = useMemo(
    () => resolveColumnWidths({ rows, columnWidths: columnWidthsProp }, columnCount),
    [columnCount, columnWidthsProp, rows],
  );
  const baseRowHeights = useMemo(
    () => resolveRowHeights({ rows, rowHeights: rowHeightsProp }, rows.length),
    [rowHeightsProp, rows],
  );

  const [previewColumnWidths, setPreviewColumnWidths] = useState<number[] | null>(null);
  const [previewRowHeights, setPreviewRowHeights] = useState<number[] | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);

  const columnWidths = previewColumnWidths ?? baseColumnWidths;
  const rowHeights = previewRowHeights ?? baseRowHeights;
  const gridWidth = GRID_ROW_INDEX_WIDTH + columnWidths.reduce((sum, width) => sum + width, 0);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rowHeights[index] ?? baseRowHeights[index],
    overscan: 8,
  });

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeights, rows.length, rowVirtualizer]);

  // Human: Clear in-progress resize when the active sheet or stored dimensions change.
  // Agent: PREVENTS stale preview widths/heights after sheet tab switch.
  useEffect(() => {
    setPreviewColumnWidths(null);
    setPreviewRowHeights(null);
    setResizeDrag(null);
  }, [columnWidthsProp, rowHeightsProp, sheetKey]);

  const commitColumnWidths = useCallback(
    (widths: number[]) => {
      setPreviewColumnWidths(null);
      onColumnWidthsChange?.(widths);
    },
    [onColumnWidthsChange],
  );

  const commitRowHeights = useCallback(
    (heights: number[]) => {
      setPreviewRowHeights(null);
      onRowHeightsChange?.(heights);
    },
    [onRowHeightsChange],
  );

  const startColumnResize = useCallback(
    (colIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizeDrag({
        axis: "column",
        index: colIndex,
        startClient: event.clientX,
        startSize: columnWidths[colIndex],
      });
      setPreviewColumnWidths([...columnWidths]);
    },
    [columnWidths, readOnly],
  );

  const startRowResize = useCallback(
    (rowIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizeDrag({
        axis: "row",
        index: rowIndex,
        startClient: event.clientY,
        startSize: rowHeights[rowIndex],
      });
      setPreviewRowHeights([...rowHeights]);
    },
    [readOnly, rowHeights],
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!resizeDrag) return;

      if (resizeDrag.axis === "column") {
        const delta = event.clientX - resizeDrag.startClient;
        const nextWidth = Math.max(GRID_MIN_COL_WIDTH, Math.round(resizeDrag.startSize + delta));
        setPreviewColumnWidths((current) => {
          const base = current ?? [...baseColumnWidths];
          const next = [...base];
          next[resizeDrag.index] = nextWidth;
          return next;
        });
        return;
      }

      const delta = event.clientY - resizeDrag.startClient;
      const nextHeight = Math.max(GRID_MIN_ROW_HEIGHT, Math.round(resizeDrag.startSize + delta));
      setPreviewRowHeights((current) => {
        const base = current ?? [...baseRowHeights];
        const next = [...base];
        next[resizeDrag.index] = nextHeight;
        return next;
      });
    },
    [baseColumnWidths, baseRowHeights, resizeDrag],
  );

  const finishResize = useCallback(() => {
    if (!resizeDrag) return;

    if (resizeDrag.axis === "column" && previewColumnWidths) {
      commitColumnWidths(previewColumnWidths);
    } else if (resizeDrag.axis === "row" && previewRowHeights) {
      commitRowHeights(previewRowHeights);
    }

    setResizeDrag(null);
  }, [commitColumnWidths, commitRowHeights, previewColumnWidths, previewRowHeights, resizeDrag]);

  useEffect(() => {
    if (!resizeDrag) return undefined;

    const onMove = (event: PointerEvent) => handleResizePointerMove(event);
    const onUp = () => finishResize();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [finishResize, handleResizePointerMove, resizeDrag]);

  const autoFitColumn = useCallback(
    (colIndex: number) => {
      if (readOnly) return;
      const next = [...baseColumnWidths];
      next[colIndex] = autoFitColumnWidth(rows, colIndex);
      commitColumnWidths(next);
    },
    [baseColumnWidths, commitColumnWidths, readOnly, rows],
  );

  const autoFitRow = useCallback(
    (rowIndex: number) => {
      if (readOnly) return;
      const next = [...baseRowHeights];
      next[rowIndex] = autoFitRowHeight(rows, rowIndex, baseColumnWidths);
      commitRowHeights(next);
    },
    [baseColumnWidths, baseRowHeights, commitRowHeights, readOnly, rows],
  );

  return (
    <div
      ref={parentRef}
      className={cn(
        "min-h-0 flex-1 overflow-auto bg-[#F7F8FA]",
        resizeDrag?.axis === "column" && "cursor-col-resize select-none",
        resizeDrag?.axis === "row" && "cursor-row-resize select-none",
      )}
    >
      <div style={{ width: gridWidth, minWidth: "100%" }}>
        {/* Human: Column header row — corner cell + A…N labels per Pencil AOdk5. */}
        <div
          className="sticky top-0 z-20 flex border-b border-[#E5E7EB] bg-[#F3F4F6]"
          style={{ height: GRID_HEADER_ROW_HEIGHT }}
        >
          <div
            className="shrink-0 border-r border-[#E5E7EB] bg-[#E5E7EB]"
            style={{ width: GRID_ROW_INDEX_WIDTH }}
            aria-hidden
          />
          {Array.from({ length: columnCount }, (_, colIndex) => (
            <div
              key={colIndex}
              className="relative flex shrink-0 items-center justify-center border-r border-[#E5E7EB] font-medium text-[#666666]"
              style={{ width: columnWidths[colIndex], fontSize: scaledPx(12) }}
            >
              {columnIndexToLetters(colIndex)}
              {!readOnly && onColumnWidthsChange ? (
                <ColumnResizeHandle
                  onPointerDown={(event) => startColumnResize(colIndex, event)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFitColumn(colIndex);
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>

        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = virtualRow.index;
            const row = rows[rowIndex] ?? [];
            const isHeader = rowIndex === 0;
            const isTotalRow = row[0]?.display?.toLowerCase().includes("total");
            const rowHeight = rowHeights[rowIndex] ?? baseRowHeights[rowIndex];

            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 flex"
                style={{
                  top: virtualRow.start,
                  height: rowHeight,
                  width: gridWidth,
                }}
              >
                <div
                  className="relative flex shrink-0 items-center justify-center border-r border-b border-[#E5E7EB] bg-[#F3F4F6] text-[#666666]"
                  style={{ width: GRID_ROW_INDEX_WIDTH, height: rowHeight, fontSize: scaledPx(11) }}
                >
                  {rowIndex + 1}
                  {!readOnly && onRowHeightsChange ? (
                    <RowResizeHandle
                      onPointerDown={(event) => startRowResize(rowIndex, event)}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        autoFitRow(rowIndex);
                      }}
                    />
                  ) : null}
                </div>

                {Array.from({ length: columnCount }, (_, colIndex) => {
                  const cell = row[colIndex] ?? { value: null, display: "" };
                  const selected = selection?.row === rowIndex && selection.col === colIndex;
                  const isNumericCol = colIndex > 0 && colIndex < columnCount - 1;
                  const cf = resolveConditionalFormat(conditionalFormats, rows, rowIndex, colIndex);

                  return (
                    <button
                      key={colIndex}
                      type="button"
                      aria-label={`Cell ${cellAddressLabel({ row: rowIndex, col: colIndex })}`}
                      onClick={() => onSelectCell({ row: rowIndex, col: colIndex })}
                      className={cn(
                        "relative flex shrink-0 items-center overflow-hidden border-r border-b border-[#E5E7EB] text-left transition-colors",
                        isHeader && "bg-[#FAFAFA] font-bold",
                        isTotalRow && "bg-[#EFF6FF]",
                        !isHeader &&
                          !isTotalRow &&
                          !cf?.backgroundColor &&
                          !cell.style?.backgroundColor &&
                          "bg-white",
                        selected && "z-10 border-2 border-[#2563EB] bg-[#EFF6FF] ring-1 ring-[#2563EB]",
                        isNumericCol && "justify-end",
                      )}
                      style={{
                        width: columnWidths[colIndex],
                        height: rowHeight,
                        paddingInline: scaledPx(8),
                        backgroundColor:
                          !selected && (cf?.backgroundColor ?? cell.style?.backgroundColor)
                            ? (cf?.backgroundColor ?? cell.style?.backgroundColor)
                            : undefined,
                      }}
                    >
                      {/* Agent: Data bar overlay from conditional formatting rules. */}
                      {cf?.dataBarPercent !== undefined && cf.dataBarColor ? (
                        <span
                          className="pointer-events-none absolute inset-y-1 left-1 rounded-sm opacity-30"
                          style={{
                            width: `calc(${Math.round(cf.dataBarPercent * 100)}% - ${scaledPx(8)}px)`,
                            backgroundColor: cf.dataBarColor,
                          }}
                          aria-hidden
                        />
                      ) : null}
                      <CellContent
                        cell={cell}
                        row={rowIndex}
                        col={colIndex}
                        rows={rows}
                        conditionalFormats={conditionalFormats}
                      />
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
