// Human: Decode preview blobs into browser memory so carousel slides paint without a fetch/decode hitch.
// Agent: WRITES warmedImages map; CALLS Image.decode once per file; CLEARS bitmap refs on session end.

const warmedImages = new Map<string, HTMLImageElement>();

function releaseWarmImage(img: HTMLImageElement): void {
  img.onload = null;
  img.onerror = null;
  img.src = "";
}

// Human: Load and decode an object URL once, retaining the Image node until pruned or cleared.
// Agent: READS warmedImages; SKIPS repeat decode; CALLS isActive before/after async work.
export function warmPreviewImage(
  fileId: string,
  objectUrl: string,
  isActive?: () => boolean,
): Promise<void> {
  if (isActive && !isActive()) {
    return Promise.resolve();
  }

  const cached = warmedImages.get(fileId);
  if (cached && cached.src === objectUrl && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve();
  }

  if (cached) {
    releaseWarmImage(cached);
    warmedImages.delete(fileId);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (isActive && !isActive()) {
        releaseWarmImage(img);
        resolve();
        return;
      }

      warmedImages.set(fileId, img);
      if (typeof img.decode === "function") {
        void img
          .decode()
          .then(() => resolve())
          .catch(() => resolve());
        return;
      }
      resolve();
    };
    img.onerror = () => reject(new Error("Preview image failed to decode"));
    img.src = objectUrl;
  });
}

// Human: Drop decoded bitmap refs outside the active swipe window to cap memory use.
// Agent: DELETES warmedImages entries not in keepFileIds; RELEASES img.src for evicted entries.
export function retainWarmedPreviewImages(keepFileIds: readonly string[]): void {
  const keep = new Set(keepFileIds);
  for (const [fileId, img] of warmedImages.entries()) {
    if (keep.has(fileId)) continue;
    releaseWarmImage(img);
    warmedImages.delete(fileId);
  }
}

// Human: Clear every warmed preview when the viewer closes.
// Agent: RELEASES img.src; DELETES all warmedImages entries.
export function clearWarmedPreviewImages(): void {
  for (const img of warmedImages.values()) {
    releaseWarmImage(img);
  }
  warmedImages.clear();
}

// Human: Priority order for gallery preload — current image first, then nearest neighbors outward.
// Agent: READS images + anchorIndex; RETURNS FileItem[] sorted by distance from the active slide.
export function orderGalleryForPreload<T extends { id: string }>(
  images: readonly T[],
  anchorIndex: number,
): T[] {
  if (images.length <= 1) return [...images];

  const safeAnchor = anchorIndex >= 0 ? anchorIndex : 0;
  return [...images].sort((left, right) => {
    const leftIndex = images.indexOf(left);
    const rightIndex = images.indexOf(right);
    const leftDistance = Math.abs(leftIndex - safeAnchor);
    const rightDistance = Math.abs(rightIndex - safeAnchor);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return leftIndex - rightIndex;
  });
}

// Human: Fetch the full gallery with bounded parallelism; workers stop as soon as isActive is false.
// Agent: CALLS loadItem for each ordered image; CHECKS isActive before and after each await.
export async function preloadGalleryImages<T extends { id: string }>(
  orderedImages: readonly T[],
  loadItem: (item: T) => Promise<unknown>,
  options?: { concurrency?: number; isActive?: () => boolean },
): Promise<void> {
  const concurrency = Math.max(1, options?.concurrency ?? 6);
  const isActive = options?.isActive ?? (() => true);
  if (orderedImages.length === 0 || !isActive()) return;

  let cursor = 0;

  async function worker() {
    while (isActive()) {
      const index = cursor;
      cursor += 1;
      if (index >= orderedImages.length) return;

      await loadItem(orderedImages[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, orderedImages.length) }, () => worker()),
  );
}
