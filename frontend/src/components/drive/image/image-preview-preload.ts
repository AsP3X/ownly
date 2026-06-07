// Human: Decode preview blobs into browser memory so carousel slides paint without a fetch/decode hitch.
// Agent: WRITES warmedImages map; CALLS Image.decode when available; CLEARS all entries when the viewer closes.

const warmedImages = new Map<string, HTMLImageElement>();

// Human: Load and decode an object URL, retaining the Image node so the bitmap stays resident.
// Agent: READS warmedImages cache; WRITES entry keyed by fileId; RESOLVES when decode completes.
export function warmPreviewImage(fileId: string, objectUrl: string): Promise<void> {
  const cached = warmedImages.get(fileId);
  if (cached && cached.src === objectUrl && cached.complete && cached.naturalWidth > 0) {
    if (typeof cached.decode === "function") {
      return cached.decode().catch(() => undefined);
    }
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      warmedImages.set(fileId, img);
      if (typeof img.decode === "function") {
        void img.decode().then(() => resolve()).catch(() => resolve());
        return;
      }
      resolve();
    };
    img.onerror = () => reject(new Error("Preview image failed to decode"));
    img.src = objectUrl;
  });
}

// Human: Clear every warmed preview when the viewer closes.
// Agent: DELETES all warmedImages entries.
export function clearWarmedPreviewImages(): void {
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

// Human: Fetch the full gallery with bounded parallelism so every slide is ready before swiping.
// Agent: CALLS loadItem for each ordered image; STOPS when signal aborts.
export async function preloadGalleryImages<T extends { id: string }>(
  orderedImages: readonly T[],
  loadItem: (item: T) => Promise<unknown>,
  options?: { concurrency?: number; signal?: AbortSignal },
): Promise<void> {
  const concurrency = Math.max(1, options?.concurrency ?? 6);
  if (orderedImages.length === 0 || options?.signal?.aborted) return;

  let cursor = 0;

  async function worker() {
    while (!options?.signal?.aborted) {
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
