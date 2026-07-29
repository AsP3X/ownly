// Human: Resumable chunked upload client — session lifecycle, direct Nebular part PUTs, and complete handshake.
// Agent: PREFERS signed-url + confirm when direct_upload; FALLBACK PUT body through Ownly API.

import {
  API_BASE,
  ApiError,
  mutationFetch,
  parseRetryAfterSeconds,
} from "@/api/core";
import {
  recordUploadPartSample,
  suggestedChunkSizeBytes,
  suggestedPartConcurrency,
} from "@/lib/upload-adaptive";

/** Human: Files larger than this use chunked resumable uploads instead of single multipart POST. */
export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 32 * 1024 * 1024;

/** Human: Video uploads switch to chunked mode at a lower size — phone clips fail more on one-shot POST. */
export const RESUMABLE_VIDEO_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Human: Default chunk size — must stay within backend MIN/MAX chunk bounds (adaptive may lower). */
export const UPLOAD_CHUNK_SIZE_BYTES = 16 * 1024 * 1024;

export type ResumableUploadProgress = {
  phase: "uploading" | "processing" | "encrypting" | "storing";
  percent: number;
  indeterminate?: boolean;
  /** Bytes confirmed uploaded for this file (byte-level progress). */
  bytesUploaded?: number;
  /** Total file size in bytes. */
  bytesTotal?: number;
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
  /** When true, PUT part bytes to signed Nebular URLs then POST confirm (non-video production storage). */
  direct_upload?: boolean;
  /** Active-library match — complete can short-circuit after parts are skipped. */
  dedup_source_file_id?: string | null;
  /** Soft-deleted match — surface restore UX instead of re-uploading. */
  recycle_match_file_id?: string | null;
};

export type ResumablePartTransport = "direct" | "proxy";

type SignedPartUrl = {
  part_number: number;
  upload_url: string;
  expires_at: string;
  content_type: string;
  expected_bytes: number;
  confirm_token: string;
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

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

function octetStreamHeaders(): HeadersInit {
  return { "Content-Type": "application/octet-stream" };
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
  contentHash?: string | null,
): Promise<ResumableServerSession> {
  if (existingSessionId) {
    const res = await mutationFetch(`${API_BASE}/uploads/${existingSessionId}`, {
      headers: jsonHeaders(),
    });
    if (!res.ok) {
      throw await parseApiError(res, "Could not resume upload session");
    }
    return (await res.json()) as ResumableServerSession;
  }

  const res = await mutationFetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      filename: file.name,
      folder_id: folderId ?? null,
      total_size: file.size,
      content_type: file.type || undefined,
      chunk_size: suggestedChunkSizeBytes(),
      content_hash: contentHash || undefined,
    }),
  });
  if (!res.ok) {
    throw await parseApiError(res, "Could not start upload session");
  }
  return (await res.json()) as ResumableServerSession;
}

// Human: Abort a partial server session and discard spooled parts.
// Agent: DELETE /uploads/{id}; BEST-EFFORT on user cancel.
export async function abortResumableUploadSession(sessionId: string): Promise<void> {
  const res = await mutationFetch(`${API_BASE}/uploads/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw await parseApiError(res, "Could not abort upload session");
  }
}

// Human: Proxy one part through Ownly API (video spool path and direct-upload fallback).
// Agent: PUT /uploads/{id}/parts/{n} with octet-stream body; RECORDS adaptive sample.
async function uploadPartViaApi(
  sessionId: string,
  partNumber: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<ResumablePartTransport> {
  const started = performance.now();
  const res = await mutationFetch(`${API_BASE}/uploads/${sessionId}/parts/${partNumber}`, {
    method: "PUT",
    headers: octetStreamHeaders(),
    body: chunk,
    signal,
  });
  const durationMs = performance.now() - started;
  if (!res.ok) {
    recordUploadPartSample({ ok: false, durationMs, bytes: chunk.size });
    throw await parseApiError(res, `Upload part ${partNumber} failed`);
  }
  recordUploadPartSample({ ok: true, durationMs, bytes: chunk.size });
  return "proxy";
}

// Human: Mint signed URL, PUT bytes straight to Nebular (same-origin /media/), then confirm with Ownly.
// Agent: POST signed-url; fetch PUT; POST confirm with confirm_token; FALLBACK uploadPartViaApi.
async function uploadPartDirect(
  sessionId: string,
  partNumber: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<ResumablePartTransport> {
  const signedRes = await mutationFetch(
    `${API_BASE}/uploads/${sessionId}/parts/${partNumber}/signed-url`,
    {
      method: "POST",
      signal,
    },
  );
  if (!signedRes.ok) {
    return uploadPartViaApi(sessionId, partNumber, chunk, signal);
  }

  const signed = (await signedRes.json()) as SignedPartUrl;
  if (chunk.size !== signed.expected_bytes) {
    throw new ApiError(
      `Part ${partNumber} size mismatch (local ${chunk.size}, expected ${signed.expected_bytes})`,
      "part_size_mismatch",
      400,
    );
  }

  let putOk = false;
  const started = performance.now();
  try {
    const putRes = await fetch(signed.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": signed.content_type || "application/octet-stream",
      },
      body: chunk,
      signal,
      credentials: "omit",
    });
    putOk = putRes.ok;
    if (!putOk) {
      const text = await putRes.text().catch(() => "");
      recordUploadPartSample({
        ok: false,
        durationMs: performance.now() - started,
        bytes: chunk.size,
      });
      throw new ApiError(
        text || `Direct storage PUT failed for part ${partNumber}`,
        "direct_put_failed",
        putRes.status,
      );
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "upload_cancelled") {
      throw error;
    }
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }
    return uploadPartViaApi(sessionId, partNumber, chunk, signal);
  }

  if (!putOk) {
    return uploadPartViaApi(sessionId, partNumber, chunk, signal);
  }

  const confirmRes = await mutationFetch(
    `${API_BASE}/uploads/${sessionId}/parts/${partNumber}/confirm`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ confirm_token: signed.confirm_token }),
      signal,
    },
  );
  if (!confirmRes.ok) {
    recordUploadPartSample({
      ok: false,
      durationMs: performance.now() - started,
      bytes: chunk.size,
    });
    throw await parseApiError(confirmRes, `Confirm part ${partNumber} failed`);
  }
  recordUploadPartSample({
    ok: true,
    durationMs: performance.now() - started,
    bytes: chunk.size,
  });
  return "direct";
}

// Human: Expected size of one zero-based part for progress accounting.
function partByteSize(totalSize: number, chunkSize: number, partNumber: number): number {
  const offset = partNumber * chunkSize;
  return Math.min(chunkSize, Math.max(0, totalSize - offset));
}

// Human: Upload all missing parts then call complete — skips parts the server already has.
// Agent: INSTANT dedup when dedup_source_file_id; else direct/proxy parts; POST complete.
export async function uploadFileResumableBytes(
  file: File,
  options: {
    folderId?: string | null;
    existingSessionId?: string | null;
    contentHash?: string | null;
    onProgress?: (update: ResumableUploadProgress) => void;
    isCancelled?: () => boolean;
    signal?: AbortSignal;
    onSessionReady?: (session: ResumableServerSession) => void;
    onPartTransport?: (transport: ResumablePartTransport) => void;
  },
): Promise<UploadFilePayload> {
  let contentHash = options.contentHash ?? null;
  // Human: Hash before create so the server can flag active/trash dedup without receiving bytes.
  // Agent: SKIP when caller already hashed in the dialog; CAP at 512 MiB for in-band hashing cost.
  if (!contentHash && !options.existingSessionId && file.size > 0 && file.size <= 512 * 1024 * 1024) {
    try {
      const { computeFileContentHash } = await import("@/lib/file-content-hash");
      contentHash = await computeFileContentHash(file, { signal: options.signal });
    } catch {
      contentHash = null;
    }
  }

  const session = await ensureUploadSession(
    file,
    options.folderId,
    options.existingSessionId,
    contentHash,
  );
  options.onSessionReady?.(session);

  const received = new Set(session.parts_received ?? []);
  const chunkSize = session.chunk_size;
  const totalParts = session.total_parts;
  const totalSize = session.total_size || file.size;
  const useDirect = Boolean(session.direct_upload);

  let bytesUploaded = 0;
  for (const partNumber of received) {
    bytesUploaded += partByteSize(totalSize, chunkSize, partNumber);
  }

  const reportProgress = () => {
    const percent =
      totalSize <= 0
        ? 100
        : Math.min(100, Math.round((bytesUploaded / totalSize) * 100));
    options.onProgress?.({
      phase: "uploading",
      percent,
      bytesUploaded,
      bytesTotal: totalSize,
    });
  };
  reportProgress();

  // Human: Instant per-user dedup — server already has these bytes; complete without part PUTs.
  if (session.dedup_source_file_id) {
    options.onProgress?.({
      phase: "uploading",
      percent: 100,
      bytesUploaded: totalSize,
      bytesTotal: totalSize,
    });
    if (options.isCancelled?.()) {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }
    const completeRes = await mutationFetch(
      `${API_BASE}/uploads/${session.session_id}/complete`,
      {
        method: "POST",
        signal: options.signal,
      },
    );
    if (!completeRes.ok) {
      throw await parseApiError(completeRes, "Could not complete upload");
    }
    const payload = (await completeRes.json()) as { file: UploadFilePayload };
    return payload.file;
  }

  if (session.recycle_match_file_id) {
    // Human: Soft-deleted twin — still upload a new row; restore was offered in the picker conflict UI.
    options.onPartTransport?.("proxy");
  }

  const missingParts: number[] = [];
  for (let partNumber = 0; partNumber < totalParts; partNumber += 1) {
    if (!received.has(partNumber)) {
      missingParts.push(partNumber);
    }
  }

  const partConcurrency = suggestedPartConcurrency();
  await mapWithConcurrency(missingParts, partConcurrency, async (partNumber) => {
    if (options.isCancelled?.()) {
      throw new ApiError("Upload cancelled", "upload_cancelled", 0);
    }

    const start = partNumber * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const transport = useDirect
      ? await uploadPartDirect(session.session_id, partNumber, chunk, options.signal)
      : await uploadPartViaApi(session.session_id, partNumber, chunk, options.signal);
    options.onPartTransport?.(transport);

    received.add(partNumber);
    bytesUploaded += chunk.size;
    reportProgress();
  });

  if (options.isCancelled?.()) {
    throw new ApiError("Upload cancelled", "upload_cancelled", 0);
  }

  options.onProgress?.({
    phase: "uploading",
    percent: 100,
    bytesUploaded: totalSize,
    bytesTotal: totalSize,
  });

  const completeRes = await mutationFetch(
    `${API_BASE}/uploads/${session.session_id}/complete`,
    {
      method: "POST",
      signal: options.signal,
    },
  );
  if (!completeRes.ok) {
    throw await parseApiError(completeRes, "Could not complete upload");
  }

  const payload = (await completeRes.json()) as { file: UploadFilePayload };
  return payload.file;
}
