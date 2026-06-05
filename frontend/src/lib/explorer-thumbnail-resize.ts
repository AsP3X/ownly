// Human: Downscale full-size photos before grid <img> decode — tile is ~140px wide, not full resolution.
// Agent: USES createImageBitmap resize when available; FALLBACK canvas; RETURNS JPEG blob for object URLs.

const GRID_THUMBNAIL_MAX_EDGE_PX = 280;

// Human: Skip resize when the source is already small enough for a grid tile.
// Agent: READS bitmap dimensions; RETURNS true when max edge <= GRID_THUMBNAIL_MAX_EDGE_PX.
function isAlreadyGridSized(width: number, height: number) {
  return Math.max(width, height) <= GRID_THUMBNAIL_MAX_EDGE_PX;
}

// Human: Produce a grid-sized JPEG blob so scrolling does not decode multi-megapixel originals per tile.
// Agent: CALLED by ExplorerImage/Video thumbnail loaders after fetch; RETURNS Blob for URL.createObjectURL.
export async function resizeImageBlobForGridTile(source: Blob): Promise<Blob> {
  if (!source.type.startsWith("image/")) {
    return source;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return source;
  }

  try {
    if (isAlreadyGridSized(bitmap.width, bitmap.height)) {
      return source;
    }

    const scale = GRID_THUMBNAIL_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height);
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    if (typeof createImageBitmap === "function") {
      try {
        const resized = await createImageBitmap(bitmap, {
          resizeWidth: targetWidth,
          resizeHeight: targetHeight,
          resizeQuality: "medium",
        });
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          resized.close();
          return source;
        }
        context.drawImage(resized, 0, 0);
        resized.close();
        const blob = await canvasToJpegBlob(canvas);
        return blob ?? source;
      } catch {
        // Human: Older browsers lack resize options — fall through to canvas scaling.
        // Agent: FALLBACK drawImage path below.
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return source;
    }
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToJpegBlob(canvas);
    return blob ?? source;
  } finally {
    bitmap.close();
  }
}

// Human: Encode a canvas to JPEG for compact blob URLs on grid tiles.
// Agent: RETURNS null when toBlob fails so callers can keep the original blob.
function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
  });
}
