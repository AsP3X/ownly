// Human: Decode preview blobs into browser memory so carousel slides paint without a fetch/decode hitch.
// Agent: WRITES warmedImages map; CALLS Image.decode when available; RETURNS after bitmap is ready.

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

// Human: Drop decoded bitmap refs when the lightbox closes or slides leave the adjacent window.
// Agent: DELETES warmedImages entries not listed in keepFileIds; CALL on dialog close with empty keep list.
export function retainWarmedPreviewImages(keepFileIds: readonly string[]): void {
  const keep = new Set(keepFileIds);
  for (const fileId of warmedImages.keys()) {
    if (!keep.has(fileId)) {
      warmedImages.delete(fileId);
    }
  }
}

// Human: Clear every warmed preview when the viewer closes.
// Agent: DELETES all warmedImages entries.
export function clearWarmedPreviewImages(): void {
  warmedImages.clear();
}
