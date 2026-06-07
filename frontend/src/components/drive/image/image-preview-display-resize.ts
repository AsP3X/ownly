// Human: Viewport-aware downscale for mobile image preview — keeps decode cost off the swipe path.
// Agent: PREFERS dedicated worker; FALLBACK main-thread createImageBitmap; RETURNS display blob + source dimensions.

import {
  isAnimatedGifBlob,
  readImageNaturalDimensions,
} from "@/components/drive/image/image-preview-gif";

export type PreviewDisplayImage = {
  blob: Blob;
  naturalWidth: number;
  naturalHeight: number;
};

const PREVIEW_JPEG_QUALITY = 0.88;
const PREVIEW_DISPLAY_MAX_EDGE_CAP_PX = 2048;
const PREVIEW_DISPLAY_MAX_EDGE_FLOOR_PX = 1280;
const PREVIEW_DISPLAY_PINCH_HEADROOM = 2;
const MAX_CONCURRENT_RESIZES = 2;

let worker: Worker | null = null;
let workerRequestId = 0;
const workerWaiters = new Map<
  number,
  {
    resolve: (value: PreviewDisplayImage) => void;
    reject: (error: Error) => void;
  }
>();

let activeResizes = 0;
const resizeWaiters: Array<() => void> = [];

function resolveOutputMimeType(sourceMime: string): string {
  if (sourceMime.includes("png") || sourceMime.includes("gif")) {
    return "image/png";
  }
  return "image/jpeg";
}

// Human: Cap decode size to roughly 2× viewport (pinch headroom) without shipping full camera resolution.
// Agent: READS window dimensions + devicePixelRatio; RETURNS clamped max edge in px.
export function resolvePreviewDisplayMaxEdgePx(): number {
  if (typeof window === "undefined") {
    return PREVIEW_DISPLAY_MAX_EDGE_CAP_PX;
  }

  const viewportMax = Math.max(window.innerWidth, window.innerHeight);
  const dpr = window.devicePixelRatio || 1;
  const target = Math.ceil(viewportMax * dpr * PREVIEW_DISPLAY_PINCH_HEADROOM);
  return Math.min(
    PREVIEW_DISPLAY_MAX_EDGE_CAP_PX,
    Math.max(PREVIEW_DISPLAY_MAX_EDGE_FLOOR_PX, target),
  );
}

function getPreviewDisplayWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;

  worker = new Worker(new URL("./image-preview-display.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | {
          id: number;
          ok: true;
          buffer: ArrayBuffer;
          mimeType: string;
          naturalWidth: number;
          naturalHeight: number;
        }
      | { id: number; ok: false; message: string };
    const waiter = workerWaiters.get(data.id);
    if (!waiter) return;
    workerWaiters.delete(data.id);
    if (data.ok) {
      waiter.resolve({
        blob: new Blob([data.buffer], { type: data.mimeType }),
        naturalWidth: data.naturalWidth,
        naturalHeight: data.naturalHeight,
      });
      return;
    }
    waiter.reject(new Error(data.message));
  };

  worker.onerror = () => {
    for (const [, waiter] of workerWaiters) {
      waiter.reject(new Error("preview display worker crashed"));
    }
    workerWaiters.clear();
    worker = null;
  };

  return worker;
}

async function acquireResizeSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  while (activeResizes >= MAX_CONCURRENT_RESIZES) {
    await new Promise<void>((resolve, reject) => {
      const resume = () => resolve();
      resizeWaiters.push(resume);
      const onAbort = () => {
        const index = resizeWaiters.indexOf(resume);
        if (index >= 0) resizeWaiters.splice(index, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  activeResizes += 1;
  return () => {
    activeResizes = Math.max(0, activeResizes - 1);
    const next = resizeWaiters.shift();
    next?.();
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      mimeType === "image/jpeg" ? PREVIEW_JPEG_QUALITY : undefined,
    );
  });
}

// Human: Main-thread fallback when Workers are unavailable.
// Agent: USES createImageBitmap + canvas; RETURNS original blob when already within max edge.
async function resizeOnMainThread(
  source: Blob,
  maxEdgePx: number,
): Promise<PreviewDisplayImage> {
  if (!source.type.startsWith("image/")) {
    return { blob: source, naturalWidth: 0, naturalHeight: 0 };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return { blob: source, naturalWidth: 0, naturalHeight: 0 };
  }

  const naturalWidth = bitmap.width;
  const naturalHeight = bitmap.height;

  try {
    const maxEdge = Math.max(naturalWidth, naturalHeight);
    if (maxEdge <= maxEdgePx) {
      return { blob: source, naturalWidth, naturalHeight };
    }

    const scale = maxEdgePx / maxEdge;
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
    const outputMimeType = resolveOutputMimeType(source.type);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return { blob: source, naturalWidth, naturalHeight };
    }
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToBlob(canvas, outputMimeType);
    return blob
      ? { blob, naturalWidth, naturalHeight }
      : { blob: source, naturalWidth, naturalHeight };
  } finally {
    bitmap.close();
  }
}

function resizeInWorker(
  source: Blob,
  maxEdgePx: number,
  signal?: AbortSignal,
): Promise<PreviewDisplayImage> {
  const activeWorker = getPreviewDisplayWorker();
  if (!activeWorker) {
    return resizeOnMainThread(source, maxEdgePx);
  }

  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  const id = workerRequestId + 1;
  workerRequestId = id;

  return new Promise<PreviewDisplayImage>((resolve, reject) => {
    const onAbort = () => {
      workerWaiters.delete(id);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    workerWaiters.set(id, {
      resolve: (value) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      reject: (error) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    });

    void source.arrayBuffer().then(
      (buffer) => {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        activeWorker.postMessage(
          { id, buffer, mimeType: source.type, maxEdgePx },
          { transfer: [buffer] },
        );
      },
      (error) => {
        workerWaiters.delete(id);
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("preview buffer read failed"));
      },
    );
  });
}

// Human: Prepare a carousel-ready blob — large originals are downscaled off the main thread when possible.
// Agent: CALLS worker or canvas fallback; RETURNS display blob plus original dimensions for letterbox layout.
export async function preparePreviewDisplayBlob(
  source: Blob,
  maxEdgePx: number,
  signal?: AbortSignal,
): Promise<PreviewDisplayImage> {
  if (maxEdgePx <= 0) {
    return { blob: source, naturalWidth: 0, naturalHeight: 0 };
  }

  // Human: Canvas downscale captures only the first GIF frame — keep animated blobs intact.
  // Agent: SKIPS worker/canvas when isAnimatedGifBlob; STILL READS natural dimensions for mobile fit.
  if (await isAnimatedGifBlob(source)) {
    const { naturalWidth, naturalHeight } = await readImageNaturalDimensions(source);
    return { blob: source, naturalWidth, naturalHeight };
  }

  if (!source.type.startsWith("image/")) {
    return { blob: source, naturalWidth: 0, naturalHeight: 0 };
  }

  const release = await acquireResizeSlot(signal);
  try {
    return await resizeInWorker(source, maxEdgePx, signal);
  } catch {
    return resizeOnMainThread(source, maxEdgePx);
  } finally {
    release();
  }
}
