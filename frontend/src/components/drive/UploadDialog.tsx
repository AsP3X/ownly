// Human: File picker modal — select files then hand off to the floating upload transfer panel.
// Agent: WRITES startUploadBatch; CHECKS upload conflicts; RESTORES recycle matches on Continue.

import { useCallback, useEffect, useMemo, useRef, useState, Children, type ReactNode } from "react";
import { FileIcon, Upload, X } from "lucide-react";
import {
  QUEUE_BOX_HEIGHT,
  QUEUE_ROW_HEIGHT,
} from "@/components/drive/upload-batch-view";
import { UploadConflictDialog } from "@/components/drive/UploadDuplicateDialog";
import {
  checkUploadNameDuplicates,
  getErrorMessage,
  restoreRecycleBinItems,
  type UploadNameDuplicate,
  type UploadRecycleMatch,
} from "@/api/client";
import {
  buildSmartContinueLabel,
  buildUploadConflictPlan,
} from "@/lib/upload-conflicts";
import { startUploadBatch, subscribeUploadBatch } from "@/lib/upload-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PendingFile = {
  id: string;
  file: File;
};

function createQueueItemId() {
  return crypto.randomUUID();
}

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  /** Human: Refresh drive listings after recycle-bin restores from the upload preflight. */
  onLibraryChanged?: () => void;
};

// Human: Bordered scroll list for files awaiting upload confirmation in the picker dialog.
function PendingFileListBox({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const hasItems = Children.count(children) > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 bg-[#faf9f8] px-3 py-2">
        <p className="text-xs font-medium text-neutral-600">{title}</p>
      </div>
      <ul
        className="divide-y divide-neutral-100 overflow-y-auto overflow-x-hidden"
        style={{ minHeight: QUEUE_BOX_HEIGHT, maxHeight: QUEUE_BOX_HEIGHT }}
      >
        {hasItems ? (
          children
        ) : (
          <li
            className="flex items-center justify-center px-3 text-sm text-neutral-500"
            style={{ minHeight: QUEUE_BOX_HEIGHT }}
          >
            No files selected yet.
          </li>
        )}
      </ul>
    </div>
  );
}

// Human: Modal to pick files — uploads run in UploadTransferPanel after conflict resolution.
// Agent: CALLS checkUploadNameDuplicates; SHOWS UploadConflictDialog; RESTORES recycle matches.
export function UploadDialog({
  open,
  onOpenChange,
  folderId = null,
  onLibraryChanged,
}: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [activeUploadBatch, setActiveUploadBatch] = useState(false);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<UploadNameDuplicate[]>([]);
  const [recycleMatches, setRecycleMatches] = useState<UploadRecycleMatch[]>([]);
  const [conflictCheckError, setConflictCheckError] = useState("");
  const [resolvingConflicts, setResolvingConflicts] = useState(false);

  const continueLabel = useMemo(
    () => buildSmartContinueLabel(pendingFiles, duplicateMatches, recycleMatches),
    [pendingFiles, duplicateMatches, recycleMatches],
  );

  const continueDisabled = useMemo(() => {
    const plan = buildUploadConflictPlan(pendingFiles, duplicateMatches, recycleMatches, {
      skipDuplicates: true,
      restoreRecycle: true,
    });
    return plan.restoreCount === 0 && plan.uploadCount === 0;
  }, [pendingFiles, duplicateMatches, recycleMatches]);

  // Human: Hint when reopening the picker while the corner panel still has work in flight.
  // Agent: SUBSCRIBES upload-manager while open; WRITES activeUploadBatch from batch status.
  useEffect(() => {
    if (!open) return;
    return subscribeUploadBatch((batch) => {
      setActiveUploadBatch(batch?.status === "uploading");
    });
  }, [open]);

  const addPendingFiles = useCallback((selected: FileList | null) => {
    if (!selected?.length) return;
    setPendingFiles((prev) => {
      const incoming = Array.from(selected).map((file) => ({
        id: createQueueItemId(),
        file,
      }));
      return [...prev, ...incoming];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function removePendingFile(id: string) {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function resetConflictState() {
    setConflictCheckError("");
    setDuplicateMatches([]);
    setRecycleMatches([]);
    setConflictDialogOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setPendingFiles([]);
      resetConflictState();
    }
    onOpenChange(next);
  }

  // Human: Queue files in upload-manager and close the picker after conflict resolution.
  // Agent: CALLS startUploadBatch when files remain; CLEARS pending state; CLOSES dialogs.
  function beginUpload(files: File[]) {
    resetConflictState();
    setPendingFiles([]);
    onOpenChange(false);
    if (files.length > 0) {
      startUploadBatch(files, folderId);
    }
  }

  // Human: Restore recycle-bin rows and upload the remaining pending files per user choice.
  // Agent: POST restoreRecycleBinItems; CALLS beginUpload; WRITES onLibraryChanged after restore.
  async function executeUploadPlan(options: {
    skipDuplicates: boolean;
    restoreRecycle: boolean;
  }) {
    const plan = buildUploadConflictPlan(
      pendingFiles,
      duplicateMatches,
      recycleMatches,
      options,
    );

    setResolvingConflicts(true);
    setConflictCheckError("");
    try {
      if (options.restoreRecycle && plan.restoreFileIds.length > 0) {
        await restoreRecycleBinItems({
          file_ids: plan.restoreFileIds,
          folder_ids: [],
        });
        onLibraryChanged?.();
      }
      beginUpload(plan.uploadFiles);
    } catch (error) {
      setConflictCheckError(getErrorMessage(error));
      setConflictDialogOpen(false);
    } finally {
      setResolvingConflicts(false);
    }
  }

  // Human: Run library-wide duplicate and recycle-bin checks before queueing uploads.
  // Agent: POST checkUploadNameDuplicates; OPENS UploadConflictDialog when any matches exist.
  async function handleStartUpload() {
    if (pendingFiles.length === 0 || checkingConflicts) return;

    setConflictCheckError("");
    setCheckingConflicts(true);
    try {
      const files = pendingFiles.map((item) => ({
        name: item.file.name,
        // Human: Force an integer byte size so JSON always includes size_bytes for the API contract.
        // Agent: AVOIDS omitted/NaN sizes that trigger Axum JSON 422 on check-upload-names.
        size_bytes: Math.max(0, Math.floor(Number(item.file.size) || 0)),
      }));
      const { duplicates, recycle_matches } = await checkUploadNameDuplicates(files);
      if (duplicates.length > 0 || recycle_matches.length > 0) {
        setDuplicateMatches(duplicates);
        setRecycleMatches(recycle_matches);
        setConflictDialogOpen(true);
        return;
      }
      beginUpload(pendingFiles.map((item) => item.file));
    } catch (error) {
      setConflictCheckError(getErrorMessage(error));
    } finally {
      setCheckingConflicts(false);
    }
  }

  function handleSmartContinue() {
    void executeUploadPlan({ skipDuplicates: true, restoreRecycle: true });
  }

  function handleUploadAnyway() {
    void executeUploadPlan({ skipDuplicates: false, restoreRecycle: false });
  }

  function handleCancelConflictDialog() {
    setConflictDialogOpen(false);
    resetConflictState();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-full max-w-[min(32rem,calc(100%-2rem))] gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-lg">
        <DialogHeader className="min-w-0 border-b border-neutral-100 px-5 py-4 pr-12">
          <DialogTitle className="truncate text-base font-semibold text-neutral-900">
            Upload files
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-500">
            Choose files to add to your library. Upload progress appears in the panel at the
            bottom-right so you can keep browsing.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => addPendingFiles(event.target.files)}
        />

        <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
          {activeUploadBatch ? (
            <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Uploads are running in the panel at the bottom-right. Files you add here join the
              same queue.
            </p>
          ) : null}

          {conflictCheckError ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
              {conflictCheckError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={openFilePicker}
            className={cn(
              "flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-[#faf9f8] px-4 py-5 text-center transition",
              "hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
            )}
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-blue-100">
              <Upload className="size-4 text-blue-600" aria-hidden />
            </div>
            <span className="text-sm font-medium text-neutral-900">Browse files</span>
            <span className="text-xs text-neutral-500">Single or multiple files</span>
          </button>

          {pendingFiles.length > 0 ? (
            <PendingFileListBox title={`Selected · ${pendingFiles.length}`}>
              {pendingFiles.map((item) => (
                <li
                  key={item.id}
                  className="flex h-[var(--upload-queue-row-height)] min-h-[var(--upload-queue-row-height)] items-center gap-2.5 px-3"
                  style={{ ["--upload-queue-row-height" as string]: QUEUE_ROW_HEIGHT }}
                >
                  <FileIcon className="size-3.5 shrink-0 text-blue-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-900">{item.file.name}</p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                    {formatBytes(item.file.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0 text-neutral-400 hover:text-red-600"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removePendingFile(item.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </PendingFileListBox>
          ) : null}
        </div>

        <DialogFooter className="min-w-0 w-full shrink-0 flex-row justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={pendingFiles.length === 0 || checkingConflicts}
            onClick={() => void handleStartUpload()}
          >
            {checkingConflicts
              ? "Checking…"
              : `Upload ${pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <UploadConflictDialog
        open={conflictDialogOpen}
        onOpenChange={setConflictDialogOpen}
        duplicates={duplicateMatches}
        recycleMatches={recycleMatches}
        continueLabel={continueLabel}
        continueDisabled={continueDisabled}
        continuing={resolvingConflicts}
        onContinue={handleSmartContinue}
        onUploadAnyway={handleUploadAnyway}
        onCancel={handleCancelConflictDialog}
      />
    </Dialog>
  );
}
