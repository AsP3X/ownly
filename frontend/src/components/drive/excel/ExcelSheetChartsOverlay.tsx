// Human: Renders embedded charts on top of the spreadsheet grid like Excel chart objects.
// Agent: READS SheetChart[] + live cell data; DRAWS SVG via chart-render helpers.

import { useMemo } from "react";
import { chartSeriesFromChart } from "@/lib/spreadsheet/chart-data";
import { chartLayoutRect } from "@/lib/spreadsheet/chart-layout";
import { buildChartSvgModel, type ChartSvgElement } from "@/lib/spreadsheet/chart-render";
import type { SheetChart, SheetData } from "@/lib/spreadsheet/types";

type ExcelSheetChartsOverlayProps = {
  charts?: SheetChart[];
  sheet: Pick<SheetData, "rows" | "columnWidths" | "rowHeights">;
  columnWidths: number[];
  rowHeights: number[];
  gridWidth: number;
  gridHeight: number;
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
}: ExcelSheetChartsOverlayProps) {
  const renderedCharts = useMemo(() => {
    if (!charts?.length) return [];
    return charts.map((chart) => {
      const layout = chartLayoutRect(chart, columnWidths, rowHeights);
      const series = chartSeriesFromChart(sheet, chart);
      const model = buildChartSvgModel(chart.type, series, layout.width, layout.height, chart.title);
      return { chart, layout, model };
    });
  }, [charts, columnWidths, rowHeights, sheet]);

  if (renderedCharts.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={gridWidth}
      height={gridHeight}
      aria-hidden
    >
      {renderedCharts.map(({ chart, layout, model }) => (
        <g key={chart.id} transform={`translate(${layout.x}, ${layout.y})`}>
          {model.elements.map((element, index) => renderSvgElement(element, `${chart.id}-${index}`))}
        </g>
      ))}
    </svg>
  );
}
