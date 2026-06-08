// Human: Sheet tab bar with navigation chevrons and add/rename/delete/reorder sheet controls.
// Agent: READS sheet names + active index; EMITS sheet selection, CRUD, and drag-reorder callbacks.

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react";
import { useCallback, useState } from "react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import { cn } from "@/lib/utils";

type ExcelSheetTabsBarProps = {
  sheets: string[];
  activeIndex: number;
  readOnly?: boolean;
  onSelectSheet: (index: number) => void;
  onAddSheet?: () => void;
  onRenameSheet?: (index: number, name: string) => void;
  onDeleteSheet?: (index: number) => void;
  onMoveSheet?: (fromIndex: number, toIndex: number) => void;
};

export function ExcelSheetTabsBar({
  sheets,
  activeIndex,
  readOnly = false,
  onSelectSheet,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
  onMoveSheet,
}: ExcelSheetTabsBarProps) {
  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex < sheets.length - 1;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const canReorder = !readOnly && Boolean(onMoveSheet) && sheets.length > 1;

  const handleDrop = useCallback(
    (targetIndex: number) => {
      if (dragIndex === null || dragIndex === targetIndex || !onMoveSheet) return;
      onMoveSheet(dragIndex, targetIndex);
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, onMoveSheet],
  );

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
          const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <button
              key={`${name}-${index}`}
              type="button"
              draggable={canReorder}
              onClick={() => onSelectSheet(index)}
              onDoubleClick={() => {
                if (!onRenameSheet || readOnly) return;
                const nextName = window.prompt("Rename sheet", name);
                if (nextName) onRenameSheet(index, nextName);
              }}
              onContextMenu={(event) => {
                if (!onDeleteSheet || sheets.length <= 1 || readOnly) return;
                event.preventDefault();
                if (window.confirm(`Delete sheet "${name}"?`)) onDeleteSheet(index);
              }}
              onDragStart={(event) => {
                if (!canReorder) return;
                setDragIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => {
                if (!canReorder || dragIndex === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropIndex(index);
              }}
              onDragLeave={() => {
                if (dropIndex === index) setDropIndex(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              className={cn(
                "shrink-0 rounded-t transition-colors",
                active
                  ? "border border-b-0 border-[#E5E7EB] bg-white font-semibold text-[#2563EB]"
                  : "font-normal text-[#666666] hover:text-[#1A1A1A]",
                canReorder && dragIndex === index && "opacity-50",
                isDropTarget && "ring-2 ring-[#2563EB]",
              )}
              style={{
                fontSize: scaledPx(12),
                padding: `${scaledPx(8)}px ${scaledPx(16)}px`,
                cursor: canReorder ? "grab" : undefined,
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
        disabled={readOnly || !onAddSheet}
        className="rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A1A] disabled:opacity-40"
        style={{ padding: scaledPx(6) }}
        onClick={onAddSheet}
      >
        <Plus style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
      </button>
    </div>
  );
}
