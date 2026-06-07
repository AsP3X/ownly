// Human: Rolling blob-window helpers for the mobile image gallery carousel.
// Agent: EXPORTS tier model N N C A X A C N N — carousel imgs decode; no hidden warm layer.

/** Human: Blob cache holds current ±2 (C + A + X). Distance ±3 and beyond stays N. */
export const PREVIEW_BLOB_CACHE_RADIUS = 2;

/** Human: Carousel tier for one gallery index relative to the active slide. */
export type GallerySlideLoadTier = "current" | "adjacent" | "cache" | "none";

// Human: Map index distance to load tier — NNCAXACNN centered on the active slide.
// Agent: READS itemIndex + anchorIndex; RETURNS current|adjacent|cache|none.
export function resolveGalleryLoadTier(
  itemIndex: number,
  anchorIndex: number,
): GallerySlideLoadTier {
  if (itemIndex < 0 || anchorIndex < 0) return "none";

  const distance = Math.abs(itemIndex - anchorIndex);
  if (distance === 0) return "current";
  if (distance === 1) return "adjacent";
  if (distance === 2) return "cache";
  return "none";
}

// Human: File ids that should stay in the blob cache for a given anchor index.
// Agent: READS gallery length + anchorIndex + radius; RETURNS Set of ids within ±radius (C+A+X band).
export function collectGalleryWindowFileIds<T extends { id: string }>(
  gallery: readonly T[],
  anchorIndex: number,
  radius: number = PREVIEW_BLOB_CACHE_RADIUS,
): Set<string> {
  const keepIds = new Set<string>();
  if (anchorIndex < 0 || gallery.length === 0) return keepIds;

  const start = Math.max(0, anchorIndex - radius);
  const end = Math.min(gallery.length - 1, anchorIndex + radius);
  for (let index = start; index <= end; index += 1) {
    keepIds.add(gallery[index]!.id);
  }
  return keepIds;
}

// Human: Whether a gallery index sits inside the rolling blob cache window.
// Agent: READS anchorIndex + radius; RETURNS true when index is within ±radius.
export function isGalleryIndexInBlobWindow(
  itemIndex: number,
  anchorIndex: number,
  radius: number = PREVIEW_BLOB_CACHE_RADIUS,
): boolean {
  if (itemIndex < 0 || anchorIndex < 0) return false;
  return Math.abs(itemIndex - anchorIndex) <= radius;
}

// Human: Ordered load plan for one anchor — X first, then A (±1), then C (±2).
// Agent: READS gallery + anchorIndex; RETURNS current, adjacent[], cache[] within the C band only.
export function buildGalleryLoadPlan<T extends { id: string }>(
  gallery: readonly T[],
  anchorIndex: number,
): { current: T | null; adjacent: T[]; cache: T[] } {
  if (anchorIndex < 0 || gallery.length === 0) {
    return { current: null, adjacent: [], cache: [] };
  }

  const current = gallery[anchorIndex] ?? null;
  const adjacent: T[] = [];
  const cache: T[] = [];

  for (let offset = -PREVIEW_BLOB_CACHE_RADIUS; offset <= PREVIEW_BLOB_CACHE_RADIUS; offset += 1) {
    if (offset === 0) continue;

    const index = anchorIndex + offset;
    if (index < 0 || index >= gallery.length) continue;

    const tier = resolveGalleryLoadTier(index, anchorIndex);
    const item = gallery[index]!;
    if (tier === "adjacent") adjacent.push(item);
    if (tier === "cache") cache.push(item);
  }

  return { current, adjacent, cache };
}
