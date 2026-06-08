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
import { isCellInRange, normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import type { CellAddress, SheetCell } from "@/lib/spreadsheet/types";
import { cn } from "@/lib/utils";

type ExcelSpreadsheetGridProps = {
  sheetKey: string;
  rows: SheetCell[][];
  conditionalFormats?: ConditionalFormatRule[];
  columnWidths?: number[];
  rowHeights?: number[];
  readOnly?: boolean;
  selectionRange: CellRange;
  editingCell: CellAddress | null;
  editDraft: string;
  showFormulas?: boolean;
  showGridlines?: boolean;
  filterHiddenRows?: Set<number>;
  frozenRows?: number;
  frozenCols?: number;
  onSelectCell: (address: CellAddress, extend?: boolean) => void;
  onStartEditing: (address: CellAddress) => void;
  onEditDraftChange: (value: string) => void;
  onCommitEdit: () => void;
  onGridKeyDown: (event: React.KeyboardEvent) => void;
  onFillDragEnd?: (address: CellAddress) => void;
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
  showFormulas,
}: {
  cell: SheetCell;
  row: number;
  col: number;
  rows: SheetCell[][];
  conditionalFormats?: ConditionalFormatRule[];
  showFormulas?: boolean;
}) {
  const cf = resolveConditionalFormat(conditionalFormats, rows, row, col);
  // Human: Prefer imported CF colors over design-time status pills when Excel rules match.
  // Agent: SKIPS statusBadgeTone when CF supplies background, text color, or badge.
  const hasCfPaint = Boolean(cf?.backgroundColor || cf?.textColor || cf?.badge);
  const badge = cf?.badge ?? (hasCfPaint ? null : statusBadgeTone(cell.display));

  const displayText = showFormulas && cell.formula ? cell.formula : cell.display;

  if (badge) {
    return (
      <span
        className={cn("rounded-full font-semibold", badgeClasses(badge))}
        style={{ fontSize: scaledPx(10), padding: `${scaledPx(2)}px ${scaledPx(8)}px` }}
      >
        {displayText}
      </span>
    );
  }

  return (
    <span
      className={cn(
        cell.style?.wrapText ? "whitespace-pre-wrap break-words" : "truncate",
        cell.style?.bold && "font-bold",
        cell.style?.italic && "italic",
        cell.style?.underline && "underline",
        cell.style?.horizontalAlign === "center" && "text-center",
        cell.style?.horizontalAlign === "right" && "text-right",
        (cell.style?.numberFormat === "currency" || typeof cell.value === "number") && "ml-auto text-right",
      )}
      style={{
        fontSize: cell.style?.fontSize ?? scaledPx(12),
        fontFamily: cell.style?.fontFamily,
        color: cf?.textColor ?? cell.style?.textColor ?? "#1A1A1A",
        fontWeight: cf?.bold ? 700 : undefined,
      }}
    >
      {displayText}
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
  selectionRange,
  editingCell,
  editDraft,
  showFormulas = false,
  showGridlines = true,
  filterHiddenRows,
  frozenRows = 0,
  frozenCols = 0,
  onSelectCell,
  onStartEditing,
  onEditDraftChange,
  onCommitEdit,
  onGridKeyDown,
  onFillDragEnd,
  onColumnWidthsChange,
  onRowHeightsChange,
}: ExcelSpreadsheetGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const fillHoverRef = useRef<CellAddress | null>(null);
  const normalizedSelection = useMemo(() => normalizeRange(selectionRange), [selectionRange]);
  const frozenRowCount = Math.max(0, frozenRows);
  const frozenColCount = Math.max(0, frozenCols);
  const [fillDragging, setFillDragging] = useState(false);
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

  const colLeftOffsets = useMemo(() => {
    const offsets: number[] = [];
    let left = GRID_ROW_INDEX_WIDTH;
    for (let index = 0; index < columnCount; index += 1) {
      offsets.push(left);
      left += columnWidths[index];
    }
    return offsets;
  }, [columnCount, columnWidths]);

  const scrollRowCount = Math.max(rows.length - frozenRowCount, 0);

  const rowVirtualizer = useVirtualizer({
    count: scrollRowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rowHeights[index + frozenRowCount] ?? baseRowHeights[index + frozenRowCount],
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

  useEffect(() => {
    if (editingCell) editInputRef.current?.focus();
  }, [editingCell]);

  useEffect(() => {
    if (!fillDragging) return undefined;
    const onUp = () => {
      if (fillHoverRef.current) onFillDragEnd?.(fillHoverRef.current);
      fillHoverRef.current = null;
      setFillDragging(false);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [fillDragging, onFillDragEnd]);

  const borderClass = showGridlines ? "border-[#E5E7EB]" : "border-transparent";

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      role="grid"
      aria-label="Spreadsheet grid"
      onKeyDown={onGridKeyDown}
      className={cn(
        "min-h-0 flex-1 overflow-auto bg-[#F7F8FA] outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
        resizeDrag?.axis === "column" && "cursor-col-resize select-none",
        resizeDrag?.axis === "row" && "cursor-row-resize select-none",
      )}
    >
      <div style={{ width: gridWidth, minWidth: "100%" }}>
        {/* Human: Column header row — corner cell + A…N labels per Pencil AOdk5. */}
        <div
          className={cn("sticky top-0 z-20 flex border-b bg-[#F3F4F6]", borderClass)}
          style={{ height: GRID_HEADER_ROW_HEIGHT }}
        >
          <div
            className={cn("shrink-0 border-r bg-[#E5E7EB]", borderClass)}
            style={{ width: GRID_ROW_INDEX_WIDTH }}
            aria-hidden
          />
          {Array.from({ length: columnCount }, (_, colIndex) => (
            <div
              key={colIndex}
              className={cn("relative flex shrink-0 items-center justify-center border-r font-medium text-[#666666]", borderClass)}
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

        {frozenRowCount > 0 ? (
          <div className="sticky z-10" style={{ top: GRID_HEADER_ROW_HEIGHT }}>
            {Array.from({ length: frozenRowCount }, (_, rowIndex) => {
              if (filterHiddenRows?.has(rowIndex)) return null;
              const row = rows[rowIndex] ?? [];
              const isHeader = rowIndex === 0;
              const isTotalRow = row[0]?.display?.toLowerCase().includes("total");
              const rowHeight = rowHeights[rowIndex] ?? baseRowHeights[rowIndex];

              return (
                <div key={`frozen-${rowIndex}`} className="flex" style={{ height: rowHeight, width: gridWidth }}>
                  <div
                    className={cn(
                      "relative flex shrink-0 items-center justify-center border-r border-b bg-[#F3F4F6] text-[#666666]",
                      borderClass,
                    )}
                    style={{ width: GRID_ROW_INDEX_WIDTH, height: rowHeight, fontSize: scaledPx(11) }}
                  >
                    {rowIndex + 1}
                  </div>

                  {Array.from({ length: columnCount }, (_, colIndex) => {
                    const cell = row[colIndex] ?? { value: null, display: "" };
                    const selected = isCellInRange(rowIndex, colIndex, normalizedSelection);
                    const isActiveCell = editingCell?.row === rowIndex && editingCell.col === colIndex;
                    const isNumericCol = colIndex > 0 && colIndex < columnCount - 1;
                    const cf = resolveConditionalFormat(conditionalFormats, rows, rowIndex, colIndex);
                    const cellFill = cf?.backgroundColor ?? cell.style?.backgroundColor;

                    return (
                      <button
                        key={colIndex}
                        type="button"
                        aria-label={`Cell ${cellAddressLabel({ row: rowIndex, col: colIndex })}`}
                        onClick={(event) => onSelectCell({ row: rowIndex, col: colIndex }, event.shiftKey)}
                        onDoubleClick={() => {
                          if (!readOnly) onStartEditing({ row: rowIndex, col: colIndex });
                        }}
                        className={cn(
                          "relative flex shrink-0 items-center overflow-hidden border-r border-b text-left transition-colors",
                          borderClass,
                          colIndex < frozenColCount && "sticky z-20 bg-white",
                          isHeader && !cellFill && "bg-[#FAFAFA] font-bold",
                          isHeader && cellFill && "font-bold",
                          isTotalRow && !cellFill && "bg-[#EFF6FF]",
                          !isHeader && !isTotalRow && !cellFill && "bg-white",
                          selected && "z-10 border-2 border-[#2563EB] ring-1 ring-[#2563EB]",
                          selected && !cellFill && "bg-[#EFF6FF]",
                          isNumericCol && "justify-end",
                        )}
                        style={{
                          width: columnWidths[colIndex],
                          height: rowHeight,
                          paddingInline: scaledPx(8),
                          backgroundColor: cellFill ?? undefined,
                          left: colIndex < frozenColCount ? colLeftOffsets[colIndex] : undefined,
                        }}
                      >
                        {isActiveCell && !readOnly ? (
                          <input
                            ref={editInputRef}
                            value={editDraft}
                            onChange={(event) => onEditDraftChange(event.target.value)}
                            onBlur={() => onCommitEdit()}
                            onKeyDown={(event) => event.stopPropagation()}
                            className="absolute inset-0 w-full border-0 bg-white px-2 text-[#1A1A1A] outline-none"
                            style={{ fontSize: cell.style?.fontSize ?? scaledPx(12) }}
                            aria-label={`Edit cell ${cellAddressLabel({ row: rowIndex, col: colIndex })}`}
                          />
                        ) : null}
                        <CellContent
                          cell={cell}
                          row={rowIndex}
                          col={colIndex}
                          rows={rows}
                          conditionalFormats={conditionalFormats}
                          showFormulas={showFormulas}
                        />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : null}

        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = virtualRow.index + frozenRowCount;
            if (filterHiddenRows?.has(rowIndex)) return null;
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
                  className={cn("relative flex shrink-0 items-center justify-center border-r border-b bg-[#F3F4F6] text-[#666666]", borderClass)}
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
                  const selected = isCellInRange(rowIndex, colIndex, normalizedSelection);
                  const isActiveCell =
                    editingCell?.row === rowIndex && editingCell.col === colIndex;
                  const isNumericCol = colIndex > 0 && colIndex < columnCount - 1;
                  const cf = resolveConditionalFormat(conditionalFormats, rows, rowIndex, colIndex);
                  const cellFill = cf?.backgroundColor ?? cell.style?.backgroundColor;

                  return (
                    <button
                      key={colIndex}
                      type="button"
                      aria-label={`Cell ${cellAddressLabel({ row: rowIndex, col: colIndex })}`}
                      onClick={(event) => onSelectCell({ row: rowIndex, col: colIndex }, event.shiftKey)}
                      onMouseEnter={() => {
                        if (fillDragging) fillHoverRef.current = { row: rowIndex, col: colIndex };
                      }}
                      onDoubleClick={() => {
                        if (!readOnly) onStartEditing({ row: rowIndex, col: colIndex });
                      }}
                      className={cn(
                        "relative flex shrink-0 items-center overflow-hidden border-r border-b text-left transition-colors",
                        borderClass,
                        colIndex < frozenColCount && "sticky z-20 bg-white",
                        isHeader && !cellFill && "bg-[#FAFAFA] font-bold",
                        isHeader && cellFill && "font-bold",
                        isTotalRow && !cellFill && "bg-[#EFF6FF]",
                        !isHeader && !isTotalRow && !cellFill && "bg-white",
                        selected && "z-10 border-2 border-[#2563EB] ring-1 ring-[#2563EB]",
                        selected && !cellFill && "bg-[#EFF6FF]",
                        isNumericCol && "justify-end",
                      )}
                      style={{
                        width: columnWidths[colIndex],
                        height: rowHeight,
                        paddingInline: scaledPx(8),
                        backgroundColor: cellFill ?? undefined,
                        left: colIndex < frozenColCount ? colLeftOffsets[colIndex] : undefined,
                      }}
                    >
                      {rowIndex === normalizedSelection.end.row &&
                      colIndex === normalizedSelection.end.col &&
                      !readOnly &&
                      onFillDragEnd ? (
                        <div
                          role="separator"
                          aria-label="Fill handle"
                          className="absolute -bottom-1 -right-1 z-30 size-2 cursor-crosshair border border-[#2563EB] bg-[#2563EB]"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setFillDragging(true);
                          }}
                        />
                      ) : null}
                      {isActiveCell && !readOnly ? (
                        <input
                          ref={editInputRef}
                          value={editDraft}
                          onChange={(event) => onEditDraftChange(event.target.value)}
                          onBlur={() => onCommitEdit()}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="absolute inset-0 w-full border-0 bg-white px-2 text-[#1A1A1A] outline-none"
                          style={{ fontSize: cell.style?.fontSize ?? scaledPx(12) }}
                          aria-label={`Edit cell ${cellAddressLabel({ row: rowIndex, col: colIndex })}`}
                        />
                      ) : null}
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
                        showFormulas={showFormulas}
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
