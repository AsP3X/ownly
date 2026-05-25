// Human: Typed fetch wrapper for the MediaVault API with JWT auth and consistent error parsing.
// Agent: READS localStorage token; EMITS Authorization header; PARSES `{ error: { code, message, fields? } }`.

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, unknown>;

  constructor(message: string, code: string, status: number, fields?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

function getToken(): string | null {
  return localStorage.getItem("mediavault_token");
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
    throw new ApiError(message, code, res.status, errorObject?.fields);
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
};

export async function listFiles(params?: { q?: string; folder_id?: string }) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.folder_id) search.set("folder_id", params.folder_id);
  const qs = search.toString();
  return apiFetch(`/files${qs ? `?${qs}` : ""}`) as Promise<{
    files: FileItem[];
    total_bytes: number;
    file_count: number;
  }>;
}

export type FolderItem = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

// Human: List folders at the drive root or under a parent folder id.
// Agent: GET /folders?parent_id=; OMITS parent_id query for root listing.
export async function listFolders(params?: { parent_id?: string }) {
  const search = new URLSearchParams();
  if (params?.parent_id) search.set("parent_id", params.parent_id);
  const qs = search.toString();
  return apiFetch(`/folders${qs ? `?${qs}` : ""}`) as Promise<{
    folders: FolderItem[];
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

export async function deleteFolder(id: string) {
  return apiFetch(`/folders/${id}`, { method: "DELETE" });
}

export async function uploadFile(file: File) {
  return uploadFileWithProgress(file);
}

// Human: Progress snapshot for the upload dialog — network transfer vs server blob processing.
// Agent: phase uploading = browser→API bytes; phase processing = API→storage + DB until response.
export type UploadProgressUpdate = {
  phase: "uploading" | "processing";
  percent: number;
  /** True when server work is ongoing but byte-level progress is unknown (avoids a frozen %). */
  indeterminate?: boolean;
};

// Human: Share of the bar reserved for each phase so processing time is visible on large files.
// Agent: uploading caps at UPLOAD_PHASE_MAX; processing eases toward PROCESSING_ASYMPTOTE until load.
const UPLOAD_PHASE_MAX = 62;
const PROCESSING_ASYMPTOTE = 99.4;
const PROCESSING_DISPLAY_MAX = 99;
const PROCESSING_INDETERMINATE_MS = 2500;

// Human: Upload one file with XMLHttpRequest so the UI can show byte-level progress.
// Agent: POST /files/upload multipart; optional folder_id field; CALLS onProgress; RETURNS { file: FileItem }.
export function uploadFileWithProgress(
  file: File,
  onProgress?: (update: UploadProgressUpdate) => void,
  options?: { folderId?: string | null },
): Promise<{ file: FileItem }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    if (options?.folderId) {
      form.append("folder_id", options.folderId);
    }
    const url = `${API_BASE}/files/upload`;
    const token = getToken();

    let processingTimer: ReturnType<typeof setInterval> | null = null;
    let processingPercent = UPLOAD_PHASE_MAX;
    let processingStartedAt = 0;

    const clearProcessingTimer = () => {
      if (processingTimer) {
        clearInterval(processingTimer);
        processingTimer = null;
      }
    };

    const fail = (error: ApiError) => {
      clearProcessingTimer();
      reject(error);
    };

    const emitProcessing = () => {
      const elapsed = processingStartedAt > 0 ? Date.now() - processingStartedAt : 0;
      const display = Math.min(
        PROCESSING_DISPLAY_MAX,
        Math.max(UPLOAD_PHASE_MAX, Math.floor(processingPercent)),
      );
      const indeterminate =
        elapsed >= PROCESSING_INDETERMINATE_MS || display >= PROCESSING_DISPLAY_MAX;
      onProgress?.({ phase: "processing", percent: display, indeterminate });
    };

    // Human: After bytes leave the browser, ease toward ~99% while the API stores/compresses the blob.
    // Agent: INTERVAL uses asymptotic steps; indeterminate after delay so the bar never looks frozen.
    const startProcessingPhase = () => {
      if (processingTimer) return;
      processingPercent = UPLOAD_PHASE_MAX;
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
        const percent = Math.min(
          UPLOAD_PHASE_MAX,
          Math.round(ratio * UPLOAD_PHASE_MAX),
        );
        onProgress({ phase: "uploading", percent });
        if (ratio >= 1) {
          startProcessingPhase();
        }
      } else if (event.loaded > 0) {
        onProgress({ phase: "uploading", percent: Math.min(UPLOAD_PHASE_MAX - 1, 40) });
      }
    });

    xhr.upload.addEventListener("load", () => {
      startProcessingPhase();
    });

    xhr.addEventListener("load", () => {
      clearProcessingTimer();
      onProgress?.({ phase: "processing", percent: 100 });
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
        resolve(data as { file: FileItem });
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
      fail(new ApiError(message, code, xhr.status, errorObject?.fields));
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

export async function deleteFile(id: string) {
  return apiFetch(`/files/${id}`, { method: "DELETE" });
}

// Human: Move a file into a folder or back to the drive root (folder_id omitted/null).
// Agent: PATCH /files/{id} JSON { folder_id? }; RETURNS { file: FileItem }.
export async function moveFile(id: string, folderId: string | null) {
  return apiFetch(`/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ folder_id: folderId }),
  }) as Promise<{ file: FileItem }>;
}

// Human: Progress snapshot for MEGA-style downloads — byte transfer vs browser save step.
// Agent: phase downloading = XHR bytes; phase saving = blob write / anchor click.
export type DownloadProgressUpdate = {
  phase: "downloading" | "saving";
  percent: number;
  /** True when byte progress stalls — server still streaming/decompressing. */
  indeterminate?: boolean;
};

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

export function fileDownloadUrl(id: string) {
  return `${API_BASE}/files/${id}/download`;
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

  try {
    const blob = await downloadBytesWithFetch(
      fileDownloadUrl(file.id),
      file.size_bytes,
      onProgress,
      token,
    );
    saveBlobAsFile(blob, file.name);
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
      const blob = await downloadBytesWithFetch(presignedUrl, file.size_bytes, onProgress, null);
      saveBlobAsFile(blob, file.name);
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
    triggerDirectUrlDownload(presignedUrl, file.name);
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
