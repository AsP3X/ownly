// Human: Warn before uploading when files duplicate the library or match the recycle bin exactly.
// Agent: READS duplicate + recycle match rows; CALLS onContinue, onUploadAnyway, or onCancel.

import { AlertTriangle, RotateCcw } from "lucide-react";
import type { UploadNameDuplicate, UploadRecycleMatch } from "@/api/client";
import { formatBytes } from "@/lib/utils-app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type UploadConflictDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicates: UploadNameDuplicate[];
  recycleMatches: UploadRecycleMatch[];
  continueLabel: string;
  continueDisabled?: boolean;
  continuing?: boolean;
  onContinue: () => void;
  onUploadAnyway: () => void;
  onCancel: () => void;
};

// Human: Render where an existing library file lives for the duplicate warning list.
// Agent: READS folder_name; RETURNS "My files" when folder_id is null.
function existingFileLocation(folderName: string | null) {
  return folderName?.trim() ? folderName : "My files";
}

// Human: Build a dialog title from recycle-bin and active-library conflict counts.
// Agent: READS duplicate + recycle match lengths; RETURNS user-facing title string.
function conflictDialogTitle(duplicateCount: number, recycleCount: number) {
  if (duplicateCount > 0 && recycleCount > 0) {
    return "Review upload conflicts";
  }
  if (recycleCount > 0) {
    return recycleCount === 1
      ? "Restore from recycle bin?"
      : "Restore files from recycle bin?";
  }
  return duplicateCount === 1 ? "File already in your library" : "Files already in your library";
}

// Human: Build dialog body copy for recycle restore, library duplicates, or both.
// Agent: READS conflict counts; RETURNS short guidance for footer actions.
function conflictDialogDescription(duplicateCount: number, recycleCount: number) {
  if (duplicateCount > 0 && recycleCount > 0) {
    return "Some files match items in your recycle bin and others already exist in your library. Continue restores exact recycle-bin matches, skips library duplicates, and uploads the rest.";
  }
  if (recycleCount > 0) {
    return recycleCount === 1
      ? "This file exactly matches an item in your recycle bin. Continue restores it to its original location instead of uploading again."
      : "These files exactly match items in your recycle bin. Continue restores them to their original locations instead of uploading again.";
  }
  return duplicateCount === 1
    ? "This file has the same content as something already in your library. Continue skips it, or upload everything anyway."
    : "These files have the same content as items already in your library. Continue skips the duplicates, or upload everything anyway.";
}

// Human: Confirmation modal for recycle-bin restores and/or active-library duplicate content.
// Agent: LISTS both conflict types; WRITES onContinue, onUploadAnyway, or onCancel from footer.
export function UploadConflictDialog({
  open,
  onOpenChange,
  duplicates,
  recycleMatches,
  continueLabel,
  continueDisabled = false,
  continuing = false,
  onContinue,
  onUploadAnyway,
  onCancel,
}: UploadConflictDialogProps) {
  const duplicateCount = duplicates.length;
  const recycleCount = recycleMatches.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[min(32rem,calc(100%-2rem))] gap-0 overflow-hidden border-edge bg-panel p-0 sm:max-w-lg">
        <DialogHeader className="min-w-0 border-b border-hairline px-5 py-4 pr-12">
          <DialogTitle className="truncate text-base font-semibold text-ink">
            {conflictDialogTitle(duplicateCount, recycleCount)}
          </DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            {conflictDialogDescription(duplicateCount, recycleCount)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
          {recycleCount > 0 ? (
            <>
              <Alert className="border-brand/40 bg-brand-weak text-brand-hover">
                <RotateCcw className="size-4 text-brand" aria-hidden />
                <AlertDescription className="text-sm text-brand-hover">
                  Exact matches (same name and size) in the recycle bin can be restored instead of
                  re-uploaded.
                </AlertDescription>
              </Alert>

              <ul className="max-h-48 divide-y divide-hairline overflow-y-auto rounded-lg border border-edge">
                {recycleMatches.map((entry) => (
                  <li key={`${entry.upload_name}-${entry.upload_size_bytes}`} className="px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-ink">
                      {entry.upload_name}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Matches recycle-bin item from{" "}
                      <span className="font-medium text-ink">
                        {existingFileLocation(entry.trashed.folder_name)}
                      </span>
                      <span className="ml-2 tabular-nums text-ink-muted">
                        {formatBytes(entry.trashed.size_bytes)}
                      </span>
                    </p>
                    {entry.trashed.can_restore ? (
                      <p className="mt-1 text-xs text-brand">
                        Will be restored to its original location on Continue.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-warn">
                        Original folder unavailable — will upload instead on Continue.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {duplicateCount > 0 ? (
            <>
              <Alert className="border-warn/40 bg-warn-weak text-warn">
                <AlertTriangle className="size-4 text-warn" aria-hidden />
                <AlertDescription className="text-sm text-warn">
                  Active-library duplicate checks compare file content across your entire library,
                  not just the current folder.
                </AlertDescription>
              </Alert>

              <ul className="max-h-48 divide-y divide-hairline overflow-y-auto rounded-lg border border-edge">
                {duplicates.map((entry) => (
                  <li key={entry.upload_content_hash} className="px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-ink">
                      {entry.upload_name}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {entry.existing.map((match) => (
                        <li
                          key={match.id}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted"
                        >
                          <span>
                            Already in{" "}
                            <span className="font-medium text-ink">
                              {existingFileLocation(match.folder_name)}
                            </span>
                          </span>
                          <span className="tabular-nums text-ink-muted">
                            {formatBytes(match.size_bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <DialogFooter className="min-w-0 w-full shrink-0 flex-row flex-wrap justify-end gap-2 border-t border-hairline bg-surface/80 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel upload
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-brand text-brand-on hover:bg-brand-hover"
            disabled={continueDisabled || continuing}
            onClick={onContinue}
          >
            {continuing ? "Working…" : continueLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-warn/40 text-warn hover:bg-warn-weak"
            onClick={onUploadAnyway}
            disabled={continuing}
          >
            Upload all anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
