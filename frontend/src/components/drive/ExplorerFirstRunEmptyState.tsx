// Human: Empty state for a library that has never held a file — says what to do, without a tour.
// Agent: RENDERED by DriveCloudExplorer when firstRun is true; replaces the generic empty-folder copy.

import { FolderPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

type ExplorerFirstRunEmptyStateProps = {
  onUpload: () => void;
  onCreateFolder: () => void;
};

export function ExplorerFirstRunEmptyState({
  onUpload,
  onCreateFolder,
}: ExplorerFirstRunEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-xl bg-sunken"
        aria-hidden
      >
        <Upload className="size-5 text-ink-faint" />
      </span>
      <p className="text-sm font-semibold text-ink">Your library is empty</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">
        Upload files or a whole folder to get started. You can also drag them onto this page, and
        share anything later with a link.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-edge bg-panel text-ink hover:bg-surface"
          onClick={onCreateFolder}
        >
          <FolderPlus className="size-4" aria-hidden />
          New Folder
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-2 bg-brand text-brand-on hover:bg-brand-hover"
          onClick={onUpload}
        >
          <Upload className="size-4" aria-hidden />
          Upload Files
        </Button>
      </div>
    </div>
  );
}
