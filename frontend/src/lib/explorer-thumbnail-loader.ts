// Human: Unified explorer thumbnail fetch — server grid JPEG, stream URL, cache, and worker resize.
// Agent: CALLED by ExplorerImage/Video thumbnail components; RESPECTS priority + AbortSignal.

import type { FileItem } from "@/api/client";
import {
  ApiError,
  fetchFileGridThumbnailBlob,
  fetchFilePreviewStreamBlob,
  fetchFileThumbnailBlob,
} from "@/api/client";
import {
  getCachedExplorerThumbnailBlob,
  makeExplorerThumbnailCacheKey,
  putCachedExplorerThumbnailBlob,
} from "@/lib/explorer-thumbnail-cache";
import {
  runExplorerThumbnailLoad,
  type ExplorerThumbnailPriority,
} from "@/lib/explorer-thumbnail-queue";
import { resizeImageBlobForGridTile } from "@/lib/explorer-thumbnail-resize";

const GATEWAY_RETRY_STATUSES = new Set([502, 503, 504]);
const GATEWAY_RETRY_ATTEMPTS = 3;
const GATEWAY_RETRY_BASE_MS = 400;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Human: Retry poster fetches when nginx/API briefly returns gateway errors under scroll bursts.
// Agent: RETRIES fetchFileThumbnailBlob on 502/503/504; RESPECTS AbortSignal between attempts.
async function fetchVideoPosterBlobWithRetry(
  fileId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  let lastError: unknown;
  for (let attempt = 0; attempt < GATEWAY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchFileThumbnailBlob(fileId, undefined, signal);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ApiError && GATEWAY_RETRY_STATUSES.has(error.status);
      if (!retryable || attempt >= GATEWAY_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(GATEWAY_RETRY_BASE_MS * (attempt + 1), signal);
    }
  }
  throw lastError;
}

// Human: Load an image grid preview blob using the fastest available source for this file row.
// Agent: READS cache; PREFERS /grid-thumbnail; FALLBACK stream/download + worker resize.
export async function loadExplorerImageThumbnailBlob(
  file: FileItem,
  options: {
    priority: ExplorerThumbnailPriority;
    signal?: AbortSignal;
  },
): Promise<Blob> {
  const cacheKey = makeExplorerThumbnailCacheKey(file);
  const cached = getCachedExplorerThumbnailBlob(cacheKey);
  if (cached) {
    return cached;
  }

  const blob = await runExplorerThumbnailLoad({
    fileId: file.id,
    priority: options.priority,
    parentSignal: options.signal,
    task: async (signal) => {
      if (file.image_thumbnail_ready) {
        return fetchFileGridThumbnailBlob(file.id, signal);
      }

      const source = await fetchFilePreviewStreamBlob(file, signal);
      return resizeImageBlobForGridTile(source, signal);
    },
  });

  putCachedExplorerThumbnailBlob(cacheKey, blob);
  return blob;
}

// Human: Load a video poster blob — server JPEG plus optional client downscale for oversized posters.
// Agent: CALLS /thumbnail; RESIZES when blob dimensions exceed grid tile budget.
export async function loadExplorerVideoThumbnailBlob(
  file: FileItem,
  options: {
    priority: ExplorerThumbnailPriority;
    signal?: AbortSignal;
  },
): Promise<Blob> {
  const cacheKey = `${makeExplorerThumbnailCacheKey(file)}:video:${file.video_thumbnail_selected_index ?? 0}`;
  const cached = getCachedExplorerThumbnailBlob(cacheKey);
  if (cached) {
    return cached;
  }

  const blob = await runExplorerThumbnailLoad({
    fileId: file.id,
    priority: options.priority,
    parentSignal: options.signal,
    task: async (signal) => {
      const poster = await fetchVideoPosterBlobWithRetry(file.id, signal);
      return resizeImageBlobForGridTile(poster, signal);
    },
  });

  putCachedExplorerThumbnailBlob(cacheKey, blob);
  return blob;
}
