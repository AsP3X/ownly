// Human: Off-main-thread downscale for mobile image preview carousel display blobs.
// Agent: RECEIVES ArrayBuffer + maxEdgePx; RETURNS JPEG/PNG bytes and source natural dimensions.

import { isAnimatedGifBytes } from "@/components/drive/image/image-preview-gif";

const PREVIEW_JPEG_QUALITY = 0.88;
const GIF_SCAN_BYTES = 512 * 1024;

type WorkerRequest = {
  id: number;
  buffer: ArrayBuffer;
  mimeType: string;
  maxEdgePx: number;
};

type WorkerResponse =
  | {
      id: number;
      ok: true;
      buffer: ArrayBuffer;
      mimeType: string;
      naturalWidth: number;
      naturalHeight: number;
      resized: boolean;
    }
  | { id: number; ok: false; message: string };

function resolveOutputMimeType(sourceMime: string): string {
  if (sourceMime.includes("png") || sourceMime.includes("gif")) {
    return "image/png";
  }
  return "image/jpeg";
}

// Human: Downscale large photos to a viewport-aware max edge before the carousel decodes them.
// Agent: USES createImageBitmap resize when supported; RETURNS original buffer when already small.
async function resizeForPreviewDisplay(
  buffer: ArrayBuffer,
  mimeType: string,
  maxEdgePx: number,
): Promise<{
  buffer: ArrayBuffer;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  resized: boolean;
}> {
  const scanLength = Math.min(buffer.byteLength, GIF_SCAN_BYTES);
  if (isAnimatedGifBytes(new Uint8Array(buffer.slice(0, scanLength)))) {
    const sourceBlob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    const bitmap = await createImageBitmap(sourceBlob);
    try {
      return {
        buffer,
        mimeType: mimeType || "application/octet-stream",
        naturalWidth: bitmap.width,
        naturalHeight: bitmap.height,
        resized: false,
      };
    } finally {
      bitmap.close();
    }
  }

  const sourceBlob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  const bitmap = await createImageBitmap(sourceBlob);
  const naturalWidth = bitmap.width;
  const naturalHeight = bitmap.height;

  try {
    const maxEdge = Math.max(naturalWidth, naturalHeight);
    if (maxEdge <= maxEdgePx) {
      return {
        buffer,
        mimeType: mimeType || "application/octet-stream",
        naturalWidth,
        naturalHeight,
        resized: false,
      };
    }

    const scale = maxEdgePx / maxEdge;
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
    const outputMimeType = resolveOutputMimeType(mimeType);

    let drawn: ImageBitmap = bitmap;
    try {
      drawn = await createImageBitmap(bitmap, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: "medium",
      });
    } catch {
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const context = canvas.getContext("2d");
      if (!context) {
        return {
          buffer,
          mimeType: mimeType || "application/octet-stream",
          naturalWidth,
          naturalHeight,
          resized: false,
        };
      }
      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const blob = await canvas.convertToBlob({
        type: outputMimeType,
        quality: outputMimeType === "image/jpeg" ? PREVIEW_JPEG_QUALITY : undefined,
      });
      const output = await blob.arrayBuffer();
      return {
        buffer: output,
        mimeType: outputMimeType,
        naturalWidth,
        naturalHeight,
        resized: true,
      };
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    if (!context) {
      return {
        buffer,
        mimeType: mimeType || "application/octet-stream",
        naturalWidth,
        naturalHeight,
        resized: false,
      };
    }
    context.drawImage(drawn, 0, 0);
    if (drawn !== bitmap) {
      drawn.close();
    }
    const blob = await canvas.convertToBlob({
      type: outputMimeType,
      quality: outputMimeType === "image/jpeg" ? PREVIEW_JPEG_QUALITY : undefined,
    });
    const output = await blob.arrayBuffer();
    return {
      buffer: output,
      mimeType: outputMimeType,
      naturalWidth,
      naturalHeight,
      resized: true,
    };
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, mimeType, maxEdgePx } = event.data;
  void resizeForPreviewDisplay(buffer, mimeType, maxEdgePx)
    .then((result) => {
      const response: WorkerResponse = {
        id,
        ok: true,
        ...result,
      };
      self.postMessage(response, { transfer: [result.buffer] });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "preview display worker failed";
      const response: WorkerResponse = { id, ok: false, message };
      self.postMessage(response);
    });
};
