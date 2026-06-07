// Human: File picker modal — select files or an entire folder, then hand off to the upload transfer panel.
// Agent: WRITES startUploadBatch; CHECKS upload conflicts; CREATES folder tree for directory picks.

import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { FileText, FolderUp, Upload, X } from "lucide-react";
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
import { buildUploadCheckCandidates } from "@/lib/file-content-hash";
import {
  ensureFolderUploadStructure,
  folderUploadDisplayPath,
  getFileRelativePath,
  isFolderUploadSelection,
  parseFolderUploadSelection,
} from "@/lib/upload-folder-structure";
import { startUploadBatch, subscribeUploadBatch, type UploadBatchEntry } from "@/lib/upload-manager";
import { applyStorageWarningsInOrder } from "@/lib/upload-storage-capacity";
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
  /** Human: SHA-256 digest computed before duplicate preflight. */
  contentHash?: string;
  /** Human: Set when the file exceeds remaining library quota — row stays selectable with a warning. */
  storageWarning?: string | null;
};

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  /** Human: Remaining upload bytes from GET /dashboard (quota ∩ network). */
  effectiveRemainingBytes?: number;
  /** Human: Refresh storage snapshot when the dialog opens or Upload is pressed. */
  onRefreshStorageLimits?: () => Promise<number>;
  /** Human: Refresh drive listings after recycle-bin restores from the upload preflight. */
  onLibraryChanged?: () => void;
};

// Human: One selected file row — icon, truncating name, fixed-size column, and remove control.
// Agent: min-w-0 flex-1 on name prevents long filenames from pushing size/buttons off-screen.
function PendingFileRow({
  name,
  sizeBytes,
  storageWarning,
  onRemove,
}: {
  name: string;
  sizeBytes: number;
  storageWarning?: string | null;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5",
        storageWarning
          ? "border-amber-200 bg-amber-50/80"
          : "border-[#E5E7EB] bg-[#F7F8FA]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileText
          className={cn("size-3.5 shrink-0", storageWarning ? "text-amber-700" : "text-[#2563EB]")}
          aria-hidden
        />
        <p
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1A1A1A]"
          title={name}
        >
          {name}
        </p>
        <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-[#666666]">
          {formatBytes(sizeBytes)}
        </span>
        <button
        type="button"
        className="shrink-0 rounded-md p-1 text-[#888888] transition hover:bg-[#E5E7EB]/60 hover:text-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </button>
      </div>
      {storageWarning ? (
        <p className="text-[11px] leading-snug text-amber-800" role="status">
          {storageWarning}
        </p>
      ) : null}
    </li>
  );
}

// Human: Modal to pick files — uploads run in UploadTransferPanel after conflict resolution.
// Agent: CALLS checkUploadNameDuplicates; SHOWS UploadConflictDialog; RESTORES recycle matches.
export function UploadDialog({
  open,
  onOpenChange,
  folderId = null,
  effectiveRemainingBytes = Number.POSITIVE_INFINITY,
  onRefreshStorageLimits,
  onLibraryChanged,
}: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [folderUploadRootName, setFolderUploadRootName] = useState<string | null>(null);
  const [activeUploadBatch, setActiveUploadBatch] = useState(false);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<UploadNameDuplicate[]>([]);
  const [recycleMatches, setRecycleMatches] = useState<UploadRecycleMatch[]>([]);
  const [conflictCheckError, setConflictCheckError] = useState("");
  const [storageSkipNotice, setStorageSkipNotice] = useState("");
  const [resolvingConflicts, setResolvingConflicts] = useState(false);

  const uploadablePendingCount = pendingFiles.filter((item) => !item.storageWarning).length;
  const oversizedPendingCount = pendingFiles.length - uploadablePendingCount;

  const continueLabel = useMemo(() => {
    const uploadablePending = pendingFiles.filter((item) => !item.storageWarning);
    return buildSmartContinueLabel(uploadablePending, duplicateMatches, recycleMatches);
  }, [pendingFiles, duplicateMatches, recycleMatches]);

  const continueDisabled = useMemo(() => {
    const uploadablePending = pendingFiles.filter((item) => !item.storageWarning);
    const plan = buildUploadConflictPlan(uploadablePending, duplicateMatches, recycleMatches, {
      skipDuplicates: true,
      restoreRecycle: true,
    });
    return plan.restoreCount === 0 && plan.uploadCount === 0;
  }, [pendingFiles, duplicateMatches, recycleMatches]);

  // Human: Allow Upload when every row is warned — pressing it re-checks capacity and shows an error.
  const uploadDisabled = pendingFiles.length === 0 || checkingConflicts;

  // Human: Hint when reopening the picker while the corner panel still has work in flight.
  // Agent: SUBSCRIBES upload-manager while open; WRITES activeUploadBatch from batch status.
  useEffect(() => {
    if (!open) return;
    return subscribeUploadBatch((batch) => {
      setActiveUploadBatch(batch?.status === "uploading");
    });
  }, [open]);

  // Human: Recompute quota warnings for every pending row when usage or the file list changes.
  // Agent: CALLS applyStorageWarningsInOrder; PRESERVES ids and File references.
  const withStorageWarnings = useCallback(
    (rows: PendingFile[], remainingBytes: number): PendingFile[] =>
      applyStorageWarningsInOrder(
        rows.map((row) => ({ ...row, fileSize: row.file.size })),
        remainingBytes,
      ),
    [],
  );

  // Human: Refresh warnings when remaining storage changes while the picker stays open.
  useEffect(() => {
    if (!open) return;
    setPendingFiles((prev) =>
      prev.length === 0 ? prev : withStorageWarnings(prev, effectiveRemainingBytes),
    );
  }, [open, effectiveRemainingBytes, withStorageWarnings]);

  // Human: Load latest network + quota headroom when the upload dialog opens.
  useEffect(() => {
    if (!open || !onRefreshStorageLimits) return;
    void onRefreshStorageLimits();
  }, [open, onRefreshStorageLimits]);

  const addPendingFiles = useCallback(
    (selected: FileList | null, fromFolderPicker = false) => {
      if (!selected?.length) return;
      setStorageSkipNotice("");

      if (fromFolderPicker) {
        const parsed = parseFolderUploadSelection(Array.from(selected));
        if (!parsed) {
          setConflictCheckError("Could not read the selected folder. Try choosing it again.");
          if (folderInputRef.current) folderInputRef.current.value = "";
          return;
        }
        setFolderUploadRootName(parsed.rootFolderName);
        setPendingFiles((prev) => {
          const withoutFolderRows = prev.filter((item) => !getFileRelativePath(item.file));
          const incoming = parsed.entries.map(({ file }) => ({
            id: createClientId(),
            file,
          }));
          return withStorageWarnings([...withoutFolderRows, ...incoming], effectiveRemainingBytes);
        });
        if (folderInputRef.current) folderInputRef.current.value = "";
        return;
      }

      setPendingFiles((prev) => {
        const incoming = Array.from(selected).map((file) => ({
          id: createClientId(),
          file,
        }));
        return withStorageWarnings([...prev, ...incoming], effectiveRemainingBytes);
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [withStorageWarnings, effectiveRemainingBytes],
  );

  function removePendingFile(id: string) {
    setStorageSkipNotice("");
    setPendingFiles((prev) => {
      const next = withStorageWarnings(
        prev.filter((item) => item.id !== id),
        effectiveRemainingBytes,
      );
      if (!next.some((item) => getFileRelativePath(item.file))) {
        setFolderUploadRootName(null);
      }
      return next;
    });
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function openFolderPicker() {
    folderInputRef.current?.click();
  }

  function resetConflictState() {
    setConflictCheckError("");
    setStorageSkipNotice("");
    setDuplicateMatches([]);
    setRecycleMatches([]);
    setConflictDialogOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setPendingFiles([]);
      setFolderUploadRootName(null);
      resetConflictState();
    }
    onOpenChange(next);
  }

  // Human: Queue files in upload-manager and close the picker after conflict resolution.
  // Agent: CALLS startUploadBatch when files remain; CREATES folder tree for directory picks; CLOSES dialogs.
  async function beginUpload(entries: UploadBatchEntry[]) {
    if (entries.length === 0) {
      resetConflictState();
      setPendingFiles([]);
      setFolderUploadRootName(null);
      onOpenChange(false);
      return;
    }

    const files = entries.map((entry) => entry.file);
    if (isFolderUploadSelection(files)) {
      try {
        const parsed = parseFolderUploadSelection(files);
        if (parsed) {
          const folderMap = await ensureFolderUploadStructure(parsed, folderId);
          onLibraryChanged?.();
          resetConflictState();
          setPendingFiles([]);
          setFolderUploadRootName(null);
          onOpenChange(false);
          startUploadBatch(
            parsed.entries.map(({ file, relativeDir }) => ({
              file,
              folderId: folderMap.get(relativeDir),
            })),
            folderId,
          );
          return;
        }
      } catch (error) {
        setConflictCheckError(getErrorMessage(error));
        return;
      }
    }

    resetConflictState();
    setPendingFiles([]);
    setFolderUploadRootName(null);
    onOpenChange(false);
    startUploadBatch(entries, folderId);
  }

  // Human: Restore recycle-bin rows and upload the remaining pending files per user choice.
  // Agent: POST restoreRecycleBinItems; CALLS beginUpload; WRITES onLibraryChanged after restore.
  async function executeUploadPlan(options: {
    skipDuplicates: boolean;
    restoreRecycle: boolean;
  }) {
    const uploadablePending = pendingFiles.filter((item) => !item.storageWarning);
    const plan = buildUploadConflictPlan(
      uploadablePending,
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
      await beginUpload(plan.uploadFiles.map((file) => ({ file })));
    } catch (error) {
      setConflictCheckError(getErrorMessage(error));
      setConflictDialogOpen(false);
    } finally {
      setResolvingConflicts(false);
    }
  }

  // Human: Run library-wide duplicate and recycle-bin checks before queueing uploads.
  // Agent: HASHES pending files; POST checkUploadNameDuplicates; OPENS UploadConflictDialog when matches exist.
  async function handleStartUpload() {
    if (checkingConflicts) return;

    setConflictCheckError("");
    setStorageSkipNotice("");
    setCheckingConflicts(true);
    try {
      // Human: Re-check against live network node capacity before starting uploads.
      // Agent: CALLS onRefreshStorageLimits; RE-RUNS applyStorageWarningsInOrder on pending rows.
      const remaining =
        (await onRefreshStorageLimits?.()) ?? effectiveRemainingBytes;
      const reassessed = withStorageWarnings(pendingFiles, remaining);
      setPendingFiles(reassessed);

      const uploadable = reassessed.filter((item) => !item.storageWarning);
      const blockedCount = reassessed.length - uploadable.length;

      if (uploadable.length === 0) {
        setConflictCheckError(
          blockedCount > 0
            ? "None of the selected files fit in the remaining storage. Remove files or free space, then try again."
            : "Add at least one file to upload.",
        );
        return;
      }

      if (blockedCount > 0) {
        setStorageSkipNotice(
          `${blockedCount} file${blockedCount === 1 ? "" : "s"} will not be uploaded — not enough storage.`,
        );
      }

      const candidates = await buildUploadCheckCandidates(
        uploadable.map((item) => item.file),
      );
      const hashedUploadable = uploadable.map((item, index) => ({
        ...item,
        contentHash: candidates[index]?.content_hash ?? "",
      }));

      setPendingFiles((prev) =>
        prev.map((item) => {
          const match = hashedUploadable.find((candidate) => candidate.id === item.id);
          return match ? { ...item, contentHash: match.contentHash } : item;
        }),
      );

      const { duplicates, recycle_matches } = await checkUploadNameDuplicates(candidates);
      if (duplicates.length > 0 || recycle_matches.length > 0) {
        setDuplicateMatches(duplicates);
        setRecycleMatches(recycle_matches);
        setConflictDialogOpen(true);
        return;
      }
      await beginUpload(uploadable.map((item) => ({ file: item.file })));
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
      : uploadablePendingCount > 0
        ? oversizedPendingCount > 0
          ? `Upload (${uploadablePendingCount})`
          : `Upload (${uploadablePendingCount})`
        : pendingFiles.length > 0
          ? "No room to upload"
          : "Upload";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="bg-black/30 supports-backdrop-filter:backdrop-blur-[2px]"
        className={cn(
          "flex max-h-[min(90dvh,40rem)] w-[min(36.25rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] min-w-0 flex-col gap-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-0 shadow-[0_16px_32px_rgba(0,0,0,0.15)] ring-0 sm:max-w-[min(36.25rem,calc(100vw-2rem))]",
          "[&_[data-slot=dialog-close]]:top-6 [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:size-8 [&_[data-slot=dialog-close]]:text-[#666666] hover:[&_[data-slot=dialog-close]]:bg-[#F7F8FA]",
        )}
      >
        {/* Human: Scrollable body + pinned footer so many files and long names never clip action buttons. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6 pb-4">
          <div className="flex min-w-0 shrink-0 flex-col gap-2 pr-10">
            <DialogTitle className="text-xl font-bold leading-tight text-[#1A1A1A]">
              Upload files
            </DialogTitle>
            <DialogDescription className="min-w-0 text-sm leading-snug break-words text-[#666666]">
              Choose files or an entire folder to add to your library. Upload progress appears in
              the panel at the bottom-right so you can keep browsing.
            </DialogDescription>
          </div>

          <div className="h-px w-full shrink-0 bg-[#E5E7EB]" aria-hidden />

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => addPendingFiles(event.target.files, false)}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>)}
            onChange={(event) => addPendingFiles(event.target.files, true)}
          />

          {activeUploadBatch ? (
            <p className="shrink-0 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1E3A8A]">
              Uploads are running in the panel at the bottom-right. Files you add here join the
              same queue.
            </p>
          ) : null}

          {storageSkipNotice ? (
            <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {storageSkipNotice}
            </p>
          ) : null}

          {oversizedPendingCount > 0 ? (
            <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
              {oversizedPendingCount} selected file{oversizedPendingCount === 1 ? "" : "s"} exceed
              your remaining storage and will not upload. You can still add them here to review;
              remove them or free space before uploading.
            </p>
          ) : null}

          {conflictCheckError ? (
            <p className="shrink-0 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">
              {conflictCheckError}
            </p>
          ) : null}

          {folderUploadRootName ? (
            <p className="shrink-0 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1E3A8A]">
              Folder <span className="font-semibold">{folderUploadRootName}</span> will be created
              here with its contents and subfolders preserved.
            </p>
          ) : null}

          {pendingFiles.length === 0 ? (
            <div className="grid shrink-0 gap-3 sm:grid-cols-2">
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
              <button
                type="button"
                onClick={openFolderPicker}
                className={cn(
                  "flex w-full flex-col items-center gap-3 rounded-xl border border-[#E5E7EB] px-4 py-6 text-center transition",
                  "hover:border-[#2563EB]/40 hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30",
                )}
              >
                <div className="flex size-11 items-center justify-center rounded-full bg-[#E0F2FE]">
                  <FolderUp className="size-5 text-[#2563EB]" aria-hidden />
                </div>
                <span className="text-[15px] font-bold text-[#1A1A1A]">Browse folder</span>
                <span className="text-[13px] text-[#888888]">Upload an entire folder</span>
              </button>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-[#666666]">
                <span className="font-semibold text-[#1A1A1A]">
                  {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} selected
                </span>
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="shrink-0 font-semibold text-[#2563EB] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
                >
                  Add files
                </button>
                <button
                  type="button"
                  onClick={openFolderPicker}
                  className="shrink-0 font-semibold text-[#2563EB] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
                >
                  Add folder
                </button>
              </div>
              <ul
                className="min-h-0 flex-1 list-none space-y-2 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]"
                style={{ maxHeight: "min(14rem, 32dvh)" }}
                aria-label="Files to upload"
              >
                {pendingFiles.map((item) => (
                  <PendingFileRow
                    key={item.id}
                    name={folderUploadDisplayPath(item.file, folderUploadRootName)}
                    sizeBytes={item.file.size}
                    storageWarning={item.storageWarning}
                    onRemove={() => removePendingFile(item.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#E5E7EB] bg-[#FAFAFA] px-6 py-4">
          <button
            type="button"
            className="shrink-0 rounded-lg border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-semibold text-[#1A1A1A] transition hover:bg-[#F7F8FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={uploadDisabled}
            className={cn(
              "shrink-0 rounded-lg px-5 py-2.5 text-sm font-bold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
              uploadDisabled
                ? "cursor-not-allowed bg-[#2563EB]/40"
                : "bg-[#2563EB] hover:bg-[#1D4ED8]",
            )}
            onClick={() => void handleStartUpload()}
          >
            {uploadButtonLabel}
          </button>
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
