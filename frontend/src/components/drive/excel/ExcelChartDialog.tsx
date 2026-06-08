// Human: Simple bar chart preview dialog for selected spreadsheet range.
// Agent: READS ChartBar[]; RENDERS SVG bars; NO external chart library.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChartBar } from "@/lib/spreadsheet/chart-data";

type ExcelChartDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  bars: ChartBar[];
};

export function ExcelChartDialog({ open, onOpenChange, title, bars }: ExcelChartDialogProps) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const width = 640;
  const height = 320;
  const padding = 48;
  const barWidth = bars.length > 0 ? (width - padding * 2) / bars.length - 8 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Bar chart from the current selection.</DialogDescription>
        </DialogHeader>

        {bars.length === 0 ? (
          <p className="text-sm text-[#666666]">Select a range with numeric values to chart.</p>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-lg border border-[#E5E7EB] bg-white">
            {bars.map((bar, index) => {
              const barHeight = ((height - padding * 2) * bar.value) / max;
              const x = padding + index * (barWidth + 8);
              const y = height - padding - barHeight;
              return (
                <g key={`${bar.label}-${index}`}>
                  <rect x={x} y={y} width={barWidth} height={barHeight} fill="#2563EB" rx={4} />
                  <text
                    x={x + barWidth / 2}
                    y={height - padding + 16}
                    textAnchor="middle"
                    className="fill-[#666666] text-[10px]"
                  >
                    {bar.label.length > 10 ? `${bar.label.slice(0, 9)}…` : bar.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </DialogContent>
    </Dialog>
  );
}
