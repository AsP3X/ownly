// Human: Insert Chart dialog — pick Excel chart type and preview from the current selection.
// Agent: READS ChartSeriesPoint[]; RENDERS SVG preview; EMITS onInsert with SheetChartType.

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildChartSvgModel } from "@/lib/spreadsheet/chart-render";
import type { ChartSeriesPoint } from "@/lib/spreadsheet/chart-data";
import type { SheetChartType } from "@/lib/spreadsheet/types";
import { cn } from "@/lib/utils";

type ExcelChartDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  series: ChartSeriesPoint[];
  onInsert: (type: SheetChartType) => void;
};

const CHART_TYPE_OPTIONS: Array<{ type: SheetChartType; label: string }> = [
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
  { type: "pie", label: "Pie" },
  { type: "doughnut", label: "Doughnut" },
];

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 320;

export function ExcelChartDialog({
  open,
  onOpenChange,
  title,
  series,
  onInsert,
}: ExcelChartDialogProps) {
  const [selectedType, setSelectedType] = useState<SheetChartType>("column");

  const previewModel = useMemo(
    () => buildChartSvgModel(selectedType, series, PREVIEW_WIDTH, PREVIEW_HEIGHT, title),
    [selectedType, series, title],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Insert chart</DialogTitle>
          <DialogDescription>
            Choose a chart type for the selected range. Charts appear on the sheet and round-trip to Excel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {CHART_TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                selectedType === option.type
                  ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                  : "border-[#E5E7EB] bg-white text-[#333333] hover:bg-[#F9FAFB]",
              )}
              onClick={() => setSelectedType(option.type)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {series.length === 0 ? (
          <p className="text-sm text-[#666666]">Select a range with numeric values to chart.</p>
        ) : (
          <svg viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`} className="w-full rounded-lg border border-[#E5E7EB] bg-white">
            {previewModel.elements.map((element, index) => {
              if (element.kind === "rect") {
                return (
                  <rect
                    key={index}
                    x={element.x}
                    y={element.y}
                    width={element.width}
                    height={element.height}
                    fill={element.fill}
                    rx={element.rx}
                    stroke={element.fill === "none" ? "#E5E7EB" : undefined}
                  />
                );
              }
              if (element.kind === "polyline") {
                return (
                  <polyline
                    key={index}
                    points={element.points}
                    fill={element.fill ?? "none"}
                    stroke={element.stroke}
                    strokeWidth={element.strokeWidth}
                  />
                );
              }
              if (element.kind === "path") {
                return <path key={index} d={element.d} fill={element.fill} />;
              }
              if (element.kind === "text") {
                return (
                  <text
                    key={index}
                    x={element.x}
                    y={element.y}
                    fill={element.fill}
                    fontSize={element.fontSize}
                    textAnchor={element.anchor ?? "start"}
                  >
                    {element.text}
                  </text>
                );
              }
              return null;
            })}
          </svg>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={series.length === 0}
            onClick={() => {
              onInsert(selectedType);
              onOpenChange(false);
            }}
          >
            Insert chart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
