// Human: Command bar shown when one or more files are selected in the My files browser.
// Agent: RENDERS selection count + bulk download/favourite/delete/clear; CALLS parent handlers only.

import { Download, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BulkActionsBarProps = {
  selectedCount: number;
  favouriteLabel: string;
  onDownload: () => void;
  onToggleFavourite: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
};

// Human: OneDrive-style bulk toolbar pinned above the file table while rows stay checked.
// Agent: DISABLES actions when selectedCount is 0; favouriteLabel reflects add vs remove intent.
export function BulkActionsBar({
  selectedCount,
  favouriteLabel,
  onDownload,
  onToggleFavourite,
  onDelete,
  onClearSelection,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 max-lg:fixed max-lg:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-lg:left-4 max-lg:right-4 max-lg:z-30 max-lg:shadow-lg lg:static"
      role="toolbar"
      aria-label="Bulk file actions"
    >
      <span className="text-sm font-medium text-blue-900">
        {selectedCount} selected
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
          onClick={onDownload}
        >
          <Download data-icon="inline-start" />
          Download
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
          onClick={onToggleFavourite}
        >
          <Star data-icon="inline-start" />
          {favouriteLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800",
          )}
          onClick={onDelete}
        >
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-blue-800 hover:bg-blue-100"
          onClick={onClearSelection}
          aria-label="Clear selection"
        >
          <X data-icon="inline-start" />
          Clear
        </Button>
      </div>
    </div>
  );
}
