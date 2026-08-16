// Human: In-memory upload batch registry — runs parallel uploads without blocking the drive UI.

// Agent: STORES batch queue; PERSISTS to localStorage; RESTORES server-side processing after reload.



import {

  abortUploadSession,

  ApiError,

  cancelAllHlsReprocess,

  cancelHlsReprocess,

  cancelVideoIngest,

  deleteFile,

  getErrorMessage,

  listBackgroundJobs,

  mapConversionProgressToOverallPercent,

  uploadFileWithProgress,

  waitForFileIngestCompletion,

  type FileItem,

  type UploadProgressUpdate,

} from "@/api/client";

import {
  publishUploadBatchSnapshot,
  readUploadBatchSnapshot,
} from "@/lib/upload-batch-snapshot";
import { abortResumableUploadSession } from "@/lib/resumable-upload";
import { suggestedFileConcurrency } from "@/lib/upload-adaptive";
import { createClientId } from "@/lib/utils-app";
import {
  acquirePipelineStage,
  createPipelineStageGate,
  PIPELINE_STAGE_LIMIT,
  releaseAllPipelineStages,
} from "@/lib/upload-pipeline";



export type UploadItemStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export type UploadPhase = UploadProgressUpdate["phase"];



// Human: How the transfer panel groups a row — only in_flight rows count toward "active" badges.
// Agent: DERIVED in toItemSnapshot from status, localFile, uploadedFileId, resumingItemIds.
export type UploadItemDisplayBucket = "in_flight" | "queued" | "done" | "error" | "cancelled";

export type UploadItemSnapshot = {

  id: string;

  fileName: string;

  fileSize: number;

  mimeType: string;

  status: UploadItemStatus;

  progress: number;

  phase: UploadPhase;

  indeterminate?: boolean;

  uploadedFileId?: string;

  /** Server resumable session id — persisted for reload resume. */
  resumableServerSessionId?: string | null;

  /** True when the user must re-pick the same File to continue byte upload after reload. */
  needsFileReselect?: boolean;

  /** True when a failed/cancelled row still holds a local File and can retry without re-picking. */
  canRetry?: boolean;

  /** Relative folder path for folder-batch uploads (display only). */
  relativePath?: string;

  /** Precomputed SHA-256 from the picker — avoids a second full-file hash. */
  contentHash?: string;

  /** How the last part byte path ran — direct Nebular vs Ownly proxy. */
  partTransport?: "direct" | "proxy";

  /** User paused this row — pump skips claiming it until resumed. */
  paused?: boolean;

  /** True when this row is an HLS stream rebuild (not first-time upload ingest). */
  isReprocess?: boolean;

  error?: string;

  displayBucket: UploadItemDisplayBucket;

};



export type UploadBatchSnapshot = {

  id: string;

  status: "uploading" | "complete";

  items: UploadItemSnapshot[];

  /** True when the user paused claiming new browser upload slots. */
  paused?: boolean;

};



type UploadBatchListener = (batch: UploadBatchSnapshot | null) => void;

type UploadFileListener = (fileId: string) => void;

type UploadFileRegisteredListener = (file: FileItem) => void;



// Human: Default/hard cap browser upload slots — adaptive module lowers under pressure.
// Agent: UPLOAD slots = localFile rows; POST-UPLOAD slots = upload-pipeline.ts per phase.
const MAX_CONCURRENT_UPLOADS = 2;
function ADAPTIVE_FILE_SLOTS_CAP(): number {
  return Math.max(MAX_CONCURRENT_UPLOADS, 3);
}
const UPLOAD_MAX_RETRIES = 6;
const UPLOAD_RETRY_BASE_MS = 1_500;
const UPLOAD_RETRY_MAX_MS = 30_000;
/** Human: When the API returns 429, pause all upload workers until the server window clears. */
let uploadPumpPausedUntil = 0;

/** Human: User-requested global pause — pump skips claiming new work until resumed. */
let userUploadPaused = false;

const UPLOAD_BATCH_STORAGE_KEY = "ownly_upload_batch";

type PersistedUploadItem = UploadItemSnapshot;



type PersistedUploadBatch = {

  id: string;

  status: "uploading" | "complete";

  folderId: string | null;

  items: PersistedUploadItem[];

};



type InternalUploadItem = {

  id: string;

  fileName: string;

  fileSize: number;

  mimeType: string;

  localFile?: File;

  /** Target folder for this row — may differ from batch.folderId when the user queues more uploads later. */
  folderId?: string | null;

  status: UploadItemStatus;

  progress: number;

  phase: UploadPhase;

  indeterminate?: boolean;

  uploadedFileId?: string;

  /** Server resumable session id — reused on retry to skip uploaded parts. */
  resumableServerSessionId?: string | null;

  /** Reload recovery — row waits for the user to re-select the same file bytes. */
  needsFileReselect?: boolean;

  relativePath?: string;

  contentHash?: string;

  partTransport?: "direct" | "proxy";

  paused?: boolean;

  /** True when this row is an HLS stream rebuild (not first-time upload ingest). */
  isReprocess?: boolean;

  error?: string;

};



type InternalUploadBatch = {

  id: string;

  status: "uploading" | "complete";

  folderId: string | null;

  items: InternalUploadItem[];

};



let batch: InternalUploadBatch | null = null;

let restoreStarted = false;

const batchListeners = new Set<UploadBatchListener>();

const fileListeners = new Set<UploadFileListener>();

const fileRegisteredListeners = new Set<UploadFileRegisteredListener>();

const fileIngestProgressListeners = new Set<UploadFileRegisteredListener>();

const resumingItemIds = new Set<string>();

// Human: Rows the user dismissed with X — stops ingest polling even after the item leaves the batch.
// Agent: READ by waitForFileIngestCompletion isCancelled; SET in cancelUploadItem before removal.
const abortedUploadItemIds = new Set<string>();



// Human: Decide whether a row is actively using a pipeline slot or waiting in the backlog.
// Agent: READS localFile, uploadedFileId, resumingItemIds; RETURNS in_flight vs queued for tray counts.
function resolveItemDisplayBucket(item: InternalUploadItem): UploadItemDisplayBucket {
  if (item.status === "done") return "done";
  if (item.status === "error") return "error";
  if (item.status === "cancelled") return "cancelled";
  if (item.status === "queued") return "queued";

  if (item.status === "uploading") {
    if (item.localFile !== undefined) return "in_flight";
    if (!item.uploadedFileId) return "in_flight";
    if (resumingItemIds.has(item.id)) return "in_flight";
    return "queued";
  }

  return "queued";
}

function toItemSnapshot(item: InternalUploadItem): UploadItemSnapshot {

  return {

    id: item.id,

    fileName: item.fileName,

    fileSize: item.fileSize,

    mimeType: item.mimeType,

    status: item.status,

    progress: item.progress,

    phase: item.phase,

    indeterminate: item.indeterminate,

    uploadedFileId: item.uploadedFileId,

    resumableServerSessionId: item.resumableServerSessionId,

    needsFileReselect: item.needsFileReselect,

    canRetry:
      (item.status === "error" || item.status === "cancelled") &&
      item.localFile !== undefined &&
      !item.needsFileReselect,

    relativePath: item.relativePath,

    partTransport: item.partTransport,

    paused: item.paused,

    isReprocess: item.isReprocess,

    error: item.error,

    displayBucket: resolveItemDisplayBucket(item),

  };

}



function toBatchSnapshot(): UploadBatchSnapshot | null {

  if (!batch) return null;

  return {

    id: batch.id,

    status: batch.status,

    items: batch.items.map(toItemSnapshot),

    paused: userUploadPaused,

  };

}



// Human: Mirror the active batch to localStorage so reload can reopen the transfer panel.

// Agent: WRITES ownly_upload_batch; REMOVES key when batch is cleared.

function persistBatchToStorage() {

  if (typeof window === "undefined") return;



  if (!batch) {

    window.localStorage.removeItem(UPLOAD_BATCH_STORAGE_KEY);

    return;

  }



  const persisted: PersistedUploadBatch = {

    id: batch.id,

    status: batch.status,

    folderId: batch.folderId,

    items: batch.items.map(toItemSnapshot),

  };

  window.localStorage.setItem(UPLOAD_BATCH_STORAGE_KEY, JSON.stringify(persisted));

}



function emitBatch() {

  const snapshot = toBatchSnapshot();
  publishUploadBatchSnapshot(snapshot);

  persistBatchToStorage();

  for (const listener of batchListeners) {

    listener(snapshot);

  }

}



function notifyFileUploaded(fileId: string) {

  for (const listener of fileListeners) {

    listener(fileId);

  }

}



// Human: Push intermediate conversion polls to the drive grid while the tray owns the loop.
// Agent: CALLS fileIngestProgressListeners with each fetchFile row.
function notifyFileIngestProgress(file: FileItem) {
  for (const listener of fileIngestProgressListeners) {
    listener(file);
  }
}

// Human: Notify drive views as soon as the upload API returns a file row (before ingest finishes).
// Agent: CALLS fileRegisteredListeners; USED by DrivePage to show processing badges on new rows.
function notifyFileRegistered(file: FileItem) {

  for (const listener of fileRegisteredListeners) {

    listener(file);

  }

}



function updateItems(updater: (items: InternalUploadItem[]) => InternalUploadItem[]) {

  if (!batch) return;

  batch.items = updater(batch.items);

  emitBatch();

}



// Human: Merge API progress into a tray row — never rewind overall % once conversion is underway.
// Agent: WRITES percent/phase; CLAMPS progress to previous when new value is lower on post-upload phases.
function applyUploadProgressUpdate(
  update: UploadProgressUpdate,
  previousProgress = 0,
  previousPhase: UploadPhase = "uploading",
): Pick<InternalUploadItem, "progress" | "phase" | "indeterminate"> {
  const isPostUpload =
    update.phase === "processing" ||
    update.phase === "encrypting" ||
    update.phase === "storing";
  const wasPostUpload =
    previousPhase === "processing" ||
    previousPhase === "encrypting" ||
    previousPhase === "storing";
  // Human: Conversion overall % should only move forward (poll noise / phase remap edge cases).
  const progress =
    isPostUpload && wasPostUpload
      ? Math.max(previousProgress, update.percent)
      : update.percent;
  return {
    progress,
    phase: update.phase,
    indeterminate: update.indeterminate === true,
  };
}

// Human: Apply tray progress only after the row holds a slot in the target post-upload stage.
// Agent: AWAITS acquirePipelineStage for processing|encrypting|storing; WRITES percent/phase on the batch row.
async function applyPipelinedProgress(uploadId: string, update: UploadProgressUpdate) {
  if (abortedUploadItemIds.has(uploadId)) return;
  if (!batch?.items.some((entry) => entry.id === uploadId && entry.status === "uploading")) {
    return;
  }
  if (
    update.phase === "processing" ||
    update.phase === "encrypting" ||
    update.phase === "storing"
  ) {
    await acquirePipelineStage(uploadId, update.phase);
  }
  if (abortedUploadItemIds.has(uploadId)) return;
  if (!batch?.items.some((entry) => entry.id === uploadId && entry.status === "uploading")) {
    return;
  }
  updateItems((items) =>
    items.map((item) =>
      item.id === uploadId
        ? {
            ...item,
            ...applyUploadProgressUpdate(update, item.progress, item.phase),
          }
        : item,
    ),
  );
}



function internalFromPersisted(item: PersistedUploadItem): InternalUploadItem {

  return {

    id: item.id,

    fileName: item.fileName,

    fileSize: item.fileSize,

    mimeType: item.mimeType,

    status: item.status,

    progress: item.progress,

    phase: item.phase,

    indeterminate: item.indeterminate,

    uploadedFileId: item.uploadedFileId,

    resumableServerSessionId: item.resumableServerSessionId,

    needsFileReselect: item.needsFileReselect,

    relativePath: item.relativePath,

    partTransport: item.partTransport,

    paused: item.paused,

    error: item.error,

  };

}



// Human: Rows that cannot resume after reload — queued rows and in-flight bytes without a server file id.

// Agent: WRITES cancelled/error terminal states; KEEPS uploading rows that already have uploadedFileId.

function reconcileRestoredItems(items: PersistedUploadItem[]): InternalUploadItem[] {

  return items.map((item) => {

    if (item.status === "queued") {

      return {

        ...internalFromPersisted(item),

        status: "cancelled",

        error: "Upload queue lost when the page was reloaded",

      };

    }

    if (item.status === "uploading" && !item.uploadedFileId) {

      if (item.resumableServerSessionId) {

        return {

          ...internalFromPersisted(item),

          resumableServerSessionId: item.resumableServerSessionId,

          status: "error",

          needsFileReselect: true,

          error: "Select the same file to continue this upload",

        };

      }

      return {

        ...internalFromPersisted(item),

        status: "error",

        error: "Upload interrupted when the page was reloaded",

      };

    }

    return internalFromPersisted(item);

  });

}



// Human: Record the server file id as soon as the upload API returns — before HLS ingest completes.

// Agent: WRITES uploadedFileId + metadata; PERSISTS via emitBatch for reload recovery.

export function registerUploadServerFile(sessionId: string, file: FileItem) {

  if (!batch) return;

  const awaitingIngest = isMediaAwaitingIngest(file);



  updateItems((items) =>

    items.map((item) =>

      item.id === sessionId

        ? {

            ...item,

            uploadedFileId: file.id,

            fileName: file.name,

            fileSize: file.size_bytes,

            mimeType: file.mime_type ?? item.mimeType,

            phase: awaitingIngest ? ("processing" as const) : item.phase,

            // Human: Keep eased post-upload percent until ingest polls replace it — do not zero the bar.
            progress: item.progress,

            indeterminate: false,

          }

        : item,

    ),

  );



  notifyFileRegistered(file);



  // Human: Ingest percent is updated by the capped resume worker — avoid a parallel GET per registered file.
  // Agent: SKIPS eager fetchFile; resumeUploadItemProcessing polls after acquirePipelineStage(processing).
}



function isMediaAwaitingIngest(file: FileItem): boolean {
  return Boolean(
    (file.mime_type?.startsWith("video/") && !file.hls_ready) ||
      (file.mime_type?.startsWith("audio/") && !file.audio_waveform_ready),
  );
}



// Human: Continue polling server ingest progress for one restored upload row.

// Agent: CALLS waitForFileIngestCompletion; WRITES done/error; NOTIFY on success.

// Human: Free a browser upload slot once bytes are on the wire — post-upload work continues separately.
// Agent: CLEARS localFile; CALLS pumpUploadQueue + pumpProcessingQueue.
function releaseUploadByteSlot(uploadId: string) {
  if (!batch) return;
  const item = batch.items.find((entry) => entry.id === uploadId);
  if (!item || item.localFile === undefined) return;

  updateItems((items) =>
    items.map((entry) =>
      entry.id === uploadId ? { ...entry, localFile: undefined } : entry,
    ),
  );
  pumpUploadQueue();
  pumpProcessingQueue();
}

// Human: Start media ingest polling for rows past byte upload — at most PIPELINE_STAGE_LIMIT workers poll at once.
// Agent: READS uploading rows with uploadedFileId; STARTS resumeUploadItemProcessing until resumingItemIds is full.
function pumpProcessingQueue() {
  if (!batch || batch.status !== "uploading") return;

  for (const item of batch.items) {
    if (resumingItemIds.size >= PIPELINE_STAGE_LIMIT) break;
    if (item.status !== "uploading" || !item.uploadedFileId || item.localFile !== undefined) {
      continue;
    }
    if (resumingItemIds.has(item.id)) continue;
    void resumeUploadItemProcessing(item);
  }
}

async function resumeUploadItemProcessing(item: InternalUploadItem) {

  if (!batch || !item.uploadedFileId || resumingItemIds.has(item.id)) return;

  resumingItemIds.add(item.id);
  emitBatch();

  const uploadId = item.id;

  const fileId = item.uploadedFileId;



  try {
    // Human: Hold a processing slot before the first GET — pipeline gates UI only, not HTTP without this.
    // Agent: AWAITS acquirePipelineStage(processing); THEN CALLS waitForFileIngestCompletion poll loop.
    await acquirePipelineStage(uploadId, "processing");

    const file = await waitForFileIngestCompletion(
      fileId,
      (update) => {
        void applyPipelinedProgress(uploadId, update);
      },
      () =>
        abortedUploadItemIds.has(uploadId) ||
        !batch?.items.some((entry) => entry.id === uploadId),
      (polled) => {
        notifyFileIngestProgress(polled);
      },
    );



    updateItems((items) =>

      items.map((entry) =>

        entry.id === uploadId

          ? {

              ...entry,

              status: "done" as const,

              progress: 100,

              phase: "storing" as const,

              indeterminate: false,

              uploadedFileId: file.id,

            }

          : entry,

      ),

    );

    notifyFileUploaded(file.id);

  } catch (error) {

    const cancelled = error instanceof ApiError && error.code === "upload_cancelled";

    const message = getErrorMessage(error);



    updateItems((items) =>

      items.map((entry) =>

        entry.id === uploadId

          ? {

              ...entry,

              status: (cancelled ? "cancelled" : "error") as UploadItemStatus,

              error: cancelled ? "Cancelled" : message,

            }

          : entry,

      ),

    );

  } finally {

    resumingItemIds.delete(uploadId);
    releaseAllPipelineStages(uploadId);
    emitBatch();

    pumpProcessingQueue();
    maybeCompleteBatch();

  }

}



async function cancelServerVideoIngest(fileId: string) {
  await cancelVideoIngest(fileId).catch(() => {
    // Human: Ignore network races when the user dismisses a stuck upload tray row.
  });
  await deleteFile(fileId).catch(() => {
    // Human: Best-effort delete after ingest cancel frees the processing guard.
  });
}

// Human: Cancel a stream rebuild without deleting the video — restores prior HLS package.
// Agent: POST cancel-reprocess; IGNORE races when the job already finished.
async function cancelServerHlsReprocess(fileId: string) {
  await cancelHlsReprocess(fileId).catch(() => {
    // Human: Job may already be done or cancelled from another tab.
  });
}

// Human: Best-effort removal of a partial server file row after the user cancels an upload.
// Agent: CALLS cancelVideoIngest+deleteFile for video; CALLS deleteFile for other mime types.
// Agent: Reprocess rows must NOT delete — use cancelServerHlsReprocess instead.
function voidCleanupPartialServerFile(fileId: string, mimeType: string) {
  if (mimeType.startsWith("video/")) {
    void cancelServerVideoIngest(fileId);
    return;
  }
  void deleteFile(fileId).catch(() => {
    // Human: Ignore races when the API row was never committed or was already deleted.
  });
}

// Human: Drop one row from the active batch and re-run the upload pump when slots open.
// Agent: FILTERS batch.items; CLEARS batch when empty; CALLS emitBatch + pumpUploadQueue.
function removeItemFromActiveBatch(itemId: string) {
  if (!batch) return;

  releaseAllPipelineStages(itemId);
  batch.items = batch.items.filter((entry) => entry.id !== itemId);
  abortedUploadItemIds.delete(itemId);

  if (batch.items.length === 0) {
    batch = null;
  } else if (batch.status === "uploading") {
    maybeCompleteBatch();
  }

  emitBatch();
  pumpUploadQueue();
}

// Human: Fallback when localStorage is empty — rebuild tray rows from active HLS encode jobs.

// Agent: GET /jobs; FILTERS hls_encode queued/running; STARTS resumeUploadItemProcessing per row.

async function restoreFromActiveBackgroundJobs(): Promise<boolean> {

  const { jobs } = await listBackgroundJobs();

  const active = jobs.filter(

    (job) =>

      job.kind === "hls_encode" &&

      (job.status === "queued" || job.status === "running") &&

      job.resource_id,

  );



  if (active.length === 0) return false;



  batch = {

    id: createClientId(),

    status: "uploading",

    folderId: null,

    items: active.map((job) => {
      const isReprocess = job.label.startsWith("Rebuild stream");
      const rawProgress = Math.min(99, Math.max(0, job.progress));
      return {
        id: createClientId(),
        fileName: isReprocess
          ? job.label.replace(/^Rebuild stream —\s*/, "") || job.label
          : job.label,
        fileSize: 0,
        mimeType: "video/",
        status: "uploading" as const,
        progress: isReprocess
          ? rawProgress
          : mapConversionProgressToOverallPercent(rawProgress),
        phase: "processing" as const,
        uploadedFileId: job.resource_id ?? undefined,
        indeterminate: rawProgress <= 0,
        isReprocess,
      };
    }),

  };

  emitBatch();



  pumpProcessingQueue();

  return true;

}



function startResumePollingForBatch() {

  if (!batch) return;

  pumpProcessingQueue();
  maybeCompleteBatch();

}



// Human: Rehydrate the upload transfer panel after a page reload.

// Agent: READS localStorage batch; RECONCILES interrupted rows; POLLS server ingest for active files.

export async function restoreUploadBatchFromStorage() {

  if (batch || restoreStarted) return;

  restoreStarted = true;



  if (typeof window === "undefined") return;



  const raw = window.localStorage.getItem(UPLOAD_BATCH_STORAGE_KEY);

  if (!raw) {

    try {

      await restoreFromActiveBackgroundJobs();

    } catch {

      // Human: Ignore auth/network errors during optional tray recovery.

    }

    return;

  }



  let persisted: PersistedUploadBatch;

  try {

    persisted = JSON.parse(raw) as PersistedUploadBatch;

  } catch {

    window.localStorage.removeItem(UPLOAD_BATCH_STORAGE_KEY);

    return;

  }



  if (!persisted.items?.length) {

    window.localStorage.removeItem(UPLOAD_BATCH_STORAGE_KEY);

    return;

  }



  batch = {

    id: persisted.id,

    status: persisted.status,

    folderId: persisted.folderId,

    items:

      persisted.status === "complete"

        ? persisted.items.map(internalFromPersisted)

        : reconcileRestoredItems(persisted.items),

  };

  emitBatch();



  if (batch.status === "complete") return;



  startResumePollingForBatch();

}



// Human: Claim the next queued row synchronously so parallel workers never double-start a file.

// Agent: READS batch.items; RETURNS claimed internal row or null when queue is empty.

function claimNextQueued(): InternalUploadItem | null {

  if (!batch) return null;

  const index = batch.items.findIndex(
    (item) => item.status === "queued" && !item.paused,
  );

  if (index === -1) return null;



  const claimed: InternalUploadItem = {

    ...batch.items[index]!,

    status: "uploading",

    progress: 0,

    phase: "uploading",

  };

  batch.items = batch.items.map((item, itemIndex) =>

    itemIndex === index ? claimed : item,

  );

  emitBatch();

  return claimed;

}



function isTerminalStatus(status: UploadItemStatus): boolean {

  return status === "done" || status === "error" || status === "cancelled";

}



// Human: Mark the batch complete when every row reached a terminal state.
// Agent: READS batch.items; WRITES status complete; EMITS snapshot.
function maybeCompleteBatch() {

  if (!batch || batch.status !== "uploading") return;

  if (batch.items.every((item) => isTerminalStatus(item.status))) {

    batch.status = "complete";

    emitBatch();

  }

}



// Human: Pause between upload retries so rate-limited requests do not stampede the API.
// Agent: RETURNS Promise resolved after delayMs; USED by uploadClaimedItem backoff.
function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

// Human: Extend the global upload pause when any worker hits 429 — other slots wait too.
// Agent: WRITES uploadPumpPausedUntil; MAX with existing deadline so overlapping 429s use the longest wait.
function pauseUploadPumpFor(delayMs: number) {
  uploadPumpPausedUntil = Math.max(uploadPumpPausedUntil, Date.now() + delayMs);
}

// Human: Block pump/retry until the coordinated rate-limit pause expires.
// Agent: READS uploadPumpPausedUntil; AWAITS sleep when still in the future.
async function waitForUploadPumpUnpause() {
  const waitMs = uploadPumpPausedUntil - Date.now();
  if (waitMs > 0) {
    await sleepMs(waitMs);
  }
}

// Human: Detect transient upload failures worth retrying (429 throttle, storage pressure, or dropped connection).
// Agent: READS ApiError status/code; RETURNS true for rate_limited, storage_error, and network_error.
function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "upload_cancelled") return false;
  return (
    error.status === 429 ||
    error.code === "rate_limited" ||
    error.code === "storage_error" ||
    error.code === "network_error"
  );
}

// Human: Backoff delay for retry attempt N (1-based), capped to avoid multi-minute stalls.
// Agent: RETURNS ms in [UPLOAD_RETRY_BASE_MS, UPLOAD_RETRY_MAX_MS].
function uploadRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(UPLOAD_RETRY_MAX_MS, UPLOAD_RETRY_BASE_MS * 2 ** exponent);
}

// Human: Upload one claimed file and update batch progress until done or error.
// Agent: CALLS uploadFileWithProgress with sessionId=item.id; RETRIES transient 429/network errors.
async function uploadClaimedItem(claimed: InternalUploadItem, retryAttempt = 0) {
  if (!batch || !claimed.localFile) return;

  const uploadId = claimed.id;
  const folderId = claimed.folderId ?? batch.folderId;

  const pipeline = createPipelineStageGate(uploadId);

  try {
    await waitForUploadPumpUnpause();
    const result = await uploadFileWithProgress(
      claimed.localFile,
      (update) => {
        void applyPipelinedProgress(uploadId, update);
      },
      {
        folderId,
        sessionId: uploadId,
        contentHash: claimed.contentHash,
        resumableServerSessionId: claimed.resumableServerSessionId,
        onResumableSessionReady: (serverSessionId) => {
          updateItems((items) =>
            items.map((item) =>
              item.id === uploadId
                ? { ...item, resumableServerSessionId: serverSessionId }
                : item,
            ),
          );
        },
        onPartTransport: (transport) => {
          updateItems((items) =>
            items.map((item) =>
              item.id === uploadId ? { ...item, partTransport: transport } : item,
            ),
          );
        },
        deferIngest: true,
        onUploadBytesComplete: () => releaseUploadByteSlot(uploadId),
        onServerFileRegistered: (file) => registerUploadServerFile(uploadId, file),
        acquirePipelineStage: pipeline.acquire,
        releasePipelineStages: pipeline.releaseAll,
      },
    );

    const uploadedFileId = result?.file?.id;
    if (!uploadedFileId) {
      throw new Error("Upload finished but the server response was missing file metadata.");
    }

    releaseUploadByteSlot(uploadId);

    if (isMediaAwaitingIngest(result.file)) {
      pumpProcessingQueue();
      return;
    }

    updateItems((items) =>
      items.map((item) =>
        item.id === uploadId
          ? {
              ...item,
              status: "done" as const,
              progress: 100,
              phase: "storing" as const,
              indeterminate: false,
              uploadedFileId,
            }
          : item,
      ),
    );
    notifyFileUploaded(uploadedFileId);
    pipeline.releaseAll();
  } catch (error) {
    pipeline.releaseAll();
    const cancelled = error instanceof ApiError && error.code === "upload_cancelled";
    if (
      !cancelled &&
      isRetryableUploadError(error) &&
      retryAttempt < UPLOAD_MAX_RETRIES
    ) {
      const nextAttempt = retryAttempt + 1;
      const retryAfterMs =
        error instanceof ApiError && error.retryAfterSeconds
          ? error.retryAfterSeconds * 1000
          : uploadRetryDelayMs(nextAttempt);
      if (error instanceof ApiError && error.status === 429) {
        pauseUploadPumpFor(retryAfterMs);
      }
      updateItems((items) =>
        items.map((item) =>
          item.id === uploadId
            ? {
                ...item,
                status: "uploading" as const,
                phase: "uploading" as const,
                indeterminate: true,
                error: `Waiting to retry (${nextAttempt}/${UPLOAD_MAX_RETRIES})…`,
              }
            : item,
        ),
      );
      await waitForUploadPumpUnpause();
      if (!batch || batch.items.find((item) => item.id === uploadId)?.status === "cancelled") {
        return;
      }
      return uploadClaimedItem(claimed, nextAttempt);
    }

    const message = getErrorMessage(error);
    const reservedSessionId =
      batch?.items.find((item) => item.id === uploadId)?.resumableServerSessionId ??
      claimed.resumableServerSessionId;
    updateItems((items) =>
      items.map((item) =>
        item.id === uploadId
          ? {
              ...item,
              status: (cancelled ? "cancelled" : "error") as UploadItemStatus,
              error: cancelled ? "Cancelled" : message,
              // Human: Terminal failure must drop the server reservation or the next picker check
              // sees quota as already spent (e.g. 2.8 GB reserved of a 5 GB account).
              resumableServerSessionId: cancelled ? item.resumableServerSessionId : null,
            }
          : item,
      ),
    );
    if (!cancelled && reservedSessionId) {
      void abortResumableUploadSession(reservedSessionId).catch(() => {
        // Human: Best-effort — stale reservations also expire after SESSION_IDLE_HOURS.
      });
    }
  }
}



// Human: Count browser uploads in flight — excludes ingest-only resume rows (no local File).

// Agent: READS batch.items status uploading + localFile; USED by pumpUploadQueue for slot limits.

function countInFlightBrowserUploads(): number {

  if (!batch) return 0;

  return batch.items.filter(

    (item) => item.status === "uploading" && item.localFile !== undefined,

  ).length;

}



// Human: Finish the batch when nothing is queued or still uploading (browser or ingest resume).

// Agent: CALLS maybeCompleteBatch when queue and in-flight rows are both empty.

function maybeCompleteBatchWhenIdle() {

  if (!batch || batch.status !== "uploading") return;

  const stillQueued = batch.items.some((item) => item.status === "queued");

  const stillUploading = batch.items.some((item) => item.status === "uploading");

  if (!stillQueued && !stillUploading) {

    maybeCompleteBatch();

  }

}



// Human: Start queued uploads until MAX_CONCURRENT_UPLOADS browser slots are in use.

// Agent: CLAIMS synchronously in a loop; on each finish RE-CALLS pump so appended files start immediately.

function pumpUploadQueue() {
  if (!batch || batch.status !== "uploading") return;
  if (userUploadPaused) return;

  void (async () => {
    await waitForUploadPumpUnpause();
    if (!batch || batch.status !== "uploading" || userUploadPaused) return;

    const fileSlots = Math.min(
      ADAPTIVE_FILE_SLOTS_CAP(),
      suggestedFileConcurrency(),
    );
    while (countInFlightBrowserUploads() < fileSlots) {
      const claimed = claimNextQueued();
      if (!claimed) break;

      void uploadClaimedItem(claimed).finally(() => {
        pumpUploadQueue();
        pumpProcessingQueue();
        maybeCompleteBatchWhenIdle();
      });
    }
  })();
}

// Human: Pause claiming new uploads (in-flight parts finish); resume restarts the pump.
// Agent: SETS userUploadPaused; USED by transfer panel Pause/Resume.
export function setUploadBatchPaused(paused: boolean) {
  userUploadPaused = paused;
  if (!paused) {
    pumpUploadQueue();
  }
  emitBatch();
}

export function isUploadBatchPaused(): boolean {
  return userUploadPaused;
}

// Human: Pause or resume one queued file without cancelling in-flight work.
// Agent: SETS item.paused; pump skips paused queued rows.
export function setUploadItemPaused(itemId: string, paused: boolean) {
  if (!batch) return;
  updateItems((items) =>
    items.map((item) =>
      item.id === itemId && item.status === "queued" ? { ...item, paused } : item,
    ),
  );
  if (!paused) {
    pumpUploadQueue();
  }
}



// Human: Subscribe to the active upload batch snapshot for the floating transfer panel.

// Agent: CALLS listener immediately; RETURNS unsubscribe function.

export function subscribeUploadBatch(listener: UploadBatchListener) {

  batchListeners.add(listener);

  listener(readUploadBatchSnapshot());

  return () => {

    batchListeners.delete(listener);

  };

}



// Human: Subscribe to each successfully uploaded file id for silent drive refresh.

// Agent: CALLS listener when a row reaches done; USED by DrivePage listing refresh.

export function subscribeUploadFileComplete(listener: UploadFileListener) {

  fileListeners.add(listener);

  return () => {

    fileListeners.delete(listener);

  };

}



// Human: Subscribe when the server registers an uploaded file — before ingest completes.

// Agent: CALLS listener with FileItem from POST /files/upload; USED by DrivePage silent refresh.

export function subscribeUploadFileRegistered(listener: UploadFileRegisteredListener) {

  fileRegisteredListeners.add(listener);

  return () => {

    fileRegisteredListeners.delete(listener);

  };

}

// Human: Subscribe to intermediate ingest polls so the drive grid can show live conversion %.
// Agent: CALLS listener with each fetchFile row from waitForFileIngestCompletion; USED by DrivePage.
export function subscribeUploadFileIngestProgress(listener: UploadFileRegisteredListener) {
  fileIngestProgressListeners.add(listener);
  return () => {
    fileIngestProgressListeners.delete(listener);
  };
}

// Human: Ensure a transfer-panel batch exists so rebuild rows can appear without a new upload.
// Agent: CREATES uploading batch when missing or complete; RETURNS active InternalUploadBatch.
function ensureUploadingBatch(): InternalUploadBatch {
  if (batch && batch.status === "uploading") {
    return batch;
  }
  batch = {
    id: createClientId(),
    status: "uploading",
    folderId: null,
    items: batch?.status === "complete" ? [...batch.items] : [],
  };
  return batch;
}

// Human: Add HLS stream rebuild rows to the transfer tray and start ingest polling.
// Agent: DEDUPES by uploadedFileId; WRITES isReprocess items; CALLS pumpProcessingQueue.
export function trackHlsReprocessFiles(
  files: Array<
    Pick<FileItem, "id" | "name" | "size_bytes" | "mime_type" | "conversion_progress">
  >,
): void {
  if (files.length === 0) return;

  const active = ensureUploadingBatch();
  let added = 0;

  for (const file of files) {
    const alreadyTracked = active.items.some(
      (item) =>
        item.uploadedFileId === file.id &&
        (item.status === "uploading" || item.status === "queued"),
    );
    if (alreadyTracked) continue;

    const rawProgress = Math.min(99, Math.max(0, file.conversion_progress ?? 0));
    active.items.push({
      id: createClientId(),
      fileName: file.name,
      fileSize: file.size_bytes,
      mimeType: file.mime_type ?? "video/",
      status: "uploading",
      progress: rawProgress,
      phase: "processing",
      uploadedFileId: file.id,
      indeterminate: rawProgress <= 0,
      isReprocess: true,
    });
    added += 1;
  }

  if (added === 0) return;

  active.status = "uploading";
  emitBatch();
  pumpProcessingQueue();
}

// Human: Pull active HLS encode jobs into the transfer tray (rebuild-all + page recovery).
// Agent: GET /jobs; TRACKS missing resource_ids via trackHlsReprocessFiles-style rows.
export async function trackActiveHlsEncodeJobs(): Promise<number> {
  const { jobs } = await listBackgroundJobs();
  const active = jobs.filter(
    (job) =>
      job.kind === "hls_encode" &&
      (job.status === "queued" || job.status === "running") &&
      job.resource_id,
  );
  if (active.length === 0) return 0;

  const batchActive = ensureUploadingBatch();
  let added = 0;

  for (const job of active) {
    const fileId = job.resource_id!;
    const alreadyTracked = batchActive.items.some(
      (item) =>
        item.uploadedFileId === fileId &&
        (item.status === "uploading" || item.status === "queued"),
    );
    if (alreadyTracked) continue;

    const isReprocess = job.label.startsWith("Rebuild stream");
    const rawProgress = Math.min(99, Math.max(0, job.progress));
    batchActive.items.push({
      id: createClientId(),
      fileName: isReprocess
        ? job.label.replace(/^Rebuild stream —\s*/, "") || job.label
        : job.label,
      fileSize: 0,
      mimeType: "video/",
      status: "uploading",
      progress: isReprocess
        ? rawProgress
        : mapConversionProgressToOverallPercent(rawProgress),
      phase: "processing",
      uploadedFileId: fileId,
      indeterminate: rawProgress <= 0,
      isReprocess,
    });
    added += 1;
  }

  if (added === 0) return 0;

  batchActive.status = "uploading";
  emitBatch();
  pumpProcessingQueue();
  return added;
}

export type UploadBatchEntry = {
  file: File;
  /** Target folder for this row — falls back to the batch default when omitted. */
  folderId?: string | null;
  /** Relative path within a folder upload (for transfer panel grouping). */
  relativePath?: string;
  /** Precomputed content hash from the upload dialog conflict check. */
  contentHash?: string;
};

// Human: Map picked files into queued upload rows for the active batch.

// Agent: WRITES per-item folderId so later batches can target a different folder than the first.

function queuedItemsFromEntries(
  entries: UploadBatchEntry[],
  defaultFolderId: string | null,
): InternalUploadItem[] {
  return entries.map(({ file, folderId, relativePath, contentHash }) => ({
    id: createClientId(),
    localFile: file,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    folderId: folderId ?? defaultFolderId,
    relativePath,
    contentHash,
    status: "queued" as const,
    progress: 0,
    phase: "uploading" as const,
  }));
}



// Human: Queue a new upload batch and start background workers — returns immediately.

// Agent: APPENDS when a batch is already uploading; REPLACES completed/cleared batches; CALLS pumpUploadQueue.

export function startUploadBatch(entries: UploadBatchEntry[], defaultFolderId: string | null) {
  if (entries.length === 0) return;

  const newItems = queuedItemsFromEntries(entries, defaultFolderId);



  if (batch?.status === "uploading") {

    batch.items = [...batch.items, ...newItems];

    emitBatch();

    pumpUploadQueue();

    return;

  }



  batch = {

    id: createClientId(),

    status: "uploading",

    folderId: defaultFolderId,

    items: newItems,

  };

  emitBatch();

  pumpUploadQueue();

}



// Human: Clear a finished upload batch from the transfer panel after the user dismisses it.

// Agent: SETS batch null; EMITS null snapshot; NO-OP while status is uploading.

export function dismissUploadBatch() {

  if (!batch || batch.status === "uploading") return;

  batch = null;

  emitBatch();

}



// Human: Re-attach the same file after reload so byte upload can resume from the server session.
// Agent: VALIDATES name + size; WRITES localFile; RESTARTS pumpUploadQueue when match succeeds.
export function reattachUploadFile(uploadId: string, file: File): boolean {
  if (!batch) return false;

  const item = batch.items.find((entry) => entry.id === uploadId);
  if (!item?.needsFileReselect || !item.resumableServerSessionId) return false;
  if (file.name !== item.fileName || file.size !== item.fileSize) return false;

  updateItems((items) =>
    items.map((entry) =>
      entry.id === uploadId
        ? {
            ...entry,
            localFile: file,
            status: "uploading",
            phase: "uploading",
            progress: 0,
            indeterminate: false,
            error: undefined,
            needsFileReselect: false,
          }
        : entry,
    ),
  );

  if (batch.status !== "uploading") {
    batch.status = "uploading";
    emitBatch();
  }

  pumpUploadQueue();
  return true;
}

// Human: Drop one failed or cancelled row from the upload panel and delete any partial server file.

// Agent: REMOVES item from batch; CALLS voidCleanupPartialServerFile when uploadedFileId set.

export function removeUploadBatchItem(itemId: string) {

  if (!batch) return;



  const item = batch.items.find((entry) => entry.id === itemId);

  if (!item || (item.status !== "error" && item.status !== "cancelled")) return;



  if (item.uploadedFileId) {

    voidCleanupPartialServerFile(item.uploadedFileId, item.mimeType);

  }



  removeItemFromActiveBatch(itemId);

}



export function getUploadBatch(): UploadBatchSnapshot | null {

  return readUploadBatchSnapshot();

}

// Human: Server file ids the upload manager is already polling for ingest — drive grid should not duplicate.
// Agent: READS batch uploading rows with uploadedFileId; RETURNS Set for DrivePage processing poll filter.
export function getUploadManagedIngestFileIds(): ReadonlySet<string> {
  if (!batch) return new Set();
  const ids = new Set<string>();
  for (const item of batch.items) {
    if (item.status === "uploading" && item.uploadedFileId) {
      ids.add(item.uploadedFileId);
    }
  }
  return ids;
}

export type UploadBatchDisplayCounts = {
  total: number;
  inFlight: number;
  waiting: number;
  uploadingBytes: number;
  processing: number;
  encrypting: number;
  storing: number;
  done: number;
  failed: number;
  cancelled: number;
};

// Human: Pipeline-aware tray totals — "active" is in-flight workers only, not the whole backlog.
// Agent: READS UploadItemSnapshot displayBucket + phase; RETURNS per-stage counts for header badges.
export function getUploadBatchDisplayCounts(
  items: UploadItemSnapshot[],
): UploadBatchDisplayCounts {
  const counts: UploadBatchDisplayCounts = {
    total: items.length,
    inFlight: 0,
    waiting: 0,
    uploadingBytes: 0,
    processing: 0,
    encrypting: 0,
    storing: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const item of items) {
    if (item.displayBucket === "done") {
      counts.done += 1;
      continue;
    }
    if (item.displayBucket === "error") {
      counts.failed += 1;
      continue;
    }
    if (item.displayBucket === "cancelled") {
      counts.cancelled += 1;
      continue;
    }
    if (item.displayBucket === "queued") {
      counts.waiting += 1;
      continue;
    }

    counts.inFlight += 1;
    if (item.phase === "encrypting") {
      counts.encrypting += 1;
    } else if (item.phase === "storing") {
      counts.storing += 1;
    } else if (item.phase === "processing") {
      counts.processing += 1;
    } else {
      counts.uploadingBytes += 1;
    }
  }

  return counts;
}

// Human: Overall tray percent — average of each file including in-flight conversion progress.
// Agent: done/error/cancelled = 100; queued = 0; active = item.progress (full pipeline for media).
export function getUploadBatchOverallPercent(items: UploadItemSnapshot[]): number {
  if (items.length === 0) return 0;
  let sum = 0;
  for (const item of items) {
    if (item.displayBucket === "done") {
      sum += 100;
      continue;
    }
    if (item.displayBucket === "error" || item.displayBucket === "cancelled") {
      sum += 100;
      continue;
    }
    if (item.displayBucket === "queued") {
      sum += 0;
      continue;
    }
    sum += Math.min(99, Math.max(0, item.progress));
  }
  return Math.round(sum / items.length);
}



// Human: Cancel one queued or in-flight file — abort transfer, delete partial server row, remove from tray.

// Agent: QUEUED → drop row; UPLOADING → abortUploadSession + voidCleanupPartialServerFile; REMOVES item.
// Agent: isReprocess rows cancel rebuild only (restore package) — never delete the file.

export function cancelUploadItem(itemId: string) {

  if (!batch || batch.status !== "uploading") return;



  const item = batch.items.find((entry) => entry.id === itemId);

  if (!item || item.status === "done") return;



  abortedUploadItemIds.add(itemId);

  // Human: Stream rebuild cancel restores prior HLS — do not run first-time ingest delete path.
  // Agent: CALLS cancelHlsReprocess; MARKS row cancelled in tray; KEEPS file id.
  if (item.isReprocess) {
    if (item.uploadedFileId) {
      void cancelServerHlsReprocess(item.uploadedFileId);
    }
    updateItems((items) =>
      items.map((entry) =>
        entry.id === itemId
          ? {
              ...entry,
              status: "cancelled" as const,
              error: "Cancelled",
              indeterminate: false,
            }
          : entry,
      ),
    );
    releaseAllPipelineStages(itemId);
    resumingItemIds.delete(itemId);
    maybeCompleteBatch();
    pumpProcessingQueue();
    return;
  }

  if (item.status === "uploading") {

    // Human: Abort active XHR even after the byte slot was released — generic rows may still await the HTTP response.
    // Agent: CALLS abortUploadSession by session id; THEN deletes partial server rows when registered.
    abortUploadSession(itemId, {

      fileId: item.uploadedFileId,

      mimeType: item.mimeType,

    });

    if (item.uploadedFileId) {

      voidCleanupPartialServerFile(item.uploadedFileId, item.mimeType);

    }

  } else if (item.uploadedFileId) {

    voidCleanupPartialServerFile(item.uploadedFileId, item.mimeType);

  }



  removeItemFromActiveBatch(itemId);

}



// Human: Cancel every queued or in-flight row in the active batch.

// Agent: BULK-cancels rebuild rows via cancelAllPendingHlsReprocess; per-row for normal uploads.

export function cancelAllUploadItems() {

  if (!batch || batch.status !== "uploading") return;



  const pending = batch.items.filter(
    (entry) => entry.status === "queued" || entry.status === "uploading",
  );
  if (pending.length === 0) return;

  const hasReprocess = pending.some((entry) => entry.isReprocess);
  if (hasReprocess) {
    // Human: One API call stops every unfinished rebuild (including ones not yet in the tray).
    // Agent: AWAITS cancelAllPendingHlsReprocess; THEN cancels remaining non-rebuild rows.
    void cancelAllPendingHlsReprocess().finally(() => {
      if (!batch) return;
      const remaining = batch.items
        .filter(
          (entry) =>
            !entry.isReprocess &&
            (entry.status === "queued" || entry.status === "uploading"),
        )
        .map((entry) => entry.id);
      for (const itemId of remaining) {
        cancelUploadItem(itemId);
      }
    });
    return;
  }

  for (const item of pending) {
    cancelUploadItem(item.id);
  }

}

// Human: Cancel every unfinished stream rebuild in the tray and on the server.
// Agent: POST cancel-reprocess-all; MARKS isReprocess uploading rows cancelled; RETURNS API counts.
export async function cancelAllPendingHlsReprocess(): Promise<{
  cancelled_files: number;
  cancelled_jobs: number;
}> {
  const result = await cancelAllHlsReprocess();

  if (batch) {
    const pendingReprocess = batch.items.filter(
      (entry) =>
        entry.isReprocess &&
        (entry.status === "uploading" || entry.status === "queued"),
    );
    for (const item of pendingReprocess) {
      abortedUploadItemIds.add(item.id);
      releaseAllPipelineStages(item.id);
      resumingItemIds.delete(item.id);
    }
    updateItems((items) =>
      items.map((entry) =>
        entry.isReprocess &&
        (entry.status === "uploading" || entry.status === "queued")
          ? {
              ...entry,
              status: "cancelled" as const,
              error: "Cancelled",
              indeterminate: false,
            }
          : entry,
      ),
    );
    maybeCompleteBatch();
  }

  return result;
}

// Human: Drop finished/cancelled rebuild tray rows after a bulk cancel so the panel can dismiss.
// Agent: FILTERS isReprocess cancelled rows; CALLS maybeCompleteBatch.
export function clearCancelledHlsReprocessItems(): void {
  if (!batch) return;
  batch.items = batch.items.filter(
    (entry) => !(entry.isReprocess && entry.status === "cancelled"),
  );
  if (batch.items.length === 0) {
    batch = null;
  } else {
    maybeCompleteBatch();
  }
  emitBatch();
}

// Human: Re-queue one failed/cancelled upload that still has a local File handle.
// Agent: RESETS status to queued; CLEARS error/progress; REOPENS batch to uploading; CALLS pumpUploadQueue.
export function retryUploadItem(itemId: string): boolean {
  if (!batch) return false;

  const item = batch.items.find((entry) => entry.id === itemId);
  if (!item) return false;
  if (item.status !== "error" && item.status !== "cancelled") return false;
  if (!item.localFile || item.needsFileReselect) return false;

  abortedUploadItemIds.delete(itemId);

  updateItems((items) =>
    items.map((entry) =>
      entry.id === itemId
        ? {
            ...entry,
            status: "queued" as const,
            progress: 0,
            phase: "uploading" as const,
            indeterminate: false,
            error: undefined,
            uploadedFileId: undefined,
          }
        : entry,
    ),
  );

  if (batch.status !== "uploading") {
    batch.status = "uploading";
    emitBatch();
  }

  pumpUploadQueue();
  return true;
}

// Human: Retry every failed row that still has local file bytes (skips reselect-required rows).
// Agent: CALLS retryUploadItem per failed entry; RETURNS how many rows were re-queued.
export function retryFailedUploadItems(): number {
  if (!batch) return 0;

  const failedIds = batch.items
    .filter(
      (entry) =>
        entry.status === "error" &&
        entry.localFile !== undefined &&
        !entry.needsFileReselect,
    )
    .map((entry) => entry.id);

  let retried = 0;
  for (const itemId of failedIds) {
    if (retryUploadItem(itemId)) retried += 1;
  }
  return retried;
}

export const UPLOAD_MANAGER_MAX_CONCURRENT = MAX_CONCURRENT_UPLOADS;
export const UPLOAD_MANAGER_PIPELINE_STAGE_LIMIT = PIPELINE_STAGE_LIMIT;

