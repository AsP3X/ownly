// Human: Typed fetch wrapper for the MediaVault API with JWT auth and consistent error parsing.
// Agent: READS localStorage token; EMITS Authorization header; PARSES `{ error: { code, message, fields? } }`.

import { createClientId } from "@/lib/utils-app";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, unknown>;
  /** Seconds from Retry-After when the server throttled the request (429). */
  retryAfterSeconds?: number;

  constructor(
    message: string,
    code: string,
    status: number,
    fields?: Record<string, unknown>,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function getToken(): string | null {
  return localStorage.getItem("mediavault_token");
}

// Human: Parse Retry-After from throttled API responses so upload backoff can align with the server window.
// Agent: READS header string; RETURNS integer seconds or undefined when missing/invalid.
function parseRetryAfterSeconds(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const parsed = Number.parseInt(headerValue.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const body = data as {
      error?: { code?: string; message?: string; fields?: Record<string, unknown> } | string;
    };
    const errorObject = typeof body?.error === "object" ? body.error : undefined;
    const message =
      typeof body?.error === "string"
        ? body.error
        : errorObject?.message ?? res.statusText;
    const code = errorObject?.code ?? "request_failed";
    throw new ApiError(
      message,
      code,
      res.status,
      errorObject?.fields,
      parseRetryAfterSeconds(res.headers.get("Retry-After")),
    );
  }

  return data;
}

export async function setupStatus() {
  return apiFetch("/setup/status", { cache: "no-store" }) as Promise<{ setup_complete: boolean }>;
}

export async function setupDatabaseInfo() {
  return apiFetch("/setup/database", { cache: "no-store" }) as Promise<{
    driver: string;
    database_url: string;
  }>;
}

export async function setupStorageInfo() {
  return apiFetch("/setup/storage", { cache: "no-store" }) as Promise<{
    object_storage_url: string;
    object_storage_public_url: string;
    object_storage_bucket: string;
    storage_mode: string;
  }>;
}

export async function testSetupDatabase(database_url: string) {
  return apiFetch("/setup/database/test", {
    method: "POST",
    body: JSON.stringify({ database_url }),
  }) as Promise<{ ok: boolean; driver: string }>;
}

export async function setup(body: {
  email: string;
  password: string;
  instance_name: string;
  allow_public_registration: boolean;
  require_account_activation?: boolean;
  object_storage_bucket?: string;
  default_storage_quota_gb?: number;
  database_url?: string;
}) {
  return apiFetch("/setup", {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<{
    token?: string;
    user: { id: string; email: string; role: string; enabled: boolean };
    restart_required?: boolean;
    configured_database_url?: string;
  }>;
}

export async function login(email: string, password: string) {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }) as Promise<{
    token?: string;
    user: { id: string; email: string; role: string; enabled: boolean };
  }>;
}

export async function register(email: string, password: string) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }) as Promise<{
    token?: string;
    pending_activation?: boolean;
    user: { id: string; email: string; role: string; enabled: boolean };
  }>;
}

export async function registrationSetting() {
  return apiFetch("/settings/registration") as Promise<{ allow_public_registration: boolean }>;
}

export async function fetchDashboard() {
  return apiFetch("/dashboard") as Promise<{
    instance_name: string;
    file_count: number;
    used_bytes: number;
    quota_bytes: number;
  }>;
}

export type FileItem = {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  hls_ready: boolean;
  hls_encode_status: string | null;
  hls_encode_error?: string | null;
  conversion_progress: number;
  duration_seconds?: number | null;
  /** True when an active public share link exists for this file. */
  share_public?: boolean;
};

export type VideoStreamUrlResponse = {
  url: string | null;
  hls_ready: boolean;
  conversion_progress: number;
  hls_encode_status: string | null;
  hls_encode_error?: string | null;
};

// Human: Poll a single file row including HLS transcode progress fields.
// Agent: GET /files/:id; RETURNS { file: FileItem }.
export async function fetchFile(id: string) {
  return apiFetch(`/files/${id}`) as Promise<{ file: FileItem }>;
}

// Human: Resolve the HLS playlist URL when the video is ready for in-browser playback.
// Agent: GET /files/:id/stream-url; RETURNS VideoStreamUrlResponse.
export async function fetchVideoStreamUrl(id: string) {
  return apiFetch(`/files/${id}/stream-url`) as Promise<VideoStreamUrlResponse>;
}

// Human: Default page size for paginated drive file listings.
// Agent: MATCHES backend listing::DEFAULT_LIST_LIMIT; USED by DrivePage refresh + load-more.
export const FILES_PAGE_SIZE = 200;

export type ListFilesParams = {
  q?: string;
  folder_id?: string;
  limit?: number;
  offset?: number;
  fields?: "minimal" | "full";
  type_filter?: string;
};

export type FileListResult = {
  files: FileItem[];
  total_bytes: number;
  file_count: number;
  has_more: boolean;
};

// Human: Paginated file listing for one folder, search, or library root.
// Agent: GET /files with limit/offset; REQUESTS minimal rows + optional type_filter.
export async function listFiles(params?: ListFilesParams) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.folder_id) search.set("folder_id", params.folder_id);
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  if (params?.offset !== undefined) search.set("offset", String(params.offset));
  if (params?.fields) search.set("fields", params.fields);
  if (params?.type_filter) search.set("type_filter", params.type_filter);
  const qs = search.toString();
  return apiFetch(`/files${qs ? `?${qs}` : ""}`) as Promise<FileListResult>;
}

// Human: Resolve owned files by id for Home recent/favourites without listing whole folders.
// Agent: POST /files/batch; RETURNS minimal rows with share_public when present.
export async function batchFiles(ids: string[], fields: "minimal" | "full" = "minimal") {
  return apiFetch("/files/batch", {
    method: "POST",
    body: JSON.stringify({ ids, fields }),
  }) as Promise<{ files: FileItem[] }>;
}

export type UploadNameDuplicateMatch = {
  id: string;
  name: string;
  folder_id: string | null;
  folder_name: string | null;
  size_bytes: number;
};

export type UploadNameDuplicate = {
  upload_name: string;
  existing: UploadNameDuplicateMatch[];
};

export type UploadRecycleMatchItem = {
  id: string;
  name: string;
  folder_id: string | null;
  folder_name: string | null;
  size_bytes: number;
  deleted_at: string;
  can_restore: boolean;
};

export type UploadRecycleMatch = {
  upload_name: string;
  upload_size_bytes: number;
  trashed: UploadRecycleMatchItem;
};

export type UploadCheckCandidate = {
  name: string;
  size_bytes: number;
};

// Human: Detect active-library duplicates and exact recycle-bin matches before uploading bytes.
// Agent: POST /files/check-upload-names; READS globally; MATCHES recycle rows by name + size_bytes.
export async function checkUploadNameDuplicates(files: UploadCheckCandidate[]) {
  return apiFetch("/files/check-upload-names", {
    method: "POST",
    body: JSON.stringify({ files }),
  }) as Promise<{ duplicates: UploadNameDuplicate[]; recycle_matches: UploadRecycleMatch[] }>;
}

export type FolderItem = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  /** True when an active public share link exists for this folder. */
  share_public?: boolean;
};

export type ListFoldersParams = {
  parent_id?: string;
  limit?: number;
  offset?: number;
};

// Human: Paginated folder listing at the drive root or under a parent folder id.
// Agent: GET /folders?parent_id=; OMITS parent_id query for root listing.
export async function listFolders(params?: ListFoldersParams) {
  const search = new URLSearchParams();
  if (params?.parent_id) search.set("parent_id", params.parent_id);
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  if (params?.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return apiFetch(`/folders${qs ? `?${qs}` : ""}`) as Promise<{
    folders: FolderItem[];
    folder_count: number;
    has_more: boolean;
  }>;
}

// Human: Create a folder for organizing files in the drive browser.
// Agent: POST /folders JSON { name, parent_id? }; RETURNS { folder: FolderItem }.
export async function createFolder(payload: { name: string; parent_id?: string | null }) {
  return apiFetch("/folders", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ folder: FolderItem }>;
}

export async function deleteFolder(id: string, options?: { permanent?: boolean }) {
  const query = options?.permanent ? "?permanent=true" : "";
  return apiFetch(`/folders/${id}${query}`, { method: "DELETE" });
}

export type FolderDeletionPreview = {
  file_count: number;
  subfolder_count: number;
  content_types: Array<{ kind: string; label: string; count: number }>;
  file_ids: string[];
  storage_object_count: number;
};

// Human: Summarize nested files and subfolders before confirming folder deletion.
// Agent: GET /folders/:id/deletion-preview; RETURNS mime-type counts for ConfirmDeleteDialog.
export async function fetchFolderDeletionPreview(folderId: string) {
  return apiFetch(`/folders/${folderId}/deletion-preview`) as Promise<FolderDeletionPreview>;
}

// Human: Folder archive job status — server-side zip with max deflate compression.
// Agent: POST starts job; GET polls progress; archive GET streams bytes when ready.
export type FolderDownloadStatus = {
  status: string;
  progress: number;
  ready: boolean;
  archive_name: string;
  size_bytes: number | null;
  error?: string | null;
};

export async function startFolderDownload(folderId: string) {
  return apiFetch(`/folders/${folderId}/download`, {
    method: "POST",
  }) as Promise<FolderDownloadStatus>;
}

export async function fetchFolderDownloadStatus(folderId: string) {
  return apiFetch(`/folders/${folderId}/download`) as Promise<FolderDownloadStatus>;
}

export async function cancelFolderDownloadJob(folderId: string) {
  return apiFetch(`/folders/${folderId}/download`, { method: "DELETE" });
}

export function folderDownloadArchiveUrl(folderId: string) {
  return `${API_BASE}/folders/${folderId}/download/archive`;
}

export type BulkDownloadStatus = {
  job_id: string;
  status: string;
  progress: number;
  ready: boolean;
  archive_name: string;
  size_bytes: number | null;
  error?: string | null;
};

// Human: Start a server-side zip job for multiple selected files.
// Agent: POST /files/download JSON { file_ids }; RETURNS job_id + compressing status.
export async function startBulkDownload(fileIds: string[]) {
  return apiFetch("/files/download", {
    method: "POST",
    body: JSON.stringify({ file_ids: fileIds }),
  }) as Promise<BulkDownloadStatus>;
}

export async function fetchBulkDownloadStatus(jobId: string) {
  return apiFetch(`/files/download/${jobId}`) as Promise<BulkDownloadStatus>;
}

export async function cancelBulkDownloadJob(jobId: string) {
  return apiFetch(`/files/download/${jobId}`, { method: "DELETE" });
}

export function bulkDownloadArchiveUrl(jobId: string) {
  return `${API_BASE}/files/download/${jobId}/archive`;
}

const FOLDER_ZIP_POLL_MS = 1000;

// Human: Build a compressed folder zip on the server, poll until ready, then save locally.
// Agent: POST+poll GET /folders/:id/download; FETCH archive; CALLS saveBlobAsFile with dated zip name.
export async function downloadFolderItem(
  folder: FolderItem,
  onProgress?: (update: DownloadProgressUpdate) => void,
): Promise<{ method: DownloadMethod; archiveName: string }> {
  await startFolderDownload(folder.id);

  let archiveName = `${folder.name}.zip`;
  let sizeBytes = 0;

  for (;;) {
    const status = await fetchFolderDownloadStatus(folder.id);
    archiveName = status.archive_name;

    if (status.status === "failed") {
      throw new ApiError(
        status.error ?? "Folder archive failed",
        "folder_zip_failed",
        500,
      );
    }

    const indeterminate =
      (status.status === "queued" ||
        status.status === "compressing" ||
        status.status === "processing") &&
      status.progress <= 0;
    onProgress?.({
      phase: "processing",
      percent: Math.min(99, status.progress),
      indeterminate,
      archiveName: status.archive_name,
    });

    if (status.ready) {
      sizeBytes = status.size_bytes ?? 0;
      onProgress?.({ phase: "processing", percent: 100, indeterminate: false });
      break;
    }

    await new Promise((resolve) => window.setTimeout(resolve, FOLDER_ZIP_POLL_MS));
  }

  onProgress?.({ phase: "saving", percent: 90, indeterminate: false });
  const blob = await downloadBytesWithFetch(
    folderDownloadArchiveUrl(folder.id),
    sizeBytes,
    onProgress,
    getToken(),
  );
  saveBlobAsFile(blob, archiveName);
  onProgress?.({ phase: "saving", percent: 100, indeterminate: false });
  return { method: "api-blob", archiveName };
}

// Human: Build a compressed zip for multiple selected files, poll until ready, then save locally.
// Agent: POST+poll GET /files/download/:job_id; FETCH archive; CALLS saveBlobAsFile with dated zip name.
export async function downloadBulkFiles(
  files: FileItem[],
  onProgress?: (update: DownloadProgressUpdate) => void,
  onJobStarted?: (jobId: string) => void,
): Promise<{ method: DownloadMethod; archiveName: string; jobId: string }> {
  const started = await startBulkDownload(files.map((file) => file.id));
  onJobStarted?.(started.job_id);
  let archiveName = started.archive_name;
  let sizeBytes = 0;

  for (;;) {
    const status = await fetchBulkDownloadStatus(started.job_id);
    archiveName = status.archive_name;

    if (status.status === "failed") {
      throw new ApiError(
        status.error ?? "Bulk archive failed",
        "bulk_zip_failed",
        500,
      );
    }

    const indeterminate =
      (status.status === "queued" ||
        status.status === "compressing" ||
        status.status === "processing") &&
      status.progress <= 0;
    onProgress?.({
      phase: "processing",
      percent: Math.min(99, status.progress),
      indeterminate,
      archiveName: status.archive_name,
    });

    if (status.ready) {
      sizeBytes = status.size_bytes ?? 0;
      onProgress?.({ phase: "processing", percent: 100, indeterminate: false });
      break;
    }

    await new Promise((resolve) => window.setTimeout(resolve, FOLDER_ZIP_POLL_MS));
  }

  onProgress?.({ phase: "saving", percent: 90, indeterminate: false });
  const blob = await downloadBytesWithFetch(
    bulkDownloadArchiveUrl(started.job_id),
    sizeBytes,
    onProgress,
    getToken(),
  );
  saveBlobAsFile(blob, archiveName);
  onProgress?.({ phase: "saving", percent: 100, indeterminate: false });
  return { method: "api-blob", archiveName, jobId: started.job_id };
}

export async function uploadFile(file: File) {
  return uploadFileWithProgress(file);
}

// Human: Progress snapshot for the upload dialog — network transfer vs server-side video ingest steps.
// Agent: uploading = browser→API bytes; processing = ffmpeg HLS encode; storing = Nebular PUT of segments.
export type UploadProgressUpdate = {
  phase: "uploading" | "processing" | "storing";
  percent: number;
  /** True when server work is ongoing but byte-level progress is unknown (avoids a frozen %). */
  indeterminate?: boolean;
};

// Human: Upload, encode, and storage each use their own 0–100% bar; each phase replaces the prior bar.
// Agent: uploading = XHR bytes; processing = conversion_progress 0–50; storing = conversion_progress 50–100.
const PROCESSING_ASYMPTOTE = 99.4;
const PROCESSING_DISPLAY_MAX = 99;
const PROCESSING_INDETERMINATE_MS = 2500;
const VIDEO_INGEST_POLL_MS = 1500;
/** Human: Backend writes ffmpeg progress into conversion_progress 5–50, then Nebular uploads 50–100. */
const HLS_STORAGE_PROGRESS_START = 50;

// Human: Track in-flight uploads so the transfer panel can abort XHR and video ingest polling.
// Agent: MAP sessionId → ActiveUploadSession; CALL abortUploadSession from upload-manager cancel.
type ActiveUploadSession = {
  xhr: XMLHttpRequest;
  cancelled: boolean;
  uploadedFileId: string | null;
  clearProcessingTimer: () => void;
  rejectUpload: ((error: ApiError) => void) | null;
};

const activeUploadSessions = new Map<string, ActiveUploadSession>();

// Human: Abort one in-flight upload — stops XHR, ingest poll, and removes a partial server file when known.
// Agent: SETS cancelled flag; CALLS xhr.abort; OPTIONAL deleteFile when uploadedFileId set.
export function abortUploadSession(
  sessionId: string,
  options?: { fileId?: string | null; mimeType?: string },
) {
  const session = activeUploadSessions.get(sessionId);
  const fileId = session?.uploadedFileId ?? options?.fileId ?? null;
  const mimeType = options?.mimeType ?? "";

  const cleanupPartialServerFile = () => {
    if (!fileId) return;
    if (mimeType.startsWith("video/")) {
      void cancelVideoIngest(fileId)
        .catch(() => {
          // Human: Best-effort server cancel before deleting the partial file row.
        })
        .then(() => deleteFile(fileId))
        .catch(() => {
          // Human: Best-effort cleanup after cancel during server-side processing.
        });
      return;
    }
    void deleteFile(fileId).catch(() => {
      // Human: Best-effort delete for non-video partial rows after the user dismisses upload.
    });
  };

  if (!session || session.cancelled) {
    cleanupPartialServerFile();
    return;
  }

  session.cancelled = true;
  session.clearProcessingTimer();
  session.xhr.abort();
  cleanupPartialServerFile();

  session.rejectUpload?.(new ApiError("Upload cancelled", "upload_cancelled", 0));
  activeUploadSessions.delete(sessionId);
}

export type BackgroundJobSummary = {
  id: string;
  kind: string;
  status: string;
  progress: number;
  label: string;
  error: string | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
  updated_at: string;
};

// Human: List recent background jobs for the authenticated user (restore tray after reload).
// Agent: GET /jobs; RETURNS queued/running HLS encode rows for upload progress recovery.
export async function listBackgroundJobs() {
  return apiFetch("/jobs") as Promise<{ jobs: BackgroundJobSummary[] }>;
}

function isVideoAwaitingIngest(file: FileItem): boolean {
  return Boolean(file.mime_type?.startsWith("video/") && !file.hls_ready);
}

// Human: Map server conversion_progress into separate encode vs storage bars for the upload tray.
// Agent: READS conversion_progress + hls_ready; RETURNS phase processing|storing with 0–100% display percent.
function mapVideoIngestProgressUpdate(
  file: Pick<FileItem, "conversion_progress" | "hls_ready" | "hls_encode_status">,
): UploadProgressUpdate {
  if (file.hls_ready) {
    return { phase: "storing", percent: 100, indeterminate: false };
  }

  if (file.hls_encode_status === "queued") {
    return { phase: "processing", percent: 0, indeterminate: true };
  }

  const raw = file.conversion_progress;
  if (raw >= HLS_STORAGE_PROGRESS_START) {
    const percent = Math.min(
      PROCESSING_DISPLAY_MAX,
      Math.round(((raw - HLS_STORAGE_PROGRESS_START) / HLS_STORAGE_PROGRESS_START) * 100),
    );
    return { phase: "storing", percent, indeterminate: false };
  }

  const percent = Math.min(
    PROCESSING_DISPLAY_MAX,
    Math.round((raw / HLS_STORAGE_PROGRESS_START) * 100),
  );
  return { phase: "processing", percent, indeterminate: false };
}

// Human: After multipart returns, poll files.conversion_progress until HLS ingest hits 100%.
// Agent: CALLS fetchFile; MAPS conversion_progress to processing then storing bars; THROWS on failed/cancelled.
export async function waitForFileIngestCompletion(
  fileId: string,
  onProgress?: (update: UploadProgressUpdate) => void,
  isCancelled?: () => boolean,
): Promise<FileItem> {
  for (;;) {
    if (isCancelled?.()) {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }

    const { file } = await fetchFile(fileId);

    if (isCancelled?.()) {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }

    if (file.hls_encode_status === "failed") {
      throw new ApiError(
        file.hls_encode_error ?? "Video processing failed",
        "video_ingest_failed",
        500,
      );
    }

    if (file.hls_encode_status === "cancelled") {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }

    onProgress?.(mapVideoIngestProgressUpdate(file));

    if (file.hls_ready) {
      return file;
    }

    await new Promise((resolve) => window.setTimeout(resolve, VIDEO_INGEST_POLL_MS));
  }
}

// Human: Upload one file with XMLHttpRequest so the UI can show byte-level progress.
// Agent: POST /files/upload multipart; optional folder_id + sessionId for cancel; RETURNS { file: FileItem }.
export function uploadFileWithProgress(
  file: File,
  onProgress?: (update: UploadProgressUpdate) => void,
  options?: {
    folderId?: string | null;
    sessionId?: string;
    /** Fires when the API accepted the upload and returned a file row (before HLS ingest finishes). */
    onServerFileRegistered?: (file: FileItem) => void;
  },
): Promise<{ file: FileItem }> {
  return new Promise((resolve, reject) => {
    const isVideoUpload = file.type.startsWith("video/");
    const sessionId = options?.sessionId ?? createClientId();
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    if (options?.folderId) {
      form.append("folder_id", options.folderId);
    }
    const url = `${API_BASE}/files/upload`;
    const token = getToken();

    let processingTimer: ReturnType<typeof setInterval> | null = null;
    let processingPercent = 0;
    let processingStartedAt = 0;

    const clearProcessingTimer = () => {
      if (processingTimer) {
        clearInterval(processingTimer);
        processingTimer = null;
      }
    };

    const session: ActiveUploadSession = {
      xhr,
      cancelled: false,
      uploadedFileId: null,
      clearProcessingTimer,
      rejectUpload: null,
    };
    activeUploadSessions.set(sessionId, session);

    const finishSession = () => {
      activeUploadSessions.delete(sessionId);
    };

    let settled = false;
    const fail = (error: ApiError) => {
      if (settled) return;
      settled = true;
      clearProcessingTimer();
      finishSession();
      reject(error);
    };
    session.rejectUpload = fail;

    const emitProcessing = () => {
      const elapsed = processingStartedAt > 0 ? Date.now() - processingStartedAt : 0;
      const display = Math.min(
        PROCESSING_DISPLAY_MAX,
        Math.max(0, Math.floor(processingPercent)),
      );
      const indeterminate =
        elapsed >= PROCESSING_INDETERMINATE_MS || display >= PROCESSING_DISPLAY_MAX;
      onProgress?.({ phase: "processing", percent: display, indeterminate });
    };

    // Human: After upload hits 100%, a fresh processing bar eases toward ~99% while the API stores the blob.
    // Agent: INTERVAL uses asymptotic steps from 0%; indeterminate after delay so the bar never looks frozen.
    const startProcessingPhase = () => {
      if (processingTimer) return;
      processingPercent = 0;
      processingStartedAt = Date.now();
      emitProcessing();
      processingTimer = setInterval(() => {
        processingPercent +=
          (PROCESSING_ASYMPTOTE - processingPercent) * 0.14;
        emitProcessing();
      }, 380);
    };

    onProgress?.({ phase: "uploading", percent: 0 });

    xhr.upload.addEventListener("progress", (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        const ratio = event.loaded / event.total;
        const percent = Math.min(100, Math.round(ratio * 100));
        onProgress({ phase: "uploading", percent });
        if (ratio >= 1) {
          if (isVideoUpload) {
            onProgress({
              phase: "processing",
              percent: 0,
              indeterminate: false,
            });
          } else {
            startProcessingPhase();
          }
        }
      } else if (event.loaded > 0) {
        onProgress({ phase: "uploading", percent: 50 });
      }
    });

    xhr.upload.addEventListener("load", () => {
      if (isVideoUpload) {
        onProgress?.({
          phase: "processing",
          percent: 0,
          indeterminate: false,
        });
      } else {
        startProcessingPhase();
      }
    });

    xhr.addEventListener("load", () => {
      clearProcessingTimer();
      const text = xhr.responseText;
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        const payload = data as { file: FileItem };
        session.uploadedFileId = payload.file.id;
        options?.onServerFileRegistered?.(payload.file);
        void (async () => {
          try {
            if (session.cancelled) {
              throw new ApiError("Upload cancelled", "upload_cancelled", 0);
            }
            let file = payload.file;
            if (isVideoAwaitingIngest(file)) {
              file = await waitForFileIngestCompletion(
                file.id,
                onProgress,
                () => session.cancelled,
              );
            } else {
              onProgress?.({ phase: "processing", percent: 100, indeterminate: false });
            }
            if (session.cancelled) {
              throw new ApiError("Upload cancelled", "upload_cancelled", 0);
            }
            clearProcessingTimer();
            finishSession();
            resolve({ file });
          } catch (error) {
            if (error instanceof ApiError) {
              fail(error);
              return;
            }
            fail(
              new ApiError(
                error instanceof Error ? error.message : "Upload failed",
                "upload_failed",
                0,
              ),
            );
          }
        })();
        return;
      }

      const body = data as {
        error?: { code?: string; message?: string; fields?: Record<string, unknown> } | string;
        raw?: string;
      };
      const errorObject = typeof body?.error === "object" ? body.error : undefined;
      let message =
        typeof body?.error === "string"
          ? body.error
          : errorObject?.message ?? xhr.statusText ?? "Upload failed";
      // Human: nginx returns plain 413 HTML; Nebular returns JSON — normalize for the upload dialog.
      // Agent: HTTP 413 when body exceeds client_max_body_size or storage cap.
      if (xhr.status === 413) {
        const tooLarge =
          /entity too large|payload too large|length limit|too large/i.test(message) ||
          /entity too large|payload too large/i.test(body.raw ?? "");
        if (tooLarge) {
          message =
            "This file exceeds the server upload limit. Ask your admin to raise MAX_UPLOAD_BYTES (and rebuild the stack).";
        }
      }
      const code = errorObject?.code ?? "request_failed";
      fail(
        new ApiError(
          message,
          code,
          xhr.status,
          errorObject?.fields,
          parseRetryAfterSeconds(xhr.getResponseHeader("Retry-After")),
        ),
      );
    });

    xhr.addEventListener("error", () => {
      fail(new ApiError("Network error during upload", "network_error", 0));
    });

    xhr.addEventListener("abort", () => {
      fail(new ApiError("Upload cancelled", "upload_cancelled", 0));
    });

    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(form);
  });
}

export async function deleteFile(id: string, options?: { permanent?: boolean }) {
  const query = options?.permanent ? "?permanent=true" : "";
  try {
    return await apiFetch(`/files/${id}${query}`, { method: "DELETE" });
  } catch (err) {
    // Human: Treat missing files as deleted — drive list can lag after failed ingest or retries.
    // Agent: SWALLOWS 404 from idempotent DELETE; RETHROWS other ApiError statuses.
    if (err instanceof ApiError && err.status === 404) {
      return { ok: true };
    }
    throw err;
  }
}

// Human: Stop server-side HLS ingest for a video upload the user cancelled in the transfer panel.
// Agent: POST /files/:id/cancel-ingest; WRITES job cancelled + hls_encode_status; THEN deleteFile can succeed.
export async function cancelVideoIngest(fileId: string) {
  return apiFetch(`/files/${fileId}/cancel-ingest`, { method: "POST" }) as Promise<{ ok: boolean }>;
}

export type FileDeletionPreview = {
  id: string;
  name: string;
  storage_object_count: number;
  segment_count: number | null;
};

export type BulkDeletionPreview = {
  file_count: number;
  storage_object_count: number;
  files: FileDeletionPreview[];
};

export type DeleteJobStatus = {
  job_id: string;
  status: string;
  progress: number;
  total_blobs: number;
  deleted_blobs: number;
  total_files: number;
  deleted_files: number;
  ready: boolean;
  error?: string | null;
  deleted_file_ids: string[];
};

// Human: Count storage blobs that would be purged before confirming a single-file delete.
// Agent: GET /files/:id/deletion-preview; READS segment_count-derived storage_object_count.
export async function fetchFileDeletionPreview(fileId: string) {
  return apiFetch(`/files/${fileId}/deletion-preview`) as Promise<FileDeletionPreview>;
}

// Human: Count total storage blobs for a multi-select delete confirmation dialog.
// Agent: POST /files/deletion-preview JSON { file_ids }; SUMS per-file storage_object_count.
export async function fetchBulkDeletionPreview(fileIds: string[]) {
  return apiFetch("/files/deletion-preview", {
    method: "POST",
    body: JSON.stringify({ file_ids: fileIds }),
  }) as Promise<BulkDeletionPreview>;
}

// Human: Start a background delete job with blob-level progress polling.
// Agent: POST /files/delete JSON { file_ids, permanent? }; RETURNS job_id + initial status snapshot.
export async function startDeleteJob(fileIds: string[], options?: { permanent?: boolean }) {
  return apiFetch("/files/delete", {
    method: "POST",
    body: JSON.stringify({
      file_ids: fileIds,
      permanent: options?.permanent ?? false,
    }),
  }) as Promise<DeleteJobStatus>;
}

// Human: Poll blob purge progress for an in-flight delete job.
// Agent: GET /files/delete/:job_id; READ-ONLY status for dialog progress bars.
export async function fetchDeleteJobStatus(jobId: string) {
  return apiFetch(`/files/delete/${jobId}`) as Promise<DeleteJobStatus>;
}

export type RecycleBinFileItem = {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  folder_id: string | null;
  folder_name: string | null;
  deleted_at: string;
  expires_at: string;
};

export type RecycleBinFolderItem = {
  id: string;
  name: string;
  parent_id: string | null;
  file_count: number;
  deleted_at: string;
  expires_at: string;
};

export type RecycleBinResponse = {
  files: RecycleBinFileItem[];
  folders: RecycleBinFolderItem[];
  total_count: number;
};

// Human: List top-level items in the caller's recycle bin.
// Agent: GET /recycle-bin; READS soft-deleted files and folders with expiry timestamps.
export async function fetchRecycleBin() {
  return apiFetch("/recycle-bin") as Promise<RecycleBinResponse>;
}

// Human: Preview blob counts for every file currently in the recycle bin (empty-bin confirmation).
// Agent: GET /recycle-bin/deletion-preview; SUMS storage_object_count across trashed files.
export async function fetchRecycleBinDeletionPreview() {
  return apiFetch("/recycle-bin/deletion-preview") as Promise<BulkDeletionPreview>;
}

// Human: Restore selected recycle bin files and folders back to the drive.
// Agent: POST /recycle-bin/restore JSON { file_ids, folder_ids }; CLEARS deleted_at server-side.
export async function restoreRecycleBinItems(payload: {
  file_ids: string[];
  folder_ids: string[];
}) {
  return apiFetch("/recycle-bin/restore", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ ok: boolean; restored_files: number; restored_folders: number }>;
}

// Human: Permanently purge every item currently in the recycle bin.
// Agent: DELETE /recycle-bin; CALLS storage purge for each trashed file on the server.
export async function emptyRecycleBin() {
  return apiFetch("/recycle-bin", { method: "DELETE" }) as Promise<{
    ok: boolean;
    purged_files: number;
    purged_folders: number;
  }>;
}

// Human: Move a file into a folder or back to the drive root (folder_id omitted/null).
// Agent: PATCH /files/{id} JSON { folder_id? }; RETURNS { file: FileItem }.
export async function moveFile(id: string, folderId: string | null) {
  return apiFetch(`/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ folder_id: folderId }),
  }) as Promise<{ file: FileItem }>;
}

// Human: Duplicate a file into another folder or the drive root with new storage blobs.
// Agent: POST /files/{id}/copy JSON { folder_id? }; RETURNS { file: FileItem }.
export async function copyFile(id: string, folderId: string | null) {
  return apiFetch(`/files/${id}/copy`, {
    method: "POST",
    body: JSON.stringify({ folder_id: folderId }),
  }) as Promise<{ file: FileItem }>;
}

// Human: Progress snapshot for MEGA-style downloads — byte transfer vs browser save step.
// Agent: phase downloading = XHR bytes; phase saving = blob write / anchor click.
export type DownloadProgressUpdate = {
  phase: "processing" | "downloading" | "saving";
  percent: number;
  /** True when byte progress stalls — server still streaming/decompressing. */
  indeterminate?: boolean;
  /** Folder zip jobs surface the dated archive filename while compressing. */
  archiveName?: string;
};

export type VideoExportStatus = {
  status: string;
  progress: number;
  ready: boolean;
  size_bytes: number | null;
  error?: string | null;
};

function isHlsStoredVideo(file: FileItem): boolean {
  return Boolean(file.mime_type?.startsWith("video/") && file.hls_ready);
}

function mp4DownloadFilename(name: string): string {
  if (name.toLowerCase().endsWith(".mp4")) return name;
  const dot = name.lastIndexOf(".");
  if (dot > 0) return `${name.slice(0, dot)}.mp4`;
  return `${name}.mp4`;
}

// Human: Start background HLS→MP4 remux if needed (idempotent when export already cached).
// Agent: POST /files/:id/export; RETURNS VideoExportStatus.
export async function startVideoExport(fileId: string) {
  return apiFetch(`/files/${fileId}/export`, { method: "POST" }) as Promise<VideoExportStatus>;
}

// Human: Poll export job progress for the download tray.
// Agent: GET /files/:id/export; RETURNS VideoExportStatus.
export async function fetchVideoExportStatus(fileId: string) {
  return apiFetch(`/files/${fileId}/export`) as Promise<VideoExportStatus>;
}

const EXPORT_POLL_MS = 1000;

// Human: Block until cached MP4 exists, reporting progress like upload processing.
// Agent: POST then poll GET; THROWS on failed; RETURNS export size_bytes for download progress.
export async function ensureVideoExportReady(
  file: FileItem,
  onProgress?: (update: DownloadProgressUpdate) => void,
): Promise<number> {
  await startVideoExport(file.id);

  for (;;) {
    const status = await fetchVideoExportStatus(file.id);
    const indeterminate =
      (status.status === "queued" || status.status === "processing") &&
      status.progress <= 0;
    onProgress?.({
      phase: "processing",
      percent: Math.min(99, status.progress),
      indeterminate,
    });

    if (status.ready) {
      onProgress?.({ phase: "processing", percent: 100, indeterminate: false });
      return status.size_bytes ?? file.size_bytes;
    }
    if (status.status === "failed") {
      throw new ApiError(
        status.error ?? "Video export failed",
        "export_failed",
        500,
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, EXPORT_POLL_MS));
  }
}

export type DownloadMethod = "presigned-blob" | "api-blob" | "presigned-direct";

const DOWNLOAD_PHASE_MAX = 90;
const DOWNLOAD_ASYMPTOTE = 98;
const DOWNLOAD_STALL_MS = 2000;

let activeDownloadAbort: AbortController | null = null;

// Human: Cancel an in-flight programmatic download.
// Agent: ABORTS activeDownloadAbort signal used by fetch reader loop.
export function abortActiveDownload() {
  activeDownloadAbort?.abort();
  activeDownloadAbort = null;
}

export async function fetchFileDownloadUrl(id: string) {
  return apiFetch(`/files/${id}/download-url`) as Promise<{
    url: string;
    expires_in_seconds: number;
  }>;
}

// Human: Same-origin ticket stream URL for in-browser preview — avoids localhost object-storage presigns.
// Agent: GET /files/:id/preview-url; RETURNS relative /files/:id/stream?ticket= URL for <audio>/<video> src.
export async function fetchFilePreviewUrl(id: string) {
  return apiFetch(`/files/${id}/preview-url`) as Promise<{
    url: string;
    expires_in_seconds: number;
  }>;
}

export function fileDownloadUrl(id: string) {
  return `${API_BASE}/files/${id}/download`;
}

// Human: Resolve a ticket stream or download path against the site origin for <audio> element src.
// Agent: RETURNS absolute href; CALLS window.location.origin for relative `/api/v1/...` paths.
function resolveSameOriginStreamUrl(url: string): string {
  if (url.startsWith("http")) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return new URL(path, window.location.origin).href;
}

// Human: Streamable preview URL for audio — same-origin ticket stream works when object storage is not browser-reachable.
// Agent: GET /files/:id/preview-url first; FALLBACK blob object URL when preview-url fails.
export async function fetchFileStreamUrlForPreview(
  file: FileItem,
): Promise<{ url: string; revokeOnClose: boolean }> {
  try {
    const preview = await fetchFilePreviewUrl(file.id);
    return { url: resolveSameOriginStreamUrl(preview.url), revokeOnClose: false };
  } catch {
    const blob = await fetchFileBlobForPreview(file);
    return { url: URL.createObjectURL(blob), revokeOnClose: true };
  }
}

// Human: Load file bytes for in-browser preview without triggering a save dialog.
// Agent: FETCHES /files/:id/download with JWT; FALLBACK to presigned URL; RETURNS Blob for object URLs.
export async function fetchFileBlobForPreview(file: FileItem): Promise<Blob> {
  const token = getToken();
  const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  let response = await fetch(fileDownloadUrl(file.id), { headers: authHeaders });
  if (!response.ok) {
    const presigned = await fetchFileDownloadUrl(file.id);
    response = await fetch(presigned.url);
    if (!response.ok) {
      throw new ApiError(response.statusText || "Preview failed", "preview_failed", response.status);
    }
  }

  return response.blob();
}

// Human: Trigger browser save via temporary object URL (primary MEGA-style save path).
// Agent: CREATES object URL; CLICKS hidden anchor; REVOKES URL after delay.
function saveBlobAsFile(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// Human: Last-resort download — navigate to presigned URL so the browser handles bytes (no JWT, no blob).
// Agent: OPENS url in temporary anchor; USED when XHR blob path fails (CORS/memory).
function triggerDirectUrlDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// Human: Fetch + stream reader — progress uses known file size, not server Content-Length (often wrong).
// Agent: READS body chunks; TRACKS loaded vs sizeBytes; INDETERMINATE on stall; RETURNS Blob.
async function downloadBytesWithFetch(
  url: string,
  sizeBytes: number,
  onProgress: ((update: DownloadProgressUpdate) => void) | undefined,
  authToken: string | null,
): Promise<Blob> {
  activeDownloadAbort?.abort();
  const abort = new AbortController();
  activeDownloadAbort = abort;

  onProgress?.({ phase: "downloading", percent: 0, indeterminate: false });

  const headers: HeadersInit = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(url, { headers, signal: abort.signal });
  if (!response.ok) {
    activeDownloadAbort = null;
    throw new ApiError(response.statusText || "Download failed", "download_failed", response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    activeDownloadAbort = null;
    throw new ApiError("Download stream unavailable", "download_failed", response.status);
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastLoaded = 0;
  let lastProgressAt = Date.now();
  let displayPercent = 0;

  const emitProgress = (phase: DownloadProgressUpdate["phase"], percent: number, stalled: boolean) => {
    displayPercent = percent;
    onProgress?.({ phase, percent, indeterminate: stalled });
  };

  const stallTimer = window.setInterval(() => {
    if (abort.signal.aborted) return;
    const stalledFor = Date.now() - lastProgressAt;
    if (stalledFor < DOWNLOAD_STALL_MS) return;
    if (displayPercent >= DOWNLOAD_ASYMPTOTE) {
      emitProgress("downloading", displayPercent, true);
      return;
    }
    const next = Math.min(
      DOWNLOAD_ASYMPTOTE,
      displayPercent + Math.max(1, Math.floor((DOWNLOAD_ASYMPTOTE - displayPercent) / 5)),
    );
    emitProgress("downloading", next, true);
  }, 500);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      chunks.push(value);
      loaded += value.byteLength;

      if (loaded > lastLoaded) {
        lastLoaded = loaded;
        lastProgressAt = Date.now();
      }

      if (sizeBytes > 0) {
        const ratio = loaded / sizeBytes;
        const percent = Math.min(DOWNLOAD_PHASE_MAX, Math.round(ratio * DOWNLOAD_PHASE_MAX));
        emitProgress("downloading", percent, false);
      } else if (loaded > 0) {
        emitProgress("downloading", Math.min(DOWNLOAD_PHASE_MAX - 1, 40), false);
      }
    }
  } catch (error) {
    if (abort.signal.aborted) {
      throw new ApiError("Download cancelled", "download_cancelled", 0);
    }
    throw error;
  } finally {
    window.clearInterval(stallTimer);
    activeDownloadAbort = null;
  }

  emitProgress("saving", 100, false);
  const blobParts = chunks.map((chunk) => chunk.slice());
  return new Blob(blobParts, {
    type: response.headers.get("Content-Type") ?? "application/octet-stream",
  });
}

// Human: Download with progress — API proxy first (reliable auth), presigned blob second, direct URL last.
// Agent: USES fetch stream vs file.size_bytes for progress; FALLBACK chain on failure.
export async function downloadFileItem(
  file: FileItem,
  onProgress?: (update: DownloadProgressUpdate) => void,
): Promise<{ method: DownloadMethod }> {
  const token = getToken();
  let presignedUrl: string | null = null;
  let lastError: unknown = null;

  const hlsVideo = isHlsStoredVideo(file);
  let downloadName = file.name;
  let downloadSize = file.size_bytes;

  if (hlsVideo) {
    downloadSize = await ensureVideoExportReady(file, onProgress);
    downloadName = mp4DownloadFilename(file.name);
  }

  try {
    const blob = await downloadBytesWithFetch(
      fileDownloadUrl(file.id),
      downloadSize,
      onProgress,
      token,
    );
    saveBlobAsFile(blob, downloadName);
    return { method: "api-blob" };
  } catch (error) {
    lastError = error;
    if (error instanceof ApiError && error.message.includes("cancelled")) {
      throw error;
    }
  }

  try {
    const presigned = await fetchFileDownloadUrl(file.id);
    presignedUrl = presigned.url;
    try {
      const blob = await downloadBytesWithFetch(presignedUrl, downloadSize, onProgress, null);
      saveBlobAsFile(blob, downloadName);
      return { method: "presigned-blob" };
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError && error.message.includes("cancelled")) {
        throw error;
      }
    }
  } catch (error) {
    lastError = error;
  }

  if (presignedUrl) {
    triggerDirectUrlDownload(presignedUrl, downloadName);
    onProgress?.({ phase: "saving", percent: 100, indeterminate: false });
    return { method: "presigned-direct" };
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError(getErrorMessage(lastError), "download_failed", 0);
}

export async function versionInfo() {
  return apiFetch("/version") as Promise<{ version: string; git_sha: string; environment: string }>;
}

export type PublicShareInfo = {
  resource_type: "file" | "folder";
  resource_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  hls_ready: boolean | null;
  requires_password: boolean;
  block_download: boolean;
  created_at: string;
  expires_at: string | null;
  shared_by_email: string;
  total_file_count: number;
  total_folder_count: number;
  total_bytes: number;
};

export type PublicShareDownloadArchiveStatus = {
  job_id: string;
  status: string;
  progress: number;
  ready: boolean;
  archive_name: string;
  size_bytes: number | null;
  error: string | null;
  single_file_id: string | null;
};

export type ShareLink = {
  id: string;
  token: string;
  resource_type: "file" | "folder";
  resource_id: string;
  created_at: string;
  requires_password: boolean;
  expires_at: string | null;
  block_download: boolean;
};

export type UserShare = {
  id: string;
  grantee_user_id: string;
  grantee_email: string;
  created_at: string;
};

export type ShareFlags = {
  public: boolean;
  users: boolean;
};

// Human: Build paperclip indicator maps from list rows that include share_public.
// Agent: MAPS share_public=true to ShareFlags; USED after list/batch responses.
export function buildShareFlagMaps(
  files: FileItem[],
  folders: FolderItem[],
): { files: Record<string, ShareFlags>; folders: Record<string, ShareFlags> } {
  const fileFlags: Record<string, ShareFlags> = {};
  for (const file of files) {
    if (file.share_public) {
      fileFlags[file.id] = { public: true, users: false };
    }
  }
  const folderFlags: Record<string, ShareFlags> = {};
  for (const folder of folders) {
    if (folder.share_public) {
      folderFlags[folder.id] = { public: true, users: false };
    }
  }
  return { files: fileFlags, folders: folderFlags };
}

export type ResourceSharesResponse = {
  public_share: ShareLink | null;
  user_shares: UserShare[];
};

// Human: Build the browser URL visitors use to open a public share without signing in.
// Agent: USES window.location.origin + /s/{token}; RETURNS absolute URL string.
export function publicSharePageUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/s/${token}`;
}

// Human: Create or reuse a public link for one owned file or folder.
// Agent: POST /shares; REQUIRES auth; RETURNS ShareLink with unguessable token.
export async function createPublicShare(payload: {
  resource_type: "file" | "folder";
  resource_id: string;
}) {
  return apiFetch("/shares", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ share: ShareLink }>;
}

// Human: Look up an existing active public link for a file or folder.
// Agent: GET /shares?file_id= or folder_id=; RETURNS share or null.
export async function lookupPublicShare(params: { file_id?: string; folder_id?: string }) {
  const search = new URLSearchParams();
  if (params.file_id) search.set("file_id", params.file_id);
  if (params.folder_id) search.set("folder_id", params.folder_id);
  return apiFetch(`/shares?${search.toString()}`) as Promise<{ share: ShareLink | null }>;
}

// Human: Revoke a public link so the token stops working.
// Agent: DELETE /shares/:id; REQUIRES auth.
export async function revokePublicShare(shareId: string) {
  return apiFetch(`/shares/${shareId}`, { method: "DELETE" }) as Promise<{ ok: boolean }>;
}

// Human: Persist protection settings on an active public share link.
// Agent: PATCH /shares/:id; WRITES password, expiration, and download flags.
export async function updatePublicShare(
  shareId: string,
  payload: {
    requires_password?: boolean;
    password?: string | null;
    expires_at?: string | null;
    block_download?: boolean;
  },
) {
  return apiFetch(`/shares/${shareId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }) as Promise<{ share: ShareLink }>;
}

// Human: Invite one registered user to a file or folder by email address.
// Agent: POST /shares/user; RETURNS UserShare row.
export async function inviteUserShare(payload: {
  resource_type: "file" | "folder";
  resource_id: string;
  email: string;
}) {
  return apiFetch("/shares/user", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ user_share: UserShare }>;
}

// Human: Remove one invited user from a shared resource.
// Agent: DELETE /shares/user/:id; REQUIRES owner auth.
export async function revokeUserShare(userShareId: string) {
  return apiFetch(`/shares/user/${userShareId}`, { method: "DELETE" }) as Promise<{ ok: boolean }>;
}

// Human: Optional visitor password header for protected public share routes.
// Agent: SETS X-Share-Password when provided; USED by anonymous share fetch helpers.
function publicShareRequestHeaders(sharePassword?: string | null): HeadersInit | undefined {
  if (!sharePassword) return undefined;
  return { "X-Share-Password": sharePassword };
}

// Human: Bulk check which listed files/folders have active share links (for paperclip indicators).
// Agent: POST /shares/status; RETURNS maps of ShareFlags keyed by resource id.
export async function fetchShareStatusBulk(payload: {
  file_ids?: string[];
  folder_ids?: string[];
}) {
  return apiFetch("/shares/status", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<{ files: Record<string, ShareFlags>; folders: Record<string, ShareFlags> }>;
}

// Human: Fetch all share links attached to one file or folder for the details dialog.
// Agent: GET /shares/resource?file_id= or folder_id=; RETURNS public_share + user_shares.
export async function fetchResourceShares(params: { file_id?: string; folder_id?: string }) {
  const search = new URLSearchParams();
  if (params.file_id) search.set("file_id", params.file_id);
  if (params.folder_id) search.set("folder_id", params.folder_id);
  return apiFetch(`/shares/resource?${search.toString()}`, {
    cache: "no-store",
  }) as Promise<ResourceSharesResponse>;
}

// Human: Anonymous metadata for a public share token (no Authorization header required).
// Agent: GET /public/shares/:token; RETURNS PublicShareInfo.
export async function fetchPublicShareOverview(token: string) {
  return apiFetch(`/public/shares/${encodeURIComponent(token)}`, {
    cache: "no-store",
  }) as Promise<{ share: PublicShareInfo }>;
}

// Human: Flat list of every file in a share tree (folder shares) or one file (file shares).
// Agent: GET /public/shares/:token/all-files; REQUIRES X-Share-Password when link is protected.
export async function fetchPublicShareAllFiles(token: string, sharePassword?: string | null) {
  return apiFetch(`/public/shares/${encodeURIComponent(token)}/all-files`, {
    cache: "no-store",
    headers: publicShareRequestHeaders(sharePassword),
  }) as Promise<{ files: FileItem[]; folders: FolderItem[] }>;
}

// Human: Start a zip job for multiple shared files, or get a single-file shortcut id.
// Agent: POST /public/shares/:token/download-archive; RETURNS job_id or single_file_id.
export async function startPublicShareDownloadArchive(
  token: string,
  fileIds: string[],
  sharePassword?: string | null,
) {
  return apiFetch(`/public/shares/${encodeURIComponent(token)}/download-archive`, {
    method: "POST",
    headers: publicShareRequestHeaders(sharePassword),
    body: JSON.stringify({
      file_ids: fileIds.length > 0 ? fileIds : undefined,
    }),
  }) as Promise<PublicShareDownloadArchiveStatus>;
}

// Human: Poll anonymous zip archive progress for a public share download.
// Agent: GET /public/shares/:token/download-archive/:job_id.
export async function fetchPublicShareDownloadArchiveStatus(
  token: string,
  jobId: string,
  sharePassword?: string | null,
) {
  return apiFetch(
    `/public/shares/${encodeURIComponent(token)}/download-archive/${encodeURIComponent(jobId)}`,
    { cache: "no-store", headers: publicShareRequestHeaders(sharePassword) },
  ) as Promise<PublicShareDownloadArchiveStatus>;
}

// Human: Same-origin URL for a finished public-share zip archive stream.
// Agent: RETURNS /api/v1/public/shares/:token/download-archive/:job_id/archive.
export function publicShareDownloadArchiveUrl(token: string, jobId: string): string {
  return `${API_BASE}/public/shares/${encodeURIComponent(token)}/download-archive/${encodeURIComponent(jobId)}/archive`;
}

// Human: Copy shared files into the signed-in visitor's library (Save to My Ownly).
// Agent: POST /shares/save-from-public; REQUIRES auth + optional X-Share-Password.
export async function saveFromPublicShare(payload: {
  token: string;
  file_ids?: string[];
  folder_id?: string | null;
  sharePassword?: string | null;
}) {
  return apiFetch("/shares/save-from-public", {
    method: "POST",
    headers: publicShareRequestHeaders(payload.sharePassword),
    body: JSON.stringify({
      token: payload.token,
      file_ids: payload.file_ids,
      folder_id: payload.folder_id ?? undefined,
    }),
  }) as Promise<{ saved_count: number; files: FileItem[] }>;
}

// Human: Verify a visitor password before loading protected share content.
// Agent: PROBES a scoped public route with X-Share-Password; THROWS ApiError when invalid.
export async function verifyPublicShareAccess(
  token: string,
  resourceType: "file" | "folder",
  resourceId: string,
  password: string,
) {
  if (resourceType === "folder") {
    await fetchPublicShareContents(token, resourceId, password);
    return;
  }
  await apiFetch(`/public/shares/${encodeURIComponent(token)}/files/${encodeURIComponent(resourceId)}`, {
    cache: "no-store",
    headers: publicShareRequestHeaders(password),
  });
}

// Human: List files and subfolders inside a folder-type public share at one level.
// Agent: GET /public/shares/:token/contents?folder_id=; SCOPED to shared subtree only.
export async function fetchPublicShareContents(
  token: string,
  folderId?: string | null,
  sharePassword?: string | null,
) {
  const search = new URLSearchParams();
  if (folderId) search.set("folder_id", folderId);
  const qs = search.toString();
  return apiFetch(
    `/public/shares/${encodeURIComponent(token)}/contents${qs ? `?${qs}` : ""}`,
    { cache: "no-store", headers: publicShareRequestHeaders(sharePassword) },
  ) as Promise<{
    files: FileItem[];
    folders: FolderItem[];
    total_bytes: number;
    file_count: number;
    current_folder_id: string;
    root_folder_id: string;
  }>;
}

// Human: Resolve HLS playlist URL for a video inside a public share.
// Agent: GET /public/shares/:token/files/:id/stream-url; NO auth.
export async function fetchPublicVideoStreamUrl(
  token: string,
  fileId: string,
  sharePassword?: string | null,
) {
  return apiFetch(
    `/public/shares/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/stream-url`,
    { cache: "no-store", headers: publicShareRequestHeaders(sharePassword) },
  ) as Promise<VideoStreamUrlResponse>;
}

// Human: Same-origin download URL for one file inside a public share (no JWT).
// Agent: RETURNS /api/v1/public/shares/:token/files/:id/download; USED for save-as and inline streaming.
export function publicShareFileDownloadUrl(token: string, fileId: string): string {
  return `${API_BASE}/public/shares/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/download`;
}

// Human: Parse a failed public-share fetch into ApiError for preview and download callers.
// Agent: READS response text JSON envelope; THROWS ApiError with safe message.
async function publicShareFetchError(response: Response, code: string): Promise<never> {
  const text = await response.text();
  let message = response.statusText;
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    message = body.error?.message ?? message;
  } catch {
    // keep status text
  }
  throw new ApiError(message, code, response.status);
}

// Human: Load shared file bytes for in-browser preview without triggering save-as.
// Agent: GET public download; NO auth; RETURNS Blob for object URLs and PDF viewer.
export async function fetchPublicShareBlobForPreview(
  token: string,
  fileId: string,
  sharePassword?: string | null,
): Promise<Blob> {
  const response = await fetch(publicShareFileDownloadUrl(token, fileId), {
    cache: "no-store",
    headers: publicShareRequestHeaders(sharePassword),
  });
  if (!response.ok) {
    return publicShareFetchError(response, "preview_failed");
  }
  return response.blob();
}

// Human: Streamable preview URL for shared audio — blob URL avoids attachment download quirks in <audio>.
// Agent: FETCHES public download bytes; RETURNS object URL with revokeOnClose for dialog cleanup.
export async function fetchPublicShareStreamUrlForPreview(
  token: string,
  file: FileItem,
  sharePassword?: string | null,
): Promise<{ url: string; revokeOnClose: boolean }> {
  const blob = await fetchPublicShareBlobForPreview(token, file.id, sharePassword);
  return { url: URL.createObjectURL(blob), revokeOnClose: true };
}

// Human: Download one file from a public share through the API proxy.
// Agent: GET /public/shares/:token/files/:id/download; RETURNS Blob for save-as.
export async function downloadPublicShareFile(
  token: string,
  fileId: string,
  fileName: string,
  sharePassword?: string | null,
) {
  const res = await fetch(publicShareFileDownloadUrl(token, fileId), {
    cache: "no-store",
    headers: publicShareRequestHeaders(sharePassword),
  });
  if (!res.ok) {
    return publicShareFetchError(res, "download_failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
