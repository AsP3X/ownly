// Human: Resumable chunked upload client — session lifecycle, part PUTs, and complete handshake.
// Agent: CALLS POST/GET/PUT /uploads/*; SKIPS parts already on server; USES AbortSignal for cancel.

import {
  API_BASE,
  API_FETCH_CREDENTIALS,
  ApiError,
  parseRetryAfterSeconds,
} from "@/api/core";

/** Human: Files larger than this use chunked resumable uploads instead of single multipart POST. */
export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 32 * 1024 * 1024;

/** Human: Video uploads switch to chunked mode at a lower size — phone clips fail more on one-shot POST. */
export const RESUMABLE_VIDEO_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Human: Default chunk size — must stay within backend MIN/MAX chunk bounds. */
export const UPLOAD_CHUNK_SIZE_BYTES = 16 * 1024 * 1024;

/** Human: Parallel part PUTs — aligned with upload-manager MAX_CONCURRENT_UPLOADS. */
const MAX_CONCURRENT_PART_UPLOADS = 2;

export type ResumableUploadProgress = {
  phase: "uploading" | "processing" | "encrypting" | "storing";
  percent: number;
  indeterminate?: boolean;
};

export type ResumableServerSession = {
  session_id: string;
  file_id: string;
  chunk_size: number;
  total_parts: number;
  total_size: number;
  bytes_received: number;
  parts_received: number[];
  status: string;
  expires_at: string;
};

type UploadFilePayload = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  folder_id: string | null;
};

// Human: Decide whether a browser File should use chunked resumable upload instead of multipart POST.
// Agent: READS mime + size; RETURNS true below 32 MiB for video/* only.
export function shouldUseResumableUpload(file: File): boolean {
  const mime = file.type || "";
  if (mime.startsWith("video/")) {
    return file.size > RESUMABLE_VIDEO_THRESHOLD_BYTES;
  }
  return file.size > RESUMABLE_UPLOAD_THRESHOLD_BYTES;
}

async function parseApiError(res: Response, fallbackMessage: string): Promise<ApiError> {
  const text = await res.text();
  let body: {
    error?: { code?: string; message?: string; fields?: Record<string, unknown> } | string;
    raw?: string;
  } | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      body = { raw: text };
    }
  }
  const errorObject = typeof body?.error === "object" ? body.error : undefined;
  let message =
    typeof body?.error === "string"
      ? body.error
      : errorObject?.message ?? fallbackMessage;
  if (res.status === 413) {
    message =
      "This file exceeds the server upload limit. Ask your admin to raise MAX_UPLOAD_BYTES (and rebuild the stack).";
  }
  return new ApiError(
    message,
    errorObject?.code ?? "request_failed",
    res.status,
    errorObject?.fields,
    parseRetryAfterSeconds(res.headers.get("Retry-After")),
  );
}

function authHeaders(contentType?: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

function uploadFetchInit(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    credentials: API_FETCH_CREDENTIALS,
  };
}

// Human: Run async work over a list with a bounded worker pool.
// Agent: USED for parallel part PUTs; PRESERVES completion order for progress only.
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = items[nextIndex];
      nextIndex += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

// Human: Start or resume a server-side upload session for one file.
// Agent: POST /uploads when no session id; GET /uploads/{id} when resuming after retry.
export async function ensureUploadSession(
  file: File,
  folderId: string | null | undefined,
  existingSessionId?: string | null,
): Promise<ResumableServerSession> {
  if (existingSessionId) {
    const res = await fetch(`${API_BASE}/uploads/${existingSessionId}`, uploadFetchInit({
      headers: authHeaders(),
    }));
    if (!res.ok) {
      throw await parseApiError(res, "Could not resume upload session");
    }
    return (await res.json()) as ResumableServerSession;
  }

  const res = await fetch(`${API_BASE}/uploads`, uploadFetchInit({
    method: "POST",
    headers: authHeaders("application/json"),
    body: JSON.stringify({
      filename: file.name,
      folder_id: folderId ?? null,
      total_size: file.size,
      content_type: file.type || undefined,
      chunk_size: UPLOAD_CHUNK_SIZE_BYTES,
    }),
  }));
  if (!res.ok) {
    throw await parseApiError(res, "Could not start upload session");
  }
  return (await res.json()) as ResumableServerSession;
}

// Human: Abort a partial server session and discard spooled parts.
// Agent: DELETE /uploads/{id}; BEST-EFFORT on user cancel.
export async function abortResumableUploadSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/uploads/${sessionId}`, uploadFetchInit({
    method: "DELETE",
    headers: authHeaders(),
  }));
  if (!res.ok && res.status !== 404) {
    throw await parseApiError(res, "Could not abort upload session");
  }
}

// Human: Upload all missing parts then call complete — skips parts the server already has.
// Agent: PUT /uploads/{id}/parts/{n} with bounded concurrency; POST /uploads/{id}/complete.
export async function uploadFileResumableBytes(
  file: File,
  options: {
    folderId?: string | null;
    existingSessionId?: string | null;
    onProgress?: (update: ResumableUploadProgress) => void;
    isCancelled?: () => boolean;
    signal?: AbortSignal;
    onSessionReady?: (session: ResumableServerSession) => void;
  },
): Promise<UploadFilePayload> {
  const session = await ensureUploadSession(
    file,
    options.folderId,
    options.existingSessionId,
  );
  options.onSessionReady?.(session);

  const received = new Set(session.parts_received ?? []);
  const chunkSize = session.chunk_size;
  const totalParts = session.total_parts;

  const missingParts: number[] = [];
  for (let partNumber = 0; partNumber < totalParts; partNumber += 1) {
    if (!received.has(partNumber)) {
      missingParts.push(partNumber);
    }
  }

  const reportProgress = () => {
    const uploadedParts = received.size;
    const percent = Math.min(
      100,
      Math.round((uploadedParts / totalParts) * 100),
    );
    options.onProgress?.({ phase: "uploading", percent });
  };

  await mapWithConcurrency(missingParts, MAX_CONCURRENT_PART_UPLOADS, async (partNumber) => {
    if (options.isCancelled?.()) {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }

    const start = partNumber * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const res = await fetch(
      `${API_BASE}/uploads/${session.session_id}/parts/${partNumber}`,
      uploadFetchInit({
        method: "PUT",
        headers: authHeaders("application/octet-stream"),
        body: chunk,
        signal: options.signal,
      }),
    );
    if (!res.ok) {
      throw await parseApiError(res, `Upload part ${partNumber} failed`);
    }

    received.add(partNumber);
    reportProgress();
  });

  if (options.isCancelled?.()) {
    throw new ApiError("Upload cancelled", "upload_cancelled", 0);
  }

  options.onProgress?.({ phase: "uploading", percent: 100 });

  const completeRes = await fetch(
    `${API_BASE}/uploads/${session.session_id}/complete`,
    uploadFetchInit({
      method: "POST",
      headers: authHeaders(),
      signal: options.signal,
    }),
  );
  if (!completeRes.ok) {
    throw await parseApiError(completeRes, "Could not complete upload");
  }

  const payload = (await completeRes.json()) as { file: UploadFilePayload };
  return payload.file;
}
