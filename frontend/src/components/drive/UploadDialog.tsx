// Human: File picker modal — select files or an entire folder, then hand off to the upload transfer panel.
// Agent: WRITES startUploadBatch; CHECKS upload conflicts; CREATES folder tree for directory picks.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type InputHTMLAttributes } from "react";
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
import {
  buildUploadCheckCandidates,
  type UploadCheckCandidate,
} from "@/lib/file-content-hash";
import {
  ensureFolderUploadStructure,
  folderUploadDisplayPath,
  getFileRelativePath,
  isFolderUploadSelection,
  parseFolderUploadSelection,
} from "@/lib/upload-folder-structure";
import { startUploadBatch, subscribeUploadBatch, type UploadBatchEntry } from "@/lib/upload-manager";
import {
  splitUploadsByCapacity,
  storageOverflowNotice,
} from "@/lib/upload-storage-capacity";
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
  /** Human: Set only after duplicate detection, when the surviving file no longer fits the quota. */
  storageWarning?: string | null;
};

/**
 * Human: Upload set held back after the capacity check trimmed it — one more Upload press sends it.
 * Agent: CARRIES resolved rows + recycle restores so the second press skips hashing and the conflict dialog.
 */
type DeferredUploadPlan = {
  rows: PendingFile[];
  restoreFileIds: string[];
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
  /** Human: Files from explorer drag-drop — same conflict flow as the picker. */
  initialFiles?: File[];
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
          ? "border-warn/40 bg-warn-weak/80"
          : "border-edge bg-surface",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileText
          className={cn("size-3.5 shrink-0", storageWarning ? "text-warn" : "text-brand")}
          aria-hidden
        />
        <p
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink"
          title={name}
        >
          {name}
        </p>
        <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-ink-muted">
          {formatBytes(sizeBytes)}
        </span>
        <button
        type="button"
        className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-edge/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </button>
      </div>
      {storageWarning ? (
        <p className="text-[11px] leading-snug text-warn" role="status">
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
  initialFiles,
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
  const [hashProgress, setHashProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [deferredPlan, setDeferredPlan] = useState<DeferredUploadPlan | null>(null);
  const hashAbortRef = useRef<AbortController | null>(null);

  // Human: How many files the Upload button would actually send on the next press.
  const uploadableCount = deferredPlan
    ? deferredPlan.rows.length
    : pendingFiles.filter((item) => !item.storageWarning).length;

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

  // Human: Any change to the selection invalidates the last capacity verdict and held-back plan.
  // Agent: CLEARS storageWarning/skip notice/deferred plan so the next Upload press re-runs the full preflight.
  const clearCapacityVerdict = useCallback(() => {
    setStorageSkipNotice("");
    setDeferredPlan(null);
    setPendingFiles((prev) =>
      prev.some((row) => row.storageWarning)
        ? prev.map((row) => ({ ...row, storageWarning: null }))
        : prev,
    );
  }, []);

  // Human: Seed pending files from explorer drag-drop so conflict checks match the picker path.
  useEffect(() => {
    if (!open || !initialFiles?.length) return;
    setPendingFiles(
      initialFiles.map((file) => ({
        id: createClientId(),
        file,
      })),
    );
    setFolderUploadRootName(null);
    setStorageSkipNotice("");
    setDeferredPlan(null);
  }, [open, initialFiles]);

  // Human: Load latest network + quota headroom when the upload dialog opens.
  useEffect(() => {
    if (!open || !onRefreshStorageLimits) return;
    void onRefreshStorageLimits();
  }, [open, onRefreshStorageLimits]);

  // Human: Add picked files — selection never checks storage, that happens after duplicate detection.
  // Agent: WRITES pendingFiles only; CALLS clearCapacityVerdict so a stale verdict cannot gate new rows.
  const addPendingFiles = useCallback(
    (selected: FileList | null, fromFolderPicker = false) => {
      if (!selected?.length) return;
      clearCapacityVerdict();

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
          return [...withoutFolderRows, ...incoming];
        });
        if (folderInputRef.current) folderInputRef.current.value = "";
        return;
      }

      setPendingFiles((prev) => [
        ...prev,
        ...Array.from(selected).map((file) => ({
          id: createClientId(),
          file,
        })),
      ]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [clearCapacityVerdict],
  );

  function removePendingFile(id: string) {
    clearCapacityVerdict();
    setPendingFiles((prev) => {
      const next = prev.filter((item) => item.id !== id);
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
    setDeferredPlan(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      hashAbortRef.current?.abort();
      setPendingFiles([]);
      setFolderUploadRootName(null);
      setHashProgress(null);
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
          const hashByKey = new Map(
            entries.map((entry) => [
              `${entry.file.name}\0${entry.file.size}\0${getFileRelativePath(entry.file) ?? ""}`,
              entry.contentHash,
            ]),
          );
          startUploadBatch(
            parsed.entries.map(({ file, relativeDir }) => ({
              file,
              folderId: folderMap.get(relativeDir),
              relativePath: relativeDir || undefined,
              contentHash: hashByKey.get(
                `${file.name}\0${file.size}\0${getFileRelativePath(file) ?? ""}`,
              ),
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

  // Human: Last preflight step — measure the duplicate-free set against live remaining storage, then upload.
  // Agent: CALLS onRefreshStorageLimits + splitUploadsByCapacity; HOLDS the trimmed plan when rows do not fit.
  async function finalizeUpload(plan: DeferredUploadPlan) {
    const remaining = (await onRefreshStorageLimits?.()) ?? effectiveRemainingBytes;
    const { fitting, blocked, requiredBytes } = splitUploadsByCapacity(
      plan.rows,
      remaining,
      (row) => row.file.size,
    );

    if (blocked.length > 0) {
      const warningById = new Map(blocked.map((row) => [row.id, row.storageWarning]));
      setPendingFiles((prev) =>
        prev.map((item) => ({ ...item, storageWarning: warningById.get(item.id) ?? null })),
      );
      setConflictDialogOpen(false);

      if (fitting.length === 0 && plan.restoreFileIds.length === 0) {
        setDeferredPlan(null);
        setStorageSkipNotice("");
        setConflictCheckError(
          "None of the remaining files fit in your storage. Remove files or free space, then try again.",
        );
        return;
      }

      setDeferredPlan({ rows: fitting, restoreFileIds: plan.restoreFileIds });
      setConflictCheckError("");
      setStorageSkipNotice(storageOverflowNotice(blocked.length, requiredBytes, remaining));
      return;
    }

    if (plan.restoreFileIds.length > 0) {
      await restoreRecycleBinItems({
        file_ids: plan.restoreFileIds,
        folder_ids: [],
      });
      onLibraryChanged?.();
    }

    await beginUpload(
      fitting.map((item) => ({
        file: item.file,
        contentHash: item.contentHash,
      })),
    );
  }

  // Human: Turn the user's conflict choice into a plan, then hand it to the capacity check.
  // Agent: CALLS buildUploadConflictPlan then finalizeUpload; NO restore happens until capacity passes.
  async function executeUploadPlan(options: {
    skipDuplicates: boolean;
    restoreRecycle: boolean;
  }) {
    const plan = buildUploadConflictPlan(pendingFiles, duplicateMatches, recycleMatches, options);

    setResolvingConflicts(true);
    setConflictCheckError("");
    try {
      await finalizeUpload({
        rows: plan.uploadFiles,
        restoreFileIds: plan.restoreFileIds,
      });
    } catch (error) {
      setConflictCheckError(getErrorMessage(error));
      setConflictDialogOpen(false);
    } finally {
      setResolvingConflicts(false);
    }
  }

  // Human: Preflight order — hash the selection, resolve duplicates, then size what is left against storage.
  // Agent: HASHES pending files with progress; POST checkUploadNameDuplicates; ENDS in finalizeUpload (capacity).
  async function handleStartUpload() {
    if (checkingConflicts) return;

    setConflictCheckError("");
    setCheckingConflicts(true);
    setHashProgress(null);
    hashAbortRef.current?.abort();
    const abort = new AbortController();
    hashAbortRef.current = abort;
    try {
      // Human: Second press after a capacity trim — plan is already resolved, just send it.
      if (deferredPlan) {
        await finalizeUpload(deferredPlan);
        return;
      }

      setStorageSkipNotice("");
      if (pendingFiles.length === 0) {
        setConflictCheckError("Add at least one file to upload.");
        return;
      }

      // Human: Hash only rows without a digest so a repeat press never re-reads gigabytes.
      const unhashed = pendingFiles.filter((item) => !item.contentHash);
      const freshCandidates = await buildUploadCheckCandidates(
        unhashed.map((item) => item.file),
        {
          signal: abort.signal,
          onProgress: ({ completed, total }) => setHashProgress({ completed, total }),
        },
      );
      const freshHashById = new Map(
        unhashed.map((item, index) => [item.id, freshCandidates[index]?.content_hash ?? ""]),
      );
      const hashedRows = pendingFiles.map((item) => ({
        ...item,
        contentHash: item.contentHash || freshHashById.get(item.id) || "",
      }));
      setPendingFiles(hashedRows);

      const candidates: UploadCheckCandidate[] = hashedRows.map((item) => ({
        name: item.file.name,
        size_bytes: Math.max(0, Math.floor(Number(item.file.size) || 0)),
        content_hash: item.contentHash,
      }));

      const { duplicates, recycle_matches } = await checkUploadNameDuplicates(candidates);
      if (duplicates.length > 0 || recycle_matches.length > 0) {
        setDuplicateMatches(duplicates);
        setRecycleMatches(recycle_matches);
        setConflictDialogOpen(true);
        return;
      }

      await finalizeUpload({ rows: hashedRows, restoreFileIds: [] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setConflictCheckError(getErrorMessage(error));
    } finally {
      setCheckingConflicts(false);
      setHashProgress(null);
      hashAbortRef.current = null;
    }
  }

  function handleDropZoneDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }

  function handleDropZoneDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }

  function handleDropZoneDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const files = event.dataTransfer?.files;
    if (files?.length) {
      addPendingFiles(files, false);
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
      ? hashProgress
        ? `Preparing ${hashProgress.completed}/${hashProgress.total}…`
        : "Checking…"
      : uploadableCount > 0
        ? `Upload (${uploadableCount})`
        : deferredPlan
          ? `Restore (${deferredPlan.restoreFileIds.length})`
          : pendingFiles.length > 0
            ? "No room to upload"
            : "Upload";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="bg-black/30 supports-backdrop-filter:backdrop-blur-[2px]"
        className={cn(
          "flex max-h-[min(90dvh,40rem)] w-[min(36.25rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] min-w-0 flex-col gap-0 overflow-hidden rounded-2xl border border-edge bg-panel p-0 shadow-[0_16px_32px_rgba(0,0,0,0.15)] ring-0 sm:max-w-[min(36.25rem,calc(100vw-2rem))]",
          "[&_[data-slot=dialog-close]]:top-6 [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:size-8 [&_[data-slot=dialog-close]]:text-ink-muted hover:[&_[data-slot=dialog-close]]:bg-surface",
        )}
      >
        {/* Human: Scrollable body + pinned footer so many files and long names never clip action buttons. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6 pb-4">
          <div className="flex min-w-0 shrink-0 flex-col gap-2 pr-10">
            <DialogTitle className="text-xl font-bold leading-tight text-ink">
              Upload files
            </DialogTitle>
            <DialogDescription className="min-w-0 text-sm leading-snug break-words text-ink-muted">
              Choose files or an entire folder to add to your library. Upload progress appears in
              the panel at the bottom-right so you can keep browsing.
            </DialogDescription>
          </div>

          <div className="h-px w-full shrink-0 bg-edge" aria-hidden />

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
            <p className="shrink-0 rounded-lg border border-brand/40 bg-brand-weak px-3 py-2 text-sm text-brand-hover">
              Uploads are running in the panel at the bottom-right. Files you add here join the
              same queue.
            </p>
          ) : null}

          {storageSkipNotice ? (
            <p
              className="shrink-0 rounded-lg border border-warn/40 bg-warn-weak px-3 py-2 text-sm text-warn"
              role="status"
            >
              {storageSkipNotice}
            </p>
          ) : null}

          {conflictCheckError ? (
            <p className="shrink-0 rounded-lg border border-danger/40 bg-danger-weak px-3 py-2 text-sm text-danger">
              {conflictCheckError}
            </p>
          ) : null}

          {hashProgress ? (
            <p className="shrink-0 rounded-lg border border-brand/40 bg-brand-weak px-3 py-2 text-sm text-brand-hover" role="status">
              Preparing files… {hashProgress.completed} of {hashProgress.total} hashed
            </p>
          ) : null}

          {folderUploadRootName ? (
            <p className="shrink-0 rounded-lg border border-brand/40 bg-brand-weak px-3 py-2 text-sm text-brand-hover">
              Folder <span className="font-semibold">{folderUploadRootName}</span> will be created
              here with its contents and subfolders preserved.
            </p>
          ) : null}

          {pendingFiles.length === 0 ? (
            <div
              className={cn(
                "grid shrink-0 gap-3 rounded-xl border-2 border-dashed p-2 sm:grid-cols-2",
                isDragOver
                  ? "border-brand bg-brand-weak"
                  : "border-transparent",
              )}
              onDragEnter={handleDropZoneDragOver}
              onDragOver={handleDropZoneDragOver}
              onDragLeave={handleDropZoneDragLeave}
              onDrop={handleDropZoneDrop}
            >
              <button
                type="button"
                onClick={openFilePicker}
                className={cn(
                  "flex w-full flex-col items-center gap-3 rounded-xl border border-edge px-4 py-6 text-center transition",
                  "hover:border-brand/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                )}
              >
                <div className="flex size-11 items-center justify-center rounded-full bg-brand-weak">
                  <Upload className="size-5 text-brand" aria-hidden />
                </div>
                <span className="text-[15px] font-bold text-ink">Browse files</span>
                <span className="text-[13px] text-ink-faint">
                  {isDragOver ? "Drop files to add" : "Single or multiple files · or drag here"}
                </span>
              </button>
              <button
                type="button"
                onClick={openFolderPicker}
                className={cn(
                  "flex w-full flex-col items-center gap-3 rounded-xl border border-edge px-4 py-6 text-center transition",
                  "hover:border-brand/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                )}
              >
                <div className="flex size-11 items-center justify-center rounded-full bg-brand-weak">
                  <FolderUp className="size-5 text-brand" aria-hidden />
                </div>
                <span className="text-[15px] font-bold text-ink">Browse folder</span>
                <span className="text-[13px] text-ink-faint">Upload an entire folder</span>
              </button>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-ink-muted">
                <span className="font-semibold text-ink">
                  {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} selected
                </span>
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="shrink-0 font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  Add files
                </button>
                <button
                  type="button"
                  onClick={openFolderPicker}
                  className="shrink-0 font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
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

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge bg-surface px-6 py-4">
          <button
            type="button"
            className="shrink-0 rounded-lg border border-edge bg-panel px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={uploadDisabled}
            className={cn(
              "shrink-0 rounded-lg px-5 py-2.5 text-sm font-bold text-brand-on transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              uploadDisabled
                ? "cursor-not-allowed bg-brand/40"
                : "bg-brand hover:bg-brand-hover",
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
