// Human: Unified explorer thumbnail fetch — server grid JPEG, stream URL, cache, and worker resize.
// Agent: CALLED by ExplorerImage/Video thumbnail components; RESPECTS priority + AbortSignal.

import type { FileItem } from "@/api/client";
import {
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
      const poster = await fetchFileThumbnailBlob(file.id, undefined, signal);
      return resizeImageBlobForGridTile(poster, signal);
    },
  });

  putCachedExplorerThumbnailBlob(cacheKey, blob);
  return blob;
}
