// Human: Renders draggable embedded charts on top of the spreadsheet grid.
// Agent: READS SheetChart[]; EMITS anchor updates; DRAWS SVG via chart-render helpers.

import { useCallback, useMemo, useRef, useState } from "react";
import { chartSeriesFromChart } from "@/lib/spreadsheet/chart-data";
import { chartAnchorFromPixelRect, chartLayoutRect, type ChartAnchorPatch } from "@/lib/spreadsheet/chart-layout";
import { buildChartSvgModel, type ChartSvgElement } from "@/lib/spreadsheet/chart-render";
import type { SheetChart, SheetData } from "@/lib/spreadsheet/types";

type ExcelSheetChartsOverlayProps = {
  charts?: SheetChart[];
  sheet: Pick<SheetData, "rows" | "columnWidths" | "rowHeights">;
  columnWidths: number[];
  rowHeights: number[];
  gridWidth: number;
  gridHeight: number;
  readOnly?: boolean;
  onChartAnchorChange?: (chartId: string, anchor: ChartAnchorPatch) => void;
};

type ChartDragState = {
  chartId: string;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
};

function renderSvgElement(element: ChartSvgElement, key: string) {
  switch (element.kind) {
    case "rect":
      return (
        <rect
          key={key}
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill={element.fill}
          rx={element.rx}
          stroke={element.fill === "none" ? "#E5E7EB" : undefined}
        />
      );
    case "line":
      return (
        <line
          key={key}
          x1={element.x1}
          y1={element.y1}
          x2={element.x2}
          y2={element.y2}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      );
    case "polyline":
      return (
        <polyline
          key={key}
          points={element.points}
          fill={element.fill ?? "none"}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      );
    case "path":
      return (
        <path
          key={key}
          d={element.d}
          fill={element.fill}
          stroke={element.stroke}
        />
      );
    case "text":
      return (
        <text
          key={key}
          x={element.x}
          y={element.y}
          fill={element.fill}
          fontSize={element.fontSize}
          textAnchor={element.anchor ?? "start"}
        >
          {element.text}
        </text>
      );
    default:
      return null;
  }
}

export function ExcelSheetChartsOverlay({
  charts,
  sheet,
  columnWidths,
  rowHeights,
  gridWidth,
  gridHeight,
  readOnly = false,
  onChartAnchorChange,
}: ExcelSheetChartsOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragState, setDragState] = useState<ChartDragState | null>(null);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });

  const renderedCharts = useMemo(() => {
    if (!charts?.length) return [];
    return charts.map((chart) => {
      const layout = chartLayoutRect(chart, columnWidths, rowHeights);
      const series = chartSeriesFromChart(sheet, chart);
      const model = buildChartSvgModel(chart.type, series, layout.width, layout.height, chart.title);
      return { chart, layout, model };
    });
  }, [charts, columnWidths, rowHeights, sheet]);

  const finishDrag = useCallback(
    (state: ChartDragState, deltaX: number, deltaY: number) => {
      const entry = renderedCharts.find((item) => item.chart.id === state.chartId);
      if (!entry || !onChartAnchorChange) return;
      const anchor = chartAnchorFromPixelRect(
        state.originX + deltaX,
        state.originY + deltaY,
        entry.layout.width,
        entry.layout.height,
        columnWidths,
        rowHeights,
      );
      onChartAnchorChange(state.chartId, anchor);
    },
    [columnWidths, onChartAnchorChange, renderedCharts, rowHeights],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!dragState) return;
      setDragDelta({
        x: event.clientX - dragState.startClientX,
        y: event.clientY - dragState.startClientY,
      });
    },
    [dragState],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!dragState) return;
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;
      finishDrag(dragState, deltaX, deltaY);
      setDragState(null);
      setDragDelta({ x: 0, y: 0 });
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [dragState, finishDrag],
  );

  const handleChartPointerDown = useCallback(
    (event: React.PointerEvent<SVGGElement>, chartId: string, originX: number, originY: number) => {
      if (readOnly || !onChartAnchorChange) return;
      event.preventDefault();
      event.stopPropagation();
      setDragState({
        chartId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX,
        originY,
      });
      setDragDelta({ x: 0, y: 0 });
      svgRef.current?.setPointerCapture(event.pointerId);
    },
    [onChartAnchorChange, readOnly],
  );

  if (renderedCharts.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      className="absolute left-0 top-0 touch-none"
      width={gridWidth}
      height={gridHeight}
      aria-hidden={readOnly}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {renderedCharts.map(({ chart, layout, model }) => {
        const isDragging = dragState?.chartId === chart.id;
        const translateX = layout.x + (isDragging ? dragDelta.x : 0);
        const translateY = layout.y + (isDragging ? dragDelta.y : 0);
        return (
          <g
            key={chart.id}
            transform={`translate(${translateX}, ${translateY})`}
            style={{ pointerEvents: readOnly ? "none" : "auto", cursor: readOnly ? undefined : "move" }}
            onPointerDown={(event) => handleChartPointerDown(event, chart.id, layout.x, layout.y)}
          >
            {/* Human: Transparent hit target so the full chart area is draggable. */}
            {/* Agent: CAPTURES pointer before grid cell selection underneath. */}
            <rect
              x={0}
              y={0}
              width={layout.width}
              height={layout.height}
              fill="transparent"
              stroke={isDragging ? "#2563EB" : "#CBD5E1"}
              strokeWidth={isDragging ? 2 : 1}
              rx={4}
            />
            {model.elements.map((element, index) => renderSvgElement(element, `${chart.id}-${index}`))}
          </g>
        );
      })}
    </svg>
  );
}
