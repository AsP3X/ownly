// Human: Background warm-cache for listed files — fills LRU before tiles scroll into view.
// Agent: LOW priority queue; ONLY server-ready thumbs; SKIPS legacy full-preview resize paths.

import type { FileItem } from "@/api/client";
import {
  getCachedExplorerThumbnailBlob,
  hasCachedExplorerThumbnailBlob,
  makeExplorerThumbnailCacheKey,
} from "@/lib/explorer-thumbnail-cache";
import {
  loadExplorerImageThumbnailBlob,
  loadExplorerVideoThumbnailBlob,
} from "@/lib/explorer-thumbnail-loader";

const MAX_PREFETCH_PER_BATCH = 48;

let activeWarmScope = "";

// Human: Invalidate in-flight warm passes when the user changes folder or nav.
// Agent: WRITES activeWarmScope; CALLED before listing refresh on folder change.
export function resetExplorerThumbnailWarmScope(scopeKey: string) {
  activeWarmScope = scopeKey;
}

function imageCacheKey(file: FileItem): string {
  return makeExplorerThumbnailCacheKey(file);
}

function videoCacheKey(file: FileItem): string {
  return `${makeExplorerThumbnailCacheKey(file)}:video:${file.video_thumbnail_selected_index ?? 0}`;
}

// Human: Queue low-priority thumbnail fetches for rows already in memory but not yet cached.
// Agent: READS files batch; CALLS loader for ready image/video thumbs; NO-OP on cache hits.
export function warmExplorerThumbnailCache(files: FileItem[], scopeKey: string) {
  activeWarmScope = scopeKey;
  const scope = scopeKey;
  let queued = 0;

  for (const file of files) {
    if (queued >= MAX_PREFETCH_PER_BATCH) break;
    if (activeWarmScope !== scope) return;

    if (file.image_thumbnail_ready && (file.mime_type ?? "").startsWith("image/")) {
      const cacheKey = imageCacheKey(file);
      if (hasCachedExplorerThumbnailBlob(cacheKey)) continue;
      queued += 1;
      void loadExplorerImageThumbnailBlob(file, { priority: "low" }).catch(() => {
        // Human: Prefetch failures are non-critical — visible tiles retry with high priority.
      });
      continue;
    }

    if (file.video_thumbnail_ready && (file.mime_type ?? "").startsWith("video/")) {
      const cacheKey = videoCacheKey(file);
      if (hasCachedExplorerThumbnailBlob(cacheKey)) continue;
      queued += 1;
      void loadExplorerVideoThumbnailBlob(file, { priority: "low" }).catch(() => {
        // Human: Poster prefetch is best-effort — scroll-into-view load remains the fallback.
      });
    }
  }
}

// Human: Touch LRU order for keys we already have when a listing page loads.
// Agent: PROMOTES cached blobs so a fresh folder browse does not evict recent scroll history.
export function touchCachedExplorerThumbnailsForFiles(files: FileItem[]) {
  for (const file of files) {
    if (file.image_thumbnail_ready && (file.mime_type ?? "").startsWith("image/")) {
      getCachedExplorerThumbnailBlob(imageCacheKey(file));
      continue;
    }
    if (file.video_thumbnail_ready && (file.mime_type ?? "").startsWith("video/")) {
      getCachedExplorerThumbnailBlob(videoCacheKey(file));
    }
  }
}
