// Human: In-memory LRU cache for grid thumbnail blobs — instant tiles when scrolling back.
// Agent: KEYED by file id + updated_at; EVICTS oldest entries beyond MAX_EXPLORER_THUMBNAIL_CACHE.

import type { FileItem } from "@/api/client";

// Human: Keep several folder pages of grid JPEGs hot (~25–40MB typical for mixed image/video rows).
// Agent: RAISED from 120 so load-more listings stay cached while scrolling up/down.
const MAX_EXPLORER_THUMBNAIL_CACHE = 400;

type CacheEntry = {
  blob: Blob;
};

const cache = new Map<string, CacheEntry>();
const accessOrder: string[] = [];

// Human: Stable cache key when file metadata changes after replace/upload.
// Agent: COMBINES file.id and updated_at; USED by loader before network fetch.
export function makeExplorerThumbnailCacheKey(
  file: Pick<FileItem, "id" | "updated_at">,
): string {
  return `${file.id}:${file.updated_at}`;
}

function touchKey(key: string) {
  const index = accessOrder.indexOf(key);
  if (index >= 0) {
    accessOrder.splice(index, 1);
  }
  accessOrder.push(key);
}

function evictIfNeeded() {
  while (accessOrder.length > MAX_EXPLORER_THUMBNAIL_CACHE) {
    const oldest = accessOrder.shift();
    if (!oldest) break;
    cache.delete(oldest);
  }
}

// Human: Read a cached thumbnail blob if this file version was loaded recently.
// Agent: RETURNS null on miss; UPDATES LRU order on hit.
export function getCachedExplorerThumbnailBlob(key: string): Blob | null {
  const entry = cache.get(key);
  if (!entry) return null;
  touchKey(key);
  return entry.blob;
}

// Human: True when this cache key already has a decoded blob in the LRU store.
// Agent: READ by prefetch helper; SKIPS network for warm-cache passes.
export function hasCachedExplorerThumbnailBlob(key: string): boolean {
  return cache.has(key);
}

// Human: Store a decoded thumbnail blob for reuse while browsing the same folder.
// Agent: WRITES Map entry; TRIGGERS LRU eviction when over capacity.
export function putCachedExplorerThumbnailBlob(key: string, blob: Blob) {
  cache.set(key, { blob });
  touchKey(key);
  evictIfNeeded();
}

// Human: Drop one file's cached thumbnails after delete/replace (optional explicit invalidation).
// Agent: REMOVES any cache keys prefixed with fileId.
export function invalidateExplorerThumbnailCacheForFile(fileId: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${fileId}:`)) {
      cache.delete(key);
      const index = accessOrder.indexOf(key);
      if (index >= 0) accessOrder.splice(index, 1);
    }
  }
}
