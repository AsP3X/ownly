// Human: Rolling blob-window helpers for the mobile image gallery carousel.
// Agent: EXPORTS tier model N N C A X A C N N — carousel imgs decode; no hidden warm layer.

/** Human: Blob cache holds current ±2 (C + A + X). Distance ±3 and beyond stays N. */
export const PREVIEW_BLOB_CACHE_RADIUS = 2;

/** Human: Carousel tier for one gallery index relative to the active slide. */
export type GallerySlideLoadTier = "current" | "adjacent" | "cache" | "none";

/** Human: Load plan split by swipe direction so the leading edge is ready before trailing eviction. */
export type GalleryDirectionalLoadPlan<T extends { id: string }> = {
  current: T | null;
  forwardAdjacent: T | null;
  forwardCache: T | null;
  backwardAdjacent: T | null;
  backwardCache: T | null;
};

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

function galleryItemAt<T extends { id: string }>(
  gallery: readonly T[],
  index: number,
): T | null {
  if (index < 0 || index >= gallery.length) return null;
  return gallery[index] ?? null;
}

// Human: Directional load plan — forward +1/+2 before backward so the next swipe panel is ready.
// Agent: READS gallery + anchorIndex; RETURNS X, +1, +2, -1, -2 slots for ordered prefetch.
export function buildGalleryLoadPlan<T extends { id: string }>(
  gallery: readonly T[],
  anchorIndex: number,
): GalleryDirectionalLoadPlan<T> {
  if (anchorIndex < 0 || gallery.length === 0) {
    return {
      current: null,
      forwardAdjacent: null,
      forwardCache: null,
      backwardAdjacent: null,
      backwardCache: null,
    };
  }

  return {
    current: galleryItemAt(gallery, anchorIndex),
    forwardAdjacent: galleryItemAt(gallery, anchorIndex + 1),
    forwardCache: galleryItemAt(gallery, anchorIndex + 2),
    backwardAdjacent: galleryItemAt(gallery, anchorIndex - 1),
    backwardCache: galleryItemAt(gallery, anchorIndex - 2),
  };
}

// Human: Ordered prefetch sequence — leading edge (+1, +2) before trailing (-1, -2).
// Agent: READS directional plan; RETURNS unique items in load priority order (X first).
export function orderGalleryLoadSequence<T extends { id: string }>(
  plan: GalleryDirectionalLoadPlan<T>,
): T[] {
  const ordered: T[] = [];
  const seen = new Set<string>();

  const push = (item: T | null) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    ordered.push(item);
  };

  push(plan.current);
  push(plan.forwardAdjacent);
  push(plan.forwardCache);
  push(plan.backwardAdjacent);
  push(plan.backwardCache);
  return ordered;
}

// Human: Leading-edge items that must be ready before trailing blobs are evicted on navigation.
// Agent: READS plan; RETURNS current + forward A/C — the next swipe target and its successor.
export function collectLeadingEdgeFileIds<T extends { id: string }>(
  plan: GalleryDirectionalLoadPlan<T>,
): Set<string> {
  const ids = new Set<string>();
  for (const item of [plan.current, plan.forwardAdjacent, plan.forwardCache]) {
    if (item) ids.add(item.id);
  }
  return ids;
}
