// Human: Command bar shown when one or more files are selected in the My files browser.
// Agent: RENDERS selection count + bulk download/favourite/delete/clear; CALLS parent handlers only.

import { Download, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BulkActionsBarProps = {
  selectedCount: number;
  /** Human: Files in the current folder listing that can be bulk-selected. */
  selectableCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  favouriteLabel: string;
  onDownload: () => void;
  onToggleFavourite: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
};

// Human: Bulk toolbar — compact floating pill on mobile, inline bar on desktop.
// Agent: DISABLES actions when selectedCount is 0; favouriteLabel reflects add vs remove intent.
export function BulkActionsBar({
  selectedCount,
  selectableCount,
  allSelected,
  onSelectAll,
  favouriteLabel,
  onDownload,
  onToggleFavourite,
  onDelete,
  onClearSelection,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  const showSelectAll = selectableCount > 0 && !allSelected;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-600 px-3 py-2 text-white shadow-lg",
        "max-lg:fixed max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-lg:left-3 max-lg:right-3 max-lg:z-30",
        "lg:static lg:border-blue-200 lg:bg-blue-50 lg:text-blue-900 lg:shadow-none",
      )}
      role="toolbar"
      aria-label="Bulk file actions"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-semibold lg:font-medium">
          {selectedCount} selected
        </span>
        {showSelectAll ? (
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold text-white/95 underline-offset-2 hover:bg-white/15 hover:underline lg:text-[13px] lg:text-blue-800 lg:hover:bg-blue-100 lg:hover:text-blue-900"
            onClick={onSelectAll}
            aria-label={`Select all ${selectableCount} files in this folder`}
            title="Select all (Ctrl+A)"
          >
            Select all
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 lg:gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 lg:border lg:border-blue-200 lg:bg-white lg:text-blue-800 lg:hover:bg-blue-100"
          onClick={onDownload}
          aria-label="Download selected"
        >
          <Download />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 lg:border lg:border-blue-200 lg:bg-white lg:text-blue-800 lg:hover:bg-blue-100"
          onClick={onToggleFavourite}
          aria-label={favouriteLabel}
        >
          <Star />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 lg:border lg:border-red-200 lg:bg-white lg:text-red-700 lg:hover:bg-red-50"
          onClick={onDelete}
          aria-label="Delete selected"
        >
          <Trash2 />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 lg:text-blue-800 lg:hover:bg-blue-100"
          onClick={onClearSelection}
          aria-label="Clear selection"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
