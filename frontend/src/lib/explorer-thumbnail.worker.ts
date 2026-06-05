// Human: Off-main-thread downscale for legacy images without server grid thumbnails.
// Agent: RECEIVES ArrayBuffer; RETURNS JPEG ArrayBuffer via createImageBitmap + OffscreenCanvas.

const GRID_THUMBNAIL_MAX_EDGE_PX = 280;
const GRID_THUMBNAIL_JPEG_QUALITY = 0.82;

type WorkerRequest = {
  id: number;
  buffer: ArrayBuffer;
  mimeType: string;
};

type WorkerResponse =
  | { id: number; ok: true; buffer: ArrayBuffer; mimeType: "image/jpeg" }
  | { id: number; ok: false; message: string };

// Human: Resize source bytes to a grid-friendly JPEG without blocking scroll on the main thread.
// Agent: USES createImageBitmap resize when supported; FALLBACK OffscreenCanvas drawImage.
async function resizeToGridJpeg(buffer: ArrayBuffer, mimeType: string): Promise<ArrayBuffer> {
  const sourceBlob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  const bitmap = await createImageBitmap(sourceBlob);

  try {
    const maxEdge = Math.max(bitmap.width, bitmap.height);
    if (maxEdge <= GRID_THUMBNAIL_MAX_EDGE_PX) {
      return buffer;
    }

    const scale = GRID_THUMBNAIL_MAX_EDGE_PX / maxEdge;
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    let drawn: ImageBitmap = bitmap;
    try {
      drawn = await createImageBitmap(bitmap, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: "medium",
      });
    } catch {
      // Human: Fallback path when resize options are unavailable in this worker context.
      // Agent: DRAW full bitmap to OffscreenCanvas with explicit dimensions.
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const context = canvas.getContext("2d");
      if (!context) {
        return buffer;
      }
      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: GRID_THUMBNAIL_JPEG_QUALITY,
      });
      return blob.arrayBuffer();
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    if (!context) {
      return buffer;
    }
    context.drawImage(drawn, 0, 0);
    if (drawn !== bitmap) {
      drawn.close();
    }
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: GRID_THUMBNAIL_JPEG_QUALITY,
    });
    return blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, mimeType } = event.data;
  void resizeToGridJpeg(buffer, mimeType)
    .then((output) => {
      const response: WorkerResponse = {
        id,
        ok: true,
        buffer: output,
        mimeType: "image/jpeg",
      };
      self.postMessage(response, { transfer: [output] });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "thumbnail worker failed";
      const response: WorkerResponse = { id, ok: false, message };
      self.postMessage(response);
    });
};
