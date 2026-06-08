// Human: Scrollable spreadsheet grid with column headers, row indices, and cell selection.
// Agent: READS SheetCell matrix + dimensions; EMITS cell select + column/row resize like Excel.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { cellAddressLabel, columnIndexToLetters, statusBadgeTone } from "@/lib/spreadsheet/cells";
import {
  horizontalAlignJustifyClass,
  resolveFontWeight,
  resolveHorizontalAlign,
  verticalAlignItemsClass,
} from "@/lib/spreadsheet/cell-styles";
import { resolveConditionalFormat } from "@/lib/spreadsheet/conditional-formatting";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import {
  GRID_HEADER_ROW_HEIGHT,
  GRID_MAX_COL_WIDTH,
  GRID_MIN_COL_WIDTH,
  GRID_MIN_ROW_HEIGHT,
  GRID_ROW_INDEX_WIDTH,
  autoFitColumnWidth,
  autoFitRowHeight,
  resolveColumnWidths,
  resolveRowHeights,
} from "@/lib/spreadsheet/dimensions";
import type { ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";
import { isCellInRange, isFullSheetSelection, normalizeRange, type CellRange } from "@/lib/spreadsheet/selection";
import { mergeInfoAt } from "@/lib/spreadsheet/merge-regions";
import type {
  CellAddress,
  CellStyle,
  MergedRegion,
  SheetCell,
  SheetDrawingStroke,
  SheetPrintArea,
} from "@/lib/spreadsheet/types";
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
  hiddenRows?: number[];
  hiddenCols?: number[];
  mergedRegions?: MergedRegion[];
  frozenRows?: number;
  frozenCols?: number;
  precedentHighlight?: Set<string>;
  printArea?: SheetPrintArea | null;
  zoomPercent?: number;
  drawings?: SheetDrawingStroke[];
  drawMode?: "pen" | "eraser" | null;
  drawColor?: string;
  onSelectCell: (address: CellAddress, extend?: boolean) => void;
  onSelectAll?: () => void;
  onStartEditing: (address: CellAddress) => void;
  onEditDraftChange: (value: string) => void;
  onCommitEdit: () => void;
  onGridKeyDown: (event: React.KeyboardEvent) => void;
  onFillDragEnd?: (address: CellAddress) => void;
  onColumnWidthsChange?: (widths: number[]) => void;
  onRowHeightsChange?: (heights: number[]) => void;
  // Human: Lets dialog flush in-progress resize preview into workbook before xlsx serialize.
  // Agent: CALLS onColumnWidthsChange/onRowHeightsChange with live preview refs when registered.
  onRegisterDimensionFlush?: (flush: (() => void) | null) => void;
};

type ColumnResizeDrag = { axis: "column"; index: number };
type RowResizeDrag = {
  axis: "row";
  index: number;
  startClient: number;
  startSize: number;
  pointerId: number;
  initial: number[];
};

type ResizeDrag = ColumnResizeDrag | RowResizeDrag;

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

function cellBorderStyles(style?: CellStyle): CSSProperties {
  if (!style) return {};
  const color = style.borderColor ?? "#1A1A1A";
  const edge = `1px solid ${color}`;
  return {
    borderTop: style.borderTop ? edge : undefined,
    borderRight: style.borderRight ? edge : undefined,
    borderBottom: style.borderBottom ? edge : undefined,
    borderLeft: style.borderLeft ? edge : undefined,
  };
}

// Human: Highlight dashed outline on print-area perimeter cells.
// Agent: READS SheetPrintArea bounds; RETURNS true for edge cells only.
function isPrintAreaEdge(row: number, col: number, printArea: SheetPrintArea): boolean {
  const range = normalizeRange({
    start: { row: printArea.startRow, col: printArea.startCol },
    end: { row: printArea.endRow, col: printArea.endCol },
  });
  if (!isCellInRange(row, col, range)) return false;
  return row === range.start.row || row === range.end.row || col === range.start.col || col === range.end.col;
}

// Human: Red corner marker when a cell has an attached comment note.
function CellCommentMarker({ comment }: { comment?: string }) {
  if (!comment) return null;
  return (
    <span
      className="pointer-events-none absolute right-0 top-0 size-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-[#EAB308]"
      title={comment}
      aria-hidden
    />
  );
}

function CellContent({
  cell,
  row,
  col,
  rows,
  conditionalFormats,
  showFormulas,
  headerRow,
}: {
  cell: SheetCell;
  row: number;
  col: number;
  rows: SheetCell[][];
  conditionalFormats?: ConditionalFormatRule[];
  showFormulas?: boolean;
  headerRow?: boolean;
}) {
  const cf = resolveConditionalFormat(conditionalFormats, rows, row, col);
  // Human: Prefer imported CF colors over design-time status pills when Excel rules match.
  // Agent: SKIPS statusBadgeTone when CF supplies background, text color, or badge.
  const hasCfPaint = Boolean(cf?.backgroundColor || cf?.textColor || cf?.badge);
  const badge = cf?.badge ?? (hasCfPaint ? null : statusBadgeTone(cell.display));

  const displayText = showFormulas && cell.formula ? cell.formula : cell.display;
  const horizontalAlign = resolveHorizontalAlign(cell);

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
        "block w-full min-w-0",
        cell.style?.wrapText ? "whitespace-pre-wrap break-words" : "truncate",
        cell.style?.italic && "italic",
        cell.style?.underline && "underline",
        horizontalAlign === "center" && "text-center",
        horizontalAlign === "right" && "text-right",
      )}
      style={{
        fontSize: cell.style?.fontSize ?? scaledPx(12),
        fontFamily: cell.style?.fontFamily,
        color: cf?.textColor ?? cell.style?.textColor ?? (cell.hyperlink ? "#2563EB" : "#1A1A1A"),
        fontWeight: resolveFontWeight(cell.style, { headerRow, conditionalBold: cf?.bold }),
        textDecoration: cell.style?.underline || cell.hyperlink ? "underline" : undefined,
      }}
    >
      {displayText}
    </span>
  );
}

// Human: Hit target on column header right edge — drag to resize, double-click to auto-fit.
// Agent: CAPTURES pointer; STOPS propagation so header does not steal cell selection.
function ColumnResizeHandle({
  onMouseDown,
  onDoubleClick,
}: {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      className="absolute top-0 -right-px bottom-0 z-30 translate-x-1/2 cursor-col-resize touch-none select-none hover:bg-[#2563EB]/20"
      style={{ width: scaledPx(6) }}
      onMouseDown={onMouseDown}
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
  hiddenRows,
  hiddenCols,
  mergedRegions,
  frozenRows = 0,
  frozenCols = 0,
  precedentHighlight,
  printArea,
  zoomPercent = 100,
  drawings,
  onSelectCell,
  onSelectAll,
  onStartEditing,
  onEditDraftChange,
  onCommitEdit,
  onGridKeyDown,
  onFillDragEnd,
  onColumnWidthsChange,
  onRowHeightsChange,
  onRegisterDimensionFlush,
}: ExcelSpreadsheetGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const fillHoverRef = useRef<CellAddress | null>(null);
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const normalizedSelection = useMemo(() => normalizeRange(selectionRange), [selectionRange]);
  const isFullSheetSelected = useMemo(
    () => isFullSheetSelection(normalizedSelection, rows.length, columnCount),
    [columnCount, normalizedSelection, rows.length],
  );
  const isFullSheetSelectedRef = useRef(isFullSheetSelected);
  isFullSheetSelectedRef.current = isFullSheetSelected;
  const hiddenRowSet = useMemo(() => new Set(hiddenRows ?? []), [hiddenRows]);
  const hiddenColSet = useMemo(() => new Set(hiddenCols ?? []), [hiddenCols]);
  const zoomScale = Math.min(200, Math.max(50, zoomPercent)) / 100;

  // Human: Skip merge slaves and user-hidden columns when painting cells.
  // Agent: READS mergedRegions + hiddenCols; RETURNS false for covered/hidden cells.
  const isCellVisible = useCallback(
    (row: number, col: number) => {
      if (hiddenColSet.has(col)) return false;
      const merge = mergeInfoAt(mergedRegions, row, col);
      if (merge?.isCovered) return false;
      return true;
    },
    [hiddenColSet, mergedRegions],
  );

  const frozenRowCount = Math.max(0, frozenRows);
  const frozenColCount = Math.max(0, frozenCols);
  const [fillDragging, setFillDragging] = useState(false);

  const baseColumnWidths = useMemo(
    () => resolveColumnWidths({ rows, columnWidths: columnWidthsProp }, columnCount),
    [columnCount, columnWidthsProp, rows],
  );
  const baseRowHeights = useMemo(
    () => resolveRowHeights({ rows, rowHeights: rowHeightsProp }, rows.length),
    [rowHeightsProp, rows],
  );

  const [previewRowHeights, setPreviewRowHeights] = useState<number[] | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);
  const [dragPaintTick, setDragPaintTick] = useState(0);
  const previewRowHeightsRef = useRef<number[] | null>(null);
  const columnResizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeDragRef = useRef<ResizeDrag | null>(null);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);
  const onColumnWidthsChangeRef = useRef(onColumnWidthsChange);
  const onRowHeightsChangeRef = useRef(onRowHeightsChange);
  const baseColumnWidthsRef = useRef(baseColumnWidths);
  const baseRowHeightsRef = useRef(baseRowHeights);

  // Human: Keep resize refs aligned with the latest rendered dimensions (not the next effect tick).
  // Agent: PREVENTS stale start sizes that block column widen after a narrow commit.
  baseColumnWidthsRef.current = baseColumnWidths;
  baseRowHeightsRef.current = baseRowHeights;
  onColumnWidthsChangeRef.current = onColumnWidthsChange;
  onRowHeightsChangeRef.current = onRowHeightsChange;

  // Human: Live row drag overlay reads refs; dragPaintTick forces re-render on pointermove.
  // Agent: Column widths commit directly to workbook — no preview overlay for columns.
  void dragPaintTick;
  const columnWidths = baseColumnWidths;
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

  // Human: TanStack Virtual is incompatible with React Compiler memoization — safe to use here.
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer returns unstable function refs by design
  const rowVirtualizer = useVirtualizer({
    count: scrollRowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rowHeights[index + frozenRowCount] ?? baseRowHeights[index + frozenRowCount],
    overscan: 8,
  });

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeights, rows.length, rowVirtualizer]);

  useLayoutEffect(() => {
    if (resizeDrag || !previewRowHeights) return;

    const synced = previewRowHeights.every((height, index) => {
      const expected = baseRowHeights[index];
      return Math.abs(expected - height) <= 1;
    });
    if (!synced) return;

    previewRowHeightsRef.current = null;
    setPreviewRowHeights(null);
  }, [baseRowHeights, previewRowHeights, resizeDrag]);

  // Human: Reset resize state when switching worksheet tabs.
  // Agent: PREVENTS stale preview widths/heights after sheet tab switch.
  useEffect(() => {
    columnResizeCleanupRef.current?.();
    columnResizeCleanupRef.current = null;
    activeResizeCleanupRef.current?.();
    activeResizeCleanupRef.current = null;
    previewRowHeightsRef.current = null;
    resizeDragRef.current = null;
    setPreviewRowHeights(null);
    setResizeDrag(null);
  }, [sheetKey]);

  useEffect(
    () => () => {
      columnResizeCleanupRef.current?.();
      columnResizeCleanupRef.current = null;
      activeResizeCleanupRef.current?.();
      activeResizeCleanupRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!onRegisterDimensionFlush) return undefined;

    const flush = () => {
      const heights = previewRowHeightsRef.current;
      if (heights) onRowHeightsChangeRef.current?.(heights);
    };

    onRegisterDimensionFlush(flush);
    return () => onRegisterDimensionFlush(null);
  }, [onRegisterDimensionFlush]);

  const finishColumnResize = useCallback(() => {
    columnResizeCleanupRef.current?.();
    columnResizeCleanupRef.current = null;
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    parentRef.current?.style.removeProperty("overflow");
    resizeDragRef.current = null;
    setResizeDrag(null);
  }, []);

  const finishActiveResize = useCallback(() => {
    activeResizeCleanupRef.current?.();
    activeResizeCleanupRef.current = null;

    const drag = resizeDragRef.current;
    if (!drag) return;

    if (drag.axis === "column") {
      finishColumnResize();
      return;
    }

    try {
      if (document.body.hasPointerCapture(drag.pointerId)) {
        document.body.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Human: releasePointerCapture throws if capture was already lost — safe to ignore.
    }

    const heights = previewRowHeightsRef.current;
    if (heights) {
      flushSync(() => {
        onRowHeightsChangeRef.current?.([...heights]);
      });
    }

    resizeDragRef.current = null;
    setResizeDrag(null);
    setDragPaintTick((tick) => tick + 1);
    parentRef.current?.style.removeProperty("overflow");
  }, [finishColumnResize]);

  const commitColumnWidths = useCallback((widths: number[]) => {
    flushSync(() => {
      onColumnWidthsChangeRef.current?.([...widths]);
    });
  }, []);

  const commitRowHeights = useCallback((heights: number[]) => {
    flushSync(() => {
      onRowHeightsChangeRef.current?.([...heights]);
    });
    previewRowHeightsRef.current = null;
    setPreviewRowHeights(null);
  }, []);

  const attachResizeListeners = useCallback(
    (pointerId: number, onMove: (event: PointerEvent) => void) => {
      activeResizeCleanupRef.current?.();

      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        finishActiveResize();
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);

      activeResizeCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
      };
    },
    [finishActiveResize],
  );

  const startColumnResize = useCallback(
    (colIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly || !onColumnWidthsChangeRef.current) return;
      event.preventDefault();
      event.stopPropagation();

      finishColumnResize();

      const startX = event.clientX;
      const startWidth = baseColumnWidthsRef.current[colIndex] ?? GRID_MIN_COL_WIDTH;
      let lastWidth = startWidth;

      const drag: ColumnResizeDrag = { axis: "column", index: colIndex };
      resizeDragRef.current = drag;
      setResizeDrag(drag);

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      parentRef.current?.style.setProperty("overflow", "hidden");

      const commitWidth = (clientX: number) => {
        const nextWidth = Math.min(
          GRID_MAX_COL_WIDTH,
          Math.max(GRID_MIN_COL_WIDTH, Math.round(startWidth + clientX - startX)),
        );
        if (nextWidth === lastWidth) return;
        lastWidth = nextWidth;

        const next = [...baseColumnWidthsRef.current];
        if (isFullSheetSelectedRef.current) {
          for (let index = 0; index < next.length; index += 1) {
            next[index] = nextWidth;
          }
        } else {
          next[colIndex] = nextWidth;
        }
        flushSync(() => {
          onColumnWidthsChangeRef.current?.(next);
        });
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        commitWidth(moveEvent.clientX);
      };

      const onMouseUp = () => {
        finishColumnResize();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      columnResizeCleanupRef.current = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
    },
    [finishColumnResize, readOnly],
  );

  const startRowResize = useCallback(
    (rowIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      event.stopPropagation();

      const pointerId = event.pointerId;
      const initial = [...(previewRowHeightsRef.current ?? baseRowHeightsRef.current)];
      const drag: RowResizeDrag = {
        axis: "row",
        index: rowIndex,
        startClient: event.clientY,
        startSize: initial[rowIndex],
        pointerId,
        initial,
      };

      try {
        document.body.setPointerCapture(pointerId);
      } catch {
        // Human: setPointerCapture can fail on unsupported platforms — window listeners still handle drag.
      }

      previewRowHeightsRef.current = initial;
      resizeDragRef.current = drag;
      setPreviewRowHeights(initial);
      setResizeDrag(drag);
      setDragPaintTick((tick) => tick + 1);

      attachResizeListeners(pointerId, (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();

        const activeDrag = resizeDragRef.current;
        if (!activeDrag || activeDrag.axis !== "row") return;

        const delta = moveEvent.clientY - activeDrag.startClient;
        const nextHeight = Math.max(
          GRID_MIN_ROW_HEIGHT,
          Math.round(activeDrag.startSize + delta),
        );
        const next = [...activeDrag.initial];
        if (isFullSheetSelectedRef.current) {
          for (let index = 0; index < next.length; index += 1) {
            next[index] = nextHeight;
          }
        } else {
          next[activeDrag.index] = nextHeight;
        }
        previewRowHeightsRef.current = next;
        setPreviewRowHeights(next);
        setDragPaintTick((tick) => tick + 1);
      });
    },
    [attachResizeListeners, readOnly],
  );

  const autoFitColumn = useCallback(
    (colIndex: number) => {
      if (readOnly) return;
      const next = [...baseColumnWidths];
      if (isFullSheetSelected) {
        for (let index = 0; index < columnCount; index += 1) {
          next[index] = autoFitColumnWidth(rows, index);
        }
      } else {
        next[colIndex] = autoFitColumnWidth(rows, colIndex);
      }
      commitColumnWidths(next);
    },
    [baseColumnWidths, columnCount, commitColumnWidths, isFullSheetSelected, readOnly, rows],
  );

  const autoFitRow = useCallback(
    (rowIndex: number) => {
      if (readOnly) return;
      const next = [...baseRowHeights];
      if (isFullSheetSelected) {
        for (let index = 0; index < rows.length; index += 1) {
          next[index] = autoFitRowHeight(rows, index, baseColumnWidths);
        }
      } else {
        next[rowIndex] = autoFitRowHeight(rows, rowIndex, baseColumnWidths);
      }
      commitRowHeights(next);
    },
    [baseColumnWidths, baseRowHeights, commitRowHeights, isFullSheetSelected, readOnly, rows],
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
        "relative min-h-0 flex-1 overflow-auto bg-[#F7F8FA] outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
        resizeDrag?.axis === "column" && "cursor-col-resize select-none",
        resizeDrag?.axis === "row" && "cursor-row-resize select-none",
      )}
    >
      <div
        style={{
          width: gridWidth,
          minWidth: "100%",
          transform: `scale(${zoomScale})`,
          transformOrigin: "top left",
        }}
      >
        {/* Human: Column header row — corner cell + A…N labels per Pencil AOdk5. */}
        <div
          className={cn("sticky top-0 z-20 flex border-b bg-[#F3F4F6]", borderClass)}
          style={{ height: GRID_HEADER_ROW_HEIGHT }}
        >
          <button
            type="button"
            aria-label="Select all cells"
            title="Select all"
            disabled={!onSelectAll}
            onClick={() => onSelectAll?.()}
            className={cn(
              "shrink-0 cursor-default border-r bg-[#E5E7EB] hover:bg-[#D1D5DB]",
              borderClass,
              isFullSheetSelected && "ring-2 ring-inset ring-[#2563EB]",
            )}
            style={{ width: GRID_ROW_INDEX_WIDTH, height: GRID_HEADER_ROW_HEIGHT }}
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
                  onMouseDown={(event) => startColumnResize(colIndex, event)}
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
              if (filterHiddenRows?.has(rowIndex) || hiddenRowSet.has(rowIndex)) return null;
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
                    if (!isCellVisible(rowIndex, colIndex)) return null;
                    const cell = row[colIndex] ?? { value: null, display: "" };
                    const selected = isCellInRange(rowIndex, colIndex, normalizedSelection);
                    const isActiveCell = editingCell?.row === rowIndex && editingCell.col === colIndex;
                    const cf = resolveConditionalFormat(conditionalFormats, rows, rowIndex, colIndex);
                    const cellFill = cf?.backgroundColor ?? cell.style?.backgroundColor;
                    const isPrecedent = precedentHighlight?.has(`${rowIndex}:${colIndex}`);
                    const isPrintEdge = printArea ? isPrintAreaEdge(rowIndex, colIndex, printArea) : false;

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
                          "relative flex shrink-0 overflow-hidden border-r border-b text-left transition-colors",
                          borderClass,
                          verticalAlignItemsClass(cell.style),
                          horizontalAlignJustifyClass(cell),
                          colIndex < frozenColCount && "sticky z-20 bg-white",
                          isHeader && !cellFill && "bg-[#FAFAFA]",
                          isTotalRow && !cellFill && "bg-[#EFF6FF]",
                          !isHeader && !isTotalRow && !cellFill && "bg-white",
                          selected && "z-10 border-2 border-[#2563EB] ring-1 ring-[#2563EB]",
                          selected && !cellFill && "bg-[#EFF6FF]",
                          isPrecedent && "ring-2 ring-amber-400 ring-inset",
                          isPrintEdge && "ring-2 ring-violet-500 ring-inset",
                        )}
                        style={{
                          width: columnWidths[colIndex],
                          height: rowHeight,
                          paddingInline: scaledPx(8),
                          backgroundColor: cellFill ?? undefined,
                          left: colIndex < frozenColCount ? colLeftOffsets[colIndex] : undefined,
                          ...cellBorderStyles(cell.style),
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
                        <CellCommentMarker comment={cell.comment} />
                        <CellContent
                          cell={cell}
                          row={rowIndex}
                          col={colIndex}
                          rows={rows}
                          conditionalFormats={conditionalFormats}
                          showFormulas={showFormulas}
                          headerRow={isHeader}
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
            if (filterHiddenRows?.has(rowIndex) || hiddenRowSet.has(rowIndex)) return null;
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
                  if (!isCellVisible(rowIndex, colIndex)) return null;
                  const cell = row[colIndex] ?? { value: null, display: "" };
                  const selected = isCellInRange(rowIndex, colIndex, normalizedSelection);
                  const isActiveCell =
                    editingCell?.row === rowIndex && editingCell.col === colIndex;
                  const cf = resolveConditionalFormat(conditionalFormats, rows, rowIndex, colIndex);
                  const cellFill = cf?.backgroundColor ?? cell.style?.backgroundColor;
                  const isPrecedent = precedentHighlight?.has(`${rowIndex}:${colIndex}`);
                  const isPrintEdge = printArea ? isPrintAreaEdge(rowIndex, colIndex, printArea) : false;

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
                        "relative flex shrink-0 overflow-hidden border-r border-b text-left transition-colors",
                        borderClass,
                        verticalAlignItemsClass(cell.style),
                        horizontalAlignJustifyClass(cell),
                        colIndex < frozenColCount && "sticky z-20 bg-white",
                        isHeader && !cellFill && "bg-[#FAFAFA]",
                        isTotalRow && !cellFill && "bg-[#EFF6FF]",
                        !isHeader && !isTotalRow && !cellFill && "bg-white",
                        selected && "z-10 border-2 border-[#2563EB] ring-1 ring-[#2563EB]",
                        selected && !cellFill && "bg-[#EFF6FF]",
                        isPrecedent && "ring-2 ring-amber-400 ring-inset",
                        isPrintEdge && "ring-2 ring-violet-500 ring-inset",
                      )}
                      style={{
                        width: columnWidths[colIndex],
                        height: rowHeight,
                        paddingInline: scaledPx(8),
                        backgroundColor: cellFill ?? undefined,
                        left: colIndex < frozenColCount ? colLeftOffsets[colIndex] : undefined,
                        ...cellBorderStyles(cell.style),
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
                      <CellCommentMarker comment={cell.comment} />
                      <CellContent
                        cell={cell}
                        row={rowIndex}
                        col={colIndex}
                        rows={rows}
                        conditionalFormats={conditionalFormats}
                        showFormulas={showFormulas}
                        headerRow={isHeader}
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Human: Ink strokes from Draw tab rendered above the grid. */}
      {/* Agent: READS drawings[]; RENDERS SVG polylines in grid coordinate space. */}
      {drawings && drawings.length > 0 ? (
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={gridWidth}
          height={rowVirtualizer.getTotalSize() + GRID_HEADER_ROW_HEIGHT}
          aria-hidden
        >
          {drawings.map((stroke) => (
            <polyline
              key={stroke.id}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
