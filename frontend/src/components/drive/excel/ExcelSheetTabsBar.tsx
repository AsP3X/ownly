// Human: Sheet tab bar with navigation chevrons and add-sheet control per Pencil UeiM4.
// Agent: READS sheet names + active index; EMITS sheet selection callbacks.

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import { cn } from "@/lib/utils";

type ExcelSheetTabsBarProps = {
  sheets: string[];
  activeIndex: number;
  onSelectSheet: (index: number) => void;
};

export function ExcelSheetTabsBar({ sheets, activeIndex, onSelectSheet }: ExcelSheetTabsBarProps) {
  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex < sheets.length - 1;

  return (
    <div
      className="flex shrink-0 items-center border-t border-[#E5E7EB] bg-[#F7F8FA]"
      style={{ height: scaledPx(36), gap: scaledPx(12), paddingInline: scaledPx(16) }}
    >
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="First sheet" disabled={!canGoBack} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(0)}>
          <ChevronsLeft style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
        </button>
        <button type="button" aria-label="Previous sheet" disabled={!canGoBack} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(activeIndex - 1)}>
          <ChevronLeft style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
        </button>
        <button type="button" aria-label="Next sheet" disabled={!canGoForward} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(activeIndex + 1)}>
          <ChevronRight style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
        </button>
        <button type="button" aria-label="Last sheet" disabled={!canGoForward} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(sheets.length - 1)}>
          <ChevronsRight style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
        </button>
      </div>

      <div className="bg-[#E5E7EB]" style={{ height: scaledPx(20), width: 1 }} aria-hidden />

      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {sheets.map((name, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${name}-${index}`}
              type="button"
              onClick={() => onSelectSheet(index)}
              className={cn(
                "shrink-0 rounded-t transition-colors",
                active
                  ? "border border-b-0 border-[#E5E7EB] bg-white font-semibold text-[#2563EB]"
                  : "font-normal text-[#666666] hover:text-[#1A1A1A]",
              )}
              style={{
                fontSize: scaledPx(12),
                padding: `${scaledPx(8)}px ${scaledPx(16)}px`,
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Add sheet"
        className="rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A1A]"
        style={{ padding: scaledPx(6) }}
      >
        <Plus style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
      </button>
    </div>
  );
}
