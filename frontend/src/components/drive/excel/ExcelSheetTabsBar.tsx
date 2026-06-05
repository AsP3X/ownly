// Human: Sheet tab bar with navigation chevrons and add-sheet control per Pencil UeiM4.
// Agent: READS sheet names + active index; EMITS sheet selection callbacks.

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react";
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
    <div className="flex h-9 shrink-0 items-center gap-3 border-t border-[#E5E7EB] bg-[#F7F8FA] px-4">
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="First sheet" disabled={!canGoBack} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(0)}>
          <ChevronsLeft className="size-3.5" aria-hidden />
        </button>
        <button type="button" aria-label="Previous sheet" disabled={!canGoBack} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(activeIndex - 1)}>
          <ChevronLeft className="size-3.5" aria-hidden />
        </button>
        <button type="button" aria-label="Next sheet" disabled={!canGoForward} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(activeIndex + 1)}>
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
        <button type="button" aria-label="Last sheet" disabled={!canGoForward} className="rounded p-1.5 text-[#666666] disabled:opacity-40" onClick={() => onSelectSheet(sheets.length - 1)}>
          <ChevronsRight className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="h-5 w-px bg-[#E5E7EB]" aria-hidden />

      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {sheets.map((name, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${name}-${index}`}
              type="button"
              onClick={() => onSelectSheet(index)}
              className={cn(
                "shrink-0 rounded-t px-4 py-2 text-xs transition-colors",
                active
                  ? "border border-b-0 border-[#E5E7EB] bg-white font-semibold text-[#2563EB]"
                  : "font-normal text-[#666666] hover:text-[#1A1A1A]",
              )}
            >
              {name}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Add sheet"
        className="rounded-lg border border-[#E5E7EB] bg-white p-1.5 text-[#1A1A1A]"
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
