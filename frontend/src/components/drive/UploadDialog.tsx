// Human: File picker modal — select files then hand off to the floating upload transfer panel.
// Agent: WRITES startUploadBatch; CHECKS upload conflicts; RESTORES recycle matches on Continue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
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
import { createClientId, formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type PendingFile = {
  id: string;
  file: File;
};

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  /** Human: Refresh drive listings after recycle-bin restores from the upload preflight. */
  onLibraryChanged?: () => void;
};

// Human: One selected file row — Pencil queue item with icon, name, size, and remove control.
// Agent: RENDERS bordered card row; CALLS onRemove with pending file id.
function PendingFileRow({
  name,
  sizeBytes,
  onRemove,
}: {
  name: string;
  sizeBytes: number;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-3.5 shrink-0 text-[#2563EB]" aria-hidden />
        <p className="truncate text-[13px] font-semibold text-[#1A1A1A]">{name}</p>
        <span className="shrink-0 text-[11px] text-[#666666]">{formatBytes(sizeBytes)}</span>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-[#888888] transition hover:bg-[#E5E7EB]/60 hover:text-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </button>
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

  const uploadDisabled = pendingFiles.length === 0 || checkingConflicts;

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
        id: createClientId(),
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

  const uploadButtonLabel =
    checkingConflicts
      ? "Checking…"
      : pendingFiles.length > 0
        ? `Upload (${pendingFiles.length})`
        : "Upload";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="bg-black/30 supports-backdrop-filter:backdrop-blur-[2px]"
        className={cn(
          "gap-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-0 shadow-[0_16px_32px_rgba(0,0,0,0.15)] ring-0 sm:max-w-[580px]",
          "[&_[data-slot=dialog-close]]:top-6 [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:size-8 [&_[data-slot=dialog-close]]:text-[#666666] hover:[&_[data-slot=dialog-close]]:bg-[#F7F8FA]",
        )}
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex min-w-0 flex-col gap-2 pr-8">
            <DialogTitle className="text-xl font-bold leading-tight text-[#1A1A1A]">
              Upload files
            </DialogTitle>
            <DialogDescription className="text-sm leading-snug text-[#666666]">
              Choose files to add to your library. Upload progress appears in the panel at the
              bottom-right so you can keep browsing.
            </DialogDescription>
          </div>

          <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => addPendingFiles(event.target.files)}
          />

          {activeUploadBatch ? (
            <p className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1E3A8A]">
              Uploads are running in the panel at the bottom-right. Files you add here join the
              same queue.
            </p>
          ) : null}

          {conflictCheckError ? (
            <p className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">
              {conflictCheckError}
            </p>
          ) : null}

          {pendingFiles.length === 0 ? (
            <button
              type="button"
              onClick={openFilePicker}
              className={cn(
                "flex w-full flex-col items-center gap-3 rounded-xl border border-[#E5E7EB] px-4 py-6 text-center transition",
                "hover:border-[#2563EB]/40 hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
              )}
            >
              <div className="flex size-11 items-center justify-center rounded-full bg-[#E0F2FE]">
                <Upload className="size-5 text-[#2563EB]" aria-hidden />
              </div>
              <span className="text-[15px] font-bold text-[#1A1A1A]">Browse files</span>
              <span className="text-[13px] text-[#888888]">Single or multiple files</span>
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex max-h-[9.375rem] flex-col gap-2 overflow-y-auto py-1">
                {pendingFiles.map((item) => (
                  <PendingFileRow
                    key={item.id}
                    name={item.file.name}
                    sizeBytes={item.file.size}
                    onRemove={() => removePendingFile(item.id)}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={openFilePicker}
                className="self-start text-[13px] font-semibold text-[#2563EB] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
              >
                Add more files
              </button>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-semibold text-[#1A1A1A] transition hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={uploadDisabled}
              className={cn(
                "rounded-lg px-5 py-2.5 text-sm font-bold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
                uploadDisabled
                  ? "cursor-not-allowed bg-[#2563EB]/40"
                  : "bg-[#2563EB] hover:bg-[#1D4ED8]",
              )}
              onClick={() => void handleStartUpload()}
            >
              {uploadButtonLabel}
            </button>
          </div>
        </div>
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
