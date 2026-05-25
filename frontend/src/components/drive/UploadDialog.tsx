// Human: Three-step upload wizard — select files, upload with progress, then status summary.
// Agent: STEPS select|uploading|complete; CALLS uploadFileWithProgress phases; REMOVABLE pending rows.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileIcon,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { getErrorMessage, uploadFileWithProgress, type UploadProgressUpdate } from "@/api/client";
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

type UploadStep = "select" | "uploading" | "complete";

type QueueStatus = "queued" | "uploading" | "done" | "error";

type PendingFile = {
  id: string;
  file: File;
};

type UploadPhase = UploadProgressUpdate["phase"];

type UploadQueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  progress: number;
  phase: UploadPhase;
  indeterminate?: boolean;
  uploadedFileId?: string;
  error?: string;
};

export type UploadsCompletePayload = {
  fileIds: string[];
};

function pendingFileId(file: File, index: number) {
  return `pending-${file.name}-${file.size}-${file.lastModified}-${index}`;
}

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadsComplete?: (payload: UploadsCompletePayload) => void;
};

// Human: Native width-based bar; indeterminate mode when server compression time is unknown.
// Agent: RENDERS determinate fill for upload; processing uses sliding shimmer when indeterminate.
function UploadProgressBar({
  value,
  phase,
  indeterminate,
}: {
  value: number;
  phase: UploadPhase;
  indeterminate?: boolean;
}) {
  if (phase === "processing" && indeterminate) {
    return (
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Processing into storage"
      >
        <div className="absolute inset-y-0 left-0 w-full bg-violet-200" />
        <div className="absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full bg-violet-600" />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));
  const fillClass = phase === "processing" ? "bg-violet-600" : "bg-blue-600";
  return (
    <div
      className="h-3 w-full overflow-hidden rounded-full bg-neutral-200"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={phase === "processing" ? "Processing into storage" : "Uploading to server"}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-150 ease-out", fillClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function activePhaseLabel(phase: UploadPhase) {
  return phase === "processing" ? "Processing into storage" : "Uploading to server";
}

// Human: Show how long server-side storage has been running during indeterminate processing.
function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function UploadDialog({ open, onOpenChange, onUploadsComplete }: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const queueRef = useRef<UploadQueueItem[]>([]);
  const onCompleteRef = useRef(onUploadsComplete);
  const uploadsNotifiedRef = useRef(false);

  const [step, setStep] = useState<UploadStep>("select");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [processingElapsedSec, setProcessingElapsedSec] = useState(0);

  useEffect(() => {
    onCompleteRef.current = onUploadsComplete;
  }, [onUploadsComplete]);

  const activeItem = queue.find((item) => item.status === "uploading");

  // Human: Tick elapsed seconds while Nebular compresses/stores so the UI does not look frozen.
  // Agent: RUNS interval when step=uploading and active file phase=processing; RESETS otherwise.
  useEffect(() => {
    if (step !== "uploading" || activeItem?.phase !== "processing") {
      setProcessingElapsedSec(0);
      return;
    }
    const started = Date.now();
    setProcessingElapsedSec(0);
    const timerId = window.setInterval(() => {
      setProcessingElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [step, activeItem?.id, activeItem?.phase]);

  const setQueueSync = useCallback(
    (updater: UploadQueueItem[] | ((prev: UploadQueueItem[]) => UploadQueueItem[])) => {
      setQueue((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        queueRef.current = next;
        return next;
      });
    },
    [],
  );

  const waitingItems = queue.filter((item) => item.status === "queued");
  const doneCount = queue.filter((item) => item.status === "done").length;
  const errorCount = queue.filter((item) => item.status === "error").length;
  const isUploading = step === "uploading";

  // Human: Notify parent with uploaded file ids so drive can refresh and show new items on Home.
  // Agent: READS queueRef done rows; CALLS onUploadsComplete with fileIds.
  const notifyUploadsComplete = useCallback(() => {
    if (uploadsNotifiedRef.current) return;
    const fileIds = queueRef.current
      .filter((item) => item.status === "done" && item.uploadedFileId)
      .map((item) => item.uploadedFileId as string);
    if (fileIds.length === 0) return;
    uploadsNotifiedRef.current = true;
    onCompleteRef.current?.({ fileIds });
  }, []);

  // Human: Upload queued files sequentially; transition to complete step when finished.
  // Agent: READS queueRef; UPDATES progress; SETS step complete; CALLS onUploadsComplete on success.
  const runProcessor = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (true) {
        const next = queueRef.current.find((item) => item.status === "queued");
        if (!next) break;

        const uploadId = next.id;
        const file = next.file;

        setQueueSync((prev) =>
          prev.map((item) =>
            item.id === uploadId
              ? { ...item, status: "uploading" as const, progress: 0, phase: "uploading" as const }
              : item,
          ),
        );

        try {
          const result = await uploadFileWithProgress(file, (update) => {
            setQueueSync((prev) =>
              prev.map((item) =>
                item.id === uploadId
                  ? {
                      ...item,
                      progress: update.percent,
                      phase: update.phase,
                      indeterminate: update.indeterminate,
                    }
                  : item,
              ),
            );
          });
          setQueueSync((prev) =>
            prev.map((item) =>
              item.id === uploadId
                ? {
                    ...item,
                    status: "done" as const,
                    progress: 100,
                    phase: "processing" as const,
                    indeterminate: false,
                    uploadedFileId: result.file.id,
                  }
                : item,
            ),
          );
        } catch (error) {
          setQueueSync((prev) =>
            prev.map((item) =>
              item.id === uploadId
                ? { ...item, status: "error" as const, error: getErrorMessage(error) }
                : item,
            ),
          );
        }
      }
    } finally {
      processingRef.current = false;
      const snapshot = queueRef.current;
      const stillQueued = snapshot.some((item) => item.status === "queued");
      if (stillQueued) {
        setTimeout(() => void runProcessor(), 0);
        return;
      }
      setStep("complete");
      notifyUploadsComplete();
    }
  }, [setQueueSync, notifyUploadsComplete]);

  // Human: Append picked files to the selection list (no upload until user confirms).
  // Agent: READS FileList; WRITES pendingFiles; DOES NOT start processor.
  const addPendingFiles = useCallback((selected: FileList | null) => {
    if (!selected?.length) return;
    setPendingFiles((prev) => {
      const base = prev.length;
      const incoming = Array.from(selected).map((file, index) => ({
        id: pendingFileId(file, base + index),
        file,
      }));
      return [...prev, ...incoming];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function removePendingFile(id: string) {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  }

  // Human: Move pending selection into the upload queue and open the progress step.
  // Agent: WRITES queue from pendingFiles; CLEARS pending; SETS step uploading; STARTS processor.
  function startUpload() {
    if (pendingFiles.length === 0) return;
    const initialQueue: UploadQueueItem[] = pendingFiles.map((item) => ({
      id: item.id,
      file: item.file,
      status: "queued",
      progress: 0,
      phase: "uploading",
    }));
    setPendingFiles([]);
    setQueueSync(initialQueue);
    setStep("uploading");
    setTimeout(() => void runProcessor(), 0);
  }

  function resetDialog() {
    setStep("select");
    setPendingFiles([]);
    setQueueSync([]);
    processingRef.current = false;
    uploadsNotifiedRef.current = false;
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleOpenChange(next: boolean) {
    if (!next && isUploading) return;
    if (!next) resetDialog();
    onOpenChange(next);
  }

  function handleDone() {
    notifyUploadsComplete();
    handleOpenChange(false);
  }

  useEffect(() => {
    if (!open && !isUploading) {
      resetDialog();
    }
  }, [open, isUploading]);

  const stepTitle =
    step === "select"
      ? "Upload files"
      : step === "uploading"
        ? "Uploading files"
        : "Upload complete";

  const stepDescription =
    step === "select"
      ? "Add files and remove any you do not want. Press Upload when ready."
      : step === "uploading"
        ? activeItem?.phase === "processing"
          ? "Saving files to storage — compression and blob write may take a while for large files."
          : "Please keep this window open until uploads finish."
        : errorCount > 0
          ? `${doneCount} succeeded, ${errorCount} failed.`
          : `All ${doneCount} file${doneCount === 1 ? "" : "s"} uploaded successfully.`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent
        className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-xl"
        showCloseButton={!isUploading}
      >
        <DialogHeader className="border-b border-neutral-100 px-6 py-5">
          <DialogTitle className="text-lg text-neutral-900">{stepTitle}</DialogTitle>
          <DialogDescription className="text-neutral-500">{stepDescription}</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => addPendingFiles(event.target.files)}
        />

        <div className="flex flex-col gap-4 px-6 py-5">
          {step === "select" ? (
            <>
              <button
                type="button"
                onClick={openFilePicker}
                className={cn(
                  "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-[#faf9f8] px-6 py-6 text-center transition",
                  "hover:border-blue-400 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                )}
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-blue-100">
                  <Upload className="size-5 text-blue-600" aria-hidden />
                </div>
                <span className="text-sm font-medium text-neutral-900">Browse files</span>
                <span className="text-xs text-neutral-500">Single or multiple files</span>
              </button>

              {pendingFiles.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} ready
                  </p>
                  <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200">
                    {pendingFiles.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                        <FileIcon className="size-5 shrink-0 text-blue-600" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-neutral-900">
                            {item.file.name}
                          </p>
                          <p className="text-xs text-neutral-500">{formatBytes(item.file.size)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-neutral-500 hover:text-red-600"
                          aria-label={`Remove ${item.file.name}`}
                          onClick={() => removePendingFile(item.id)}
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-neutral-500">
                  No files selected yet.
                </p>
              )}
            </>
          ) : null}

          {step === "uploading" ? (
            <>
              {activeItem ? (
                <div
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-4",
                    activeItem.phase === "processing"
                      ? "border-violet-200 bg-violet-50"
                      : "border-blue-200 bg-blue-50",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide",
                      activeItem.phase === "processing" ? "text-violet-800" : "text-blue-800",
                    )}
                  >
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {activePhaseLabel(activeItem.phase)}
                  </div>
                  <div className="flex items-start gap-3">
                    <FileIcon
                      className={cn(
                        "mt-0.5 size-5 shrink-0",
                        activeItem.phase === "processing" ? "text-violet-700" : "text-blue-700",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-neutral-900">
                          {activeItem.file.name}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 text-sm font-bold tabular-nums",
                            activeItem.phase === "processing" ? "text-violet-800" : "text-blue-800",
                          )}
                        >
                          {activeItem.phase === "processing" && activeItem.indeterminate
                            ? "Working…"
                            : `${activeItem.progress}%`}
                        </span>
                      </div>
                      <UploadProgressBar
                        value={activeItem.progress}
                        phase={activeItem.phase}
                        indeterminate={activeItem.indeterminate}
                      />
                      <p className="text-xs text-neutral-600">
                        {formatBytes(activeItem.file.size)}
                        {activeItem.phase === "processing" ? (
                          <span className="text-neutral-500">
                            {" "}
                            ·{" "}
                            {activeItem.indeterminate
                              ? `Compressing and storing on server (${formatElapsed(processingElapsedSec)} elapsed — large files often take several minutes)`
                              : "Storing and compressing blob…"}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {waitingItems.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-neutral-900">
                    Waiting ({waitingItems.length})
                  </h3>
                  <ul className="max-h-40 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200 bg-white">
                    {waitingItems.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Clock className="size-4 shrink-0 text-neutral-400" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                          {item.file.name}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-500">
                          {formatBytes(item.file.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}

          {step === "complete" ? (
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3",
                  errorCount > 0 ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900",
                )}
              >
                {errorCount > 0 ? (
                  <AlertCircle className="size-5 shrink-0" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                )}
                <p className="text-sm font-medium">
                  {errorCount > 0
                    ? `${doneCount} uploaded · ${errorCount} failed`
                    : `${doneCount} file${doneCount === 1 ? "" : "s"} uploaded`}
                </p>
              </div>
              <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200">
                {queue.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                    {item.status === "done" ? (
                      <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-hidden />
                    ) : (
                      <AlertCircle className="size-5 shrink-0 text-red-500" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {item.file.name}
                      </p>
                      {item.status === "error" && item.error ? (
                        <p className="truncate text-xs text-red-600">{item.error}</p>
                      ) : (
                        <p className="text-xs text-neutral-500">{formatBytes(item.file.size)}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        item.status === "done"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800",
                      )}
                    >
                      {item.status === "done" ? "Uploaded" : "Failed"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
          {step === "select" ? (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-blue-600 text-white hover:bg-blue-700"
                disabled={pendingFiles.length === 0}
                onClick={startUpload}
              >
                Upload {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}
              </Button>
            </>
          ) : null}
          {step === "uploading" ? (
            <Button type="button" disabled>
              {activeItem?.phase === "processing" ? "Processing…" : "Uploading…"}
            </Button>
          ) : null}
          {step === "complete" ? (
            <Button
              type="button"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={handleDone}
            >
              Done
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
