// Human: Pure SVG chart rendering for embedded spreadsheet charts (no chart library).
// Agent: READS ChartSeriesPoint[] + SheetChartType; RETURNS SVG element descriptors.

import type { ChartSeriesPoint } from "@/lib/spreadsheet/chart-data";
import type { SheetChartType } from "@/lib/spreadsheet/types";

const CHART_COLORS = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478", "#9E480E"];

export type ChartSvgElement =
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill: string; rx?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number }
  | { kind: "polyline"; points: string; stroke: string; strokeWidth: number; fill?: string }
  | { kind: "path"; d: string; fill: string; stroke?: string }
  | { kind: "text"; x: number; y: number; text: string; fill: string; fontSize: number; anchor?: "middle" | "start" };

export type ChartSvgModel = {
  width: number;
  height: number;
  title?: string;
  elements: ChartSvgElement[];
};

const PADDING = 40;

function truncateLabel(label: string, max = 10): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// Human: Build SVG primitives for one chart type from resolved series points.
// Agent: CALLED by ExcelSheetChartsOverlay; HANDLES empty series with placeholder text.
export function buildChartSvgModel(
  type: SheetChartType,
  series: ChartSeriesPoint[],
  width: number,
  height: number,
  title?: string,
): ChartSvgModel {
  const elements: ChartSvgElement[] = [];
  const plotLeft = PADDING;
  const plotTop = title ? PADDING + 16 : PADDING;
  const plotRight = width - PADDING;
  const plotBottom = height - PADDING;
  const plotWidth = Math.max(plotRight - plotLeft, 1);
  const plotHeight = Math.max(plotBottom - plotTop, 1);

  elements.push({
    kind: "rect",
    x: 0,
    y: 0,
    width,
    height,
    fill: "#FFFFFF",
    rx: 4,
  });
  elements.push({
    kind: "rect",
    x: 0.5,
    y: 0.5,
    width: width - 1,
    height: height - 1,
    fill: "none",
    rx: 4,
  });

  if (title) {
    elements.push({
      kind: "text",
      x: width / 2,
      y: 18,
      text: title,
      fill: "#1A1A1A",
      fontSize: 12,
      anchor: "middle",
    });
  }

  if (series.length === 0) {
    elements.push({
      kind: "text",
      x: width / 2,
      y: height / 2,
      text: "No chart data",
      fill: "#666666",
      fontSize: 11,
      anchor: "middle",
    });
    return { width, height, title, elements };
  }

  const maxValue = Math.max(...series.map((point) => point.value), 1);

  if (type === "pie" || type === "doughnut") {
    const cx = plotLeft + plotWidth / 2;
    const cy = plotTop + plotHeight / 2;
    const outerR = Math.min(plotWidth, plotHeight) / 2 - 8;
    const innerR = type === "doughnut" ? outerR * 0.55 : 0;
    const total = series.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
    let angle = -Math.PI / 2;

    series.forEach((point, index) => {
      const slice = (Math.max(point.value, 0) / total) * Math.PI * 2;
      const endAngle = angle + slice;
      const color = CHART_COLORS[index % CHART_COLORS.length];
      const x1 = cx + outerR * Math.cos(angle);
      const y1 = cy + outerR * Math.sin(angle);
      const x2 = cx + outerR * Math.cos(endAngle);
      const y2 = cy + outerR * Math.sin(endAngle);
      const largeArc = slice > Math.PI ? 1 : 0;

      if (innerR > 0) {
        const ix1 = cx + innerR * Math.cos(endAngle);
        const iy1 = cy + innerR * Math.sin(endAngle);
        const ix2 = cx + innerR * Math.cos(angle);
        const iy2 = cy + innerR * Math.sin(angle);
        elements.push({
          kind: "path",
          d: `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`,
          fill: color,
        });
      } else {
        elements.push({
          kind: "path",
          d: `M ${cx} ${cy} L ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} Z`,
          fill: color,
        });
      }
      angle = endAngle;
    });
    return { width, height, title, elements };
  }

  if (type === "line" || type === "area" || type === "scatter") {
    const pointCoords = series.map((point, index) => {
      const x =
        plotLeft +
        (series.length <= 1 ? plotWidth / 2 : (index / Math.max(series.length - 1, 1)) * plotWidth);
      const y = plotBottom - (point.value / maxValue) * plotHeight;
      return { x, y, label: point.label };
    });

    if (type === "area") {
      const areaPoints = [
        `${plotLeft},${plotBottom}`,
        ...pointCoords.map((coord) => `${coord.x},${coord.y}`),
        `${pointCoords[pointCoords.length - 1]?.x ?? plotLeft},${plotBottom}`,
      ].join(" ");
      elements.push({
        kind: "polyline",
        points: areaPoints,
        stroke: "none",
        strokeWidth: 0,
        fill: "rgba(68, 114, 196, 0.25)",
      });
    }

    const linePoints = pointCoords.map((coord) => `${coord.x},${coord.y}`).join(" ");
    elements.push({
      kind: "polyline",
      points: linePoints,
      stroke: CHART_COLORS[0],
      strokeWidth: type === "scatter" ? 0 : 2,
      fill: "none",
    });

    pointCoords.forEach((coord) => {
      elements.push({
        kind: "rect",
        x: coord.x - 3,
        y: coord.y - 3,
        width: 6,
        height: 6,
        fill: CHART_COLORS[0],
        rx: 3,
      });
    });

    pointCoords.forEach((coord, index) => {
      if (index % Math.ceil(series.length / 6) !== 0 && index !== series.length - 1) return;
      elements.push({
        kind: "text",
        x: coord.x,
        y: plotBottom + 14,
        text: truncateLabel(coord.label),
        fill: "#666666",
        fontSize: 9,
        anchor: "middle",
      });
    });

    return { width, height, title, elements };
  }

  const isHorizontal = type === "bar";
  const barGap = 6;
  const barCount = series.length;

  if (isHorizontal) {
    const barHeight = (plotHeight - barGap * (barCount + 1)) / barCount;
    series.forEach((point, index) => {
      const barWidth = (point.value / maxValue) * plotWidth;
      const y = plotTop + barGap + index * (barHeight + barGap);
      elements.push({
        kind: "rect",
        x: plotLeft,
        y,
        width: barWidth,
        height: barHeight,
        fill: CHART_COLORS[index % CHART_COLORS.length],
        rx: 3,
      });
      elements.push({
        kind: "text",
        x: plotLeft - 6,
        y: y + barHeight / 2 + 4,
        text: truncateLabel(point.label, 8),
        fill: "#666666",
        fontSize: 9,
        anchor: "start",
      });
    });
  } else {
    const barWidth = (plotWidth - barGap * (barCount + 1)) / barCount;
    series.forEach((point, index) => {
      const barHeight = (point.value / maxValue) * plotHeight;
      const x = plotLeft + barGap + index * (barWidth + barGap);
      const y = plotBottom - barHeight;
      elements.push({
        kind: "rect",
        x,
        y,
        width: barWidth,
        height: barHeight,
        fill: CHART_COLORS[index % CHART_COLORS.length],
        rx: 3,
      });
      elements.push({
        kind: "text",
        x: x + barWidth / 2,
        y: plotBottom + 14,
        text: truncateLabel(point.label),
        fill: "#666666",
        fontSize: 9,
        anchor: "middle",
      });
    });
  }

  return { width, height, title, elements };
}
