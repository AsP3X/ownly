// Human: In-memory upload batch registry — runs parallel uploads without blocking the drive UI.

// Agent: STORES batch queue; PERSISTS to localStorage; RESTORES server-side processing after reload.



import {

  abortUploadSession,

  ApiError,

  cancelVideoIngest,

  deleteFile,

  getErrorMessage,

  listBackgroundJobs,

  uploadFileWithProgress,

  waitForFileIngestCompletion,

  type FileItem,

  type UploadProgressUpdate,

} from "@/api/client";



export type UploadItemStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export type UploadPhase = UploadProgressUpdate["phase"];



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

  error?: string;

};



export type UploadBatchSnapshot = {

  id: string;

  status: "uploading" | "complete";

  items: UploadItemSnapshot[];

};



type UploadBatchListener = (batch: UploadBatchSnapshot | null) => void;

type UploadFileListener = (fileId: string) => void;



const MAX_CONCURRENT_UPLOADS = 3;
const UPLOAD_MAX_RETRIES = 6;
const UPLOAD_RETRY_BASE_MS = 1_500;
const UPLOAD_RETRY_MAX_MS = 30_000;

const UPLOAD_BATCH_STORAGE_KEY = "mediavault_upload_batch";

const UPLOAD_BYTES_PERCENT = 40;



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

const resumingItemIds = new Set<string>();



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

    error: item.error,

  };

}



function toBatchSnapshot(): UploadBatchSnapshot | null {

  if (!batch) return null;

  return {

    id: batch.id,

    status: batch.status,

    items: batch.items.map(toItemSnapshot),

  };

}



// Human: Mirror the active batch to localStorage so reload can reopen the transfer panel.

// Agent: WRITES mediavault_upload_batch; REMOVES key when batch is cleared.

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



function updateItems(updater: (items: InternalUploadItem[]) => InternalUploadItem[]) {

  if (!batch) return;

  batch.items = updater(batch.items);

  emitBatch();

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



  updateItems((items) =>

    items.map((item) =>

      item.id === sessionId

        ? {

            ...item,

            uploadedFileId: file.id,

            fileName: file.name,

            fileSize: file.size_bytes,

            mimeType: file.mime_type ?? item.mimeType,

            phase: isVideoAwaitingIngest(file) ? ("processing" as const) : item.phase,

            progress: isVideoAwaitingIngest(file)

              ? Math.max(item.progress, UPLOAD_BYTES_PERCENT)

              : item.progress,

          }

        : item,

    ),

  );

}



function isVideoAwaitingIngest(file: FileItem): boolean {

  return Boolean(file.mime_type?.startsWith("video/") && !file.hls_ready);

}



// Human: Continue polling server ingest progress for one restored upload row.

// Agent: CALLS waitForFileIngestCompletion; WRITES done/error; NOTIFY on success.

async function resumeUploadItemProcessing(item: InternalUploadItem) {

  if (!batch || !item.uploadedFileId || resumingItemIds.has(item.id)) return;



  resumingItemIds.add(item.id);

  const uploadId = item.id;

  const fileId = item.uploadedFileId;



  try {

    const file = await waitForFileIngestCompletion(fileId, (update) => {

      updateItems((items) =>

        items.map((entry) =>

          entry.id === uploadId

            ? {

                ...entry,

                progress: update.percent,

                phase: update.phase,

                indeterminate: update.indeterminate,

              }

            : entry,

        ),

      );

    });



    updateItems((items) =>

      items.map((entry) =>

        entry.id === uploadId

          ? {

              ...entry,

              status: "done" as const,

              progress: 100,

              phase: "processing" as const,

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

    id: crypto.randomUUID(),

    status: "uploading",

    folderId: null,

    items: active.map((job) => ({

      id: crypto.randomUUID(),

      fileName: job.label,

      fileSize: 0,

      mimeType: "video/",

      status: "uploading" as const,

      progress: Math.max(UPLOAD_BYTES_PERCENT, job.progress),

      phase: "processing" as const,

      uploadedFileId: job.resource_id ?? undefined,

      indeterminate: job.progress <= 0,

    })),

  };

  emitBatch();



  for (const item of batch.items) {

    if (item.uploadedFileId) {

      void resumeUploadItemProcessing(item);

    }

  }



  return true;

}



function startResumePollingForBatch() {

  if (!batch) return;



  for (const item of batch.items) {

    if (item.status === "uploading" && item.uploadedFileId) {

      void resumeUploadItemProcessing(item);

    }

  }



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

  const index = batch.items.findIndex((item) => item.status === "queued");

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

// Human: Detect transient upload failures worth retrying (429 throttle or dropped connection).
// Agent: READS ApiError status/code; RETURNS true for rate_limited and network_error.
function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "upload_cancelled") return false;
  return error.status === 429 || error.code === "rate_limited" || error.code === "network_error";
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

  try {
    const result = await uploadFileWithProgress(
      claimed.localFile,
      (update) => {
        updateItems((items) =>
          items.map((item) =>
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
      },
      {
        folderId,
        sessionId: uploadId,
        onServerFileRegistered: (file) => registerUploadServerFile(uploadId, file),
      },
    );

    const uploadedFileId = result?.file?.id;
    if (!uploadedFileId) {
      throw new Error("Upload finished but the server response was missing file metadata.");
    }

    updateItems((items) =>
      items.map((item) =>
        item.id === uploadId
          ? {
              ...item,
              status: "done" as const,
              progress: 100,
              phase: "processing" as const,
              indeterminate: false,
              uploadedFileId,
            }
          : item,
      ),
    );
    notifyFileUploaded(uploadedFileId);
  } catch (error) {
    const cancelled = error instanceof ApiError && error.code === "upload_cancelled";
    if (
      !cancelled &&
      isRetryableUploadError(error) &&
      retryAttempt < UPLOAD_MAX_RETRIES
    ) {
      const nextAttempt = retryAttempt + 1;
      const delayMs = uploadRetryDelayMs(nextAttempt);
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
      await sleepMs(delayMs);
      if (!batch || batch.items.find((item) => item.id === uploadId)?.status === "cancelled") {
        return;
      }
      return uploadClaimedItem(claimed, nextAttempt);
    }

    const message = getErrorMessage(error);
    updateItems((items) =>
      items.map((item) =>
        item.id === uploadId
          ? {
              ...item,
              status: (cancelled ? "cancelled" : "error") as UploadItemStatus,
              error: cancelled ? "Cancelled" : message,
            }
          : item,
      ),
    );
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



  while (countInFlightBrowserUploads() < MAX_CONCURRENT_UPLOADS) {

    const claimed = claimNextQueued();

    if (!claimed) break;



    void uploadClaimedItem(claimed).finally(() => {

      pumpUploadQueue();

      maybeCompleteBatchWhenIdle();

    });

  }

}



// Human: Subscribe to the active upload batch snapshot for the floating transfer panel.

// Agent: CALLS listener immediately; RETURNS unsubscribe function.

export function subscribeUploadBatch(listener: UploadBatchListener) {

  batchListeners.add(listener);

  listener(toBatchSnapshot());

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



// Human: Map picked files into queued upload rows for the active batch.

// Agent: WRITES per-item folderId so later batches can target a different folder than the first.

function queuedItemsFromFiles(files: File[], folderId: string | null): InternalUploadItem[] {

  return files.map((file) => ({

    id: crypto.randomUUID(),

    localFile: file,

    fileName: file.name,

    fileSize: file.size,

    mimeType: file.type,

    folderId,

    status: "queued" as const,

    progress: 0,

    phase: "uploading" as const,

  }));

}



// Human: Queue a new upload batch and start background workers — returns immediately.

// Agent: APPENDS when a batch is already uploading; REPLACES completed/cleared batches; CALLS pumpUploadQueue.

export function startUploadBatch(files: File[], folderId: string | null) {

  if (files.length === 0) return;



  const newItems = queuedItemsFromFiles(files, folderId);



  if (batch?.status === "uploading") {

    batch.items = [...batch.items, ...newItems];

    emitBatch();

    pumpUploadQueue();

    return;

  }



  batch = {

    id: crypto.randomUUID(),

    status: "uploading",

    folderId,

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



// Human: Drop one failed or cancelled row from the upload panel and delete any partial server file.

// Agent: REMOVES item from batch; CALLS deleteFile when uploadedFileId set; CLEARS batch when empty.

export function removeUploadBatchItem(itemId: string) {

  if (!batch) return;



  const item = batch.items.find((entry) => entry.id === itemId);

  if (!item || (item.status !== "error" && item.status !== "cancelled")) return;



  if (item.uploadedFileId) {

    void deleteFile(item.uploadedFileId).catch(() => {

      // Human: Best-effort cleanup when the user dismisses a failed upload from the tray.

    });

  }



  batch.items = batch.items.filter((entry) => entry.id !== itemId);



  if (batch.items.length === 0) {

    batch = null;

  } else if (batch.status === "uploading") {

    maybeCompleteBatch();

  }



  emitBatch();

}



export function getUploadBatch(): UploadBatchSnapshot | null {

  return toBatchSnapshot();

}



// Human: Cancel one queued or in-flight file in the active upload batch.

// Agent: QUEUED → status cancelled; UPLOADING → abortUploadSession(sessionId=item.id).

export function cancelUploadItem(itemId: string) {

  if (!batch || batch.status !== "uploading") return;



  const item = batch.items.find((entry) => entry.id === itemId);

  if (!item) return;



  if (item.status === "queued") {

    updateItems((items) =>

      items.map((entry) =>

        entry.id === itemId

          ? { ...entry, status: "cancelled" as const, error: "Cancelled" }

          : entry,

      ),

    );

    maybeCompleteBatch();

    pumpUploadQueue();

    return;

  }



  if (item.status === "uploading") {

    if (item.uploadedFileId && item.mimeType.startsWith("video/")) {

      void cancelServerVideoIngest(item.uploadedFileId);

    }

    if (item.localFile) {

      abortUploadSession(itemId);

      return;

    }



    updateItems((items) =>

      items.map((entry) =>

        entry.id === itemId

          ? { ...entry, status: "cancelled" as const, error: "Cancelled" }

          : entry,

      ),

    );

    maybeCompleteBatch();

  }

}



// Human: Cancel every queued or in-flight row in the active batch.

// Agent: CALLS cancelUploadItem for each non-terminal uploading/queued row.

export function cancelAllUploadItems() {

  if (!batch || batch.status !== "uploading") return;



  const pendingIds = batch.items

    .filter((entry) => entry.status === "queued" || entry.status === "uploading")

    .map((entry) => entry.id);



  for (const itemId of pendingIds) {

    cancelUploadItem(itemId);

  }

}



export const UPLOAD_MANAGER_MAX_CONCURRENT = MAX_CONCURRENT_UPLOADS;

