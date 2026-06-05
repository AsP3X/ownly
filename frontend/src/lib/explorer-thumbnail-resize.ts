// Human: Main-thread fallback + worker dispatch for client-side grid thumbnail downscale.
// Agent: PREFERS worker when available; FALLBACK sync resize for tests or unsupported browsers.

const GRID_THUMBNAIL_MAX_EDGE_PX = 280;

let worker: Worker | null = null;
let workerRequestId = 0;
const workerWaiters = new Map<
  number,
  { resolve: (buffer: ArrayBuffer) => void; reject: (error: Error) => void }
>();

function getThumbnailWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;

  worker = new Worker(new URL("./explorer-thumbnail.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { id: number; ok: true; buffer: ArrayBuffer }
      | { id: number; ok: false; message: string };
    const waiter = workerWaiters.get(data.id);
    if (!waiter) return;
    workerWaiters.delete(data.id);
    if (data.ok) {
      waiter.resolve(data.buffer);
      return;
    }
    waiter.reject(new Error(data.message));
  };

  worker.onerror = () => {
    for (const [, waiter] of workerWaiters) {
      waiter.reject(new Error("thumbnail worker crashed"));
    }
    workerWaiters.clear();
    worker = null;
  };

  return worker;
}

// Human: Resize in a dedicated worker so decode does not compete with scroll on the main thread.
// Agent: POSTS ArrayBuffer to explorer-thumbnail.worker; RETURNS JPEG Blob.
function resizeImageBlobInWorker(source: Blob, signal?: AbortSignal): Promise<Blob> {
  const activeWorker = getThumbnailWorker();
  if (!activeWorker) {
    return resizeImageBlobOnMainThread(source);
  }

  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  const id = workerRequestId + 1;
  workerRequestId = id;

  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => {
      workerWaiters.delete(id);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    workerWaiters.set(id, {
      resolve: (buffer) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(new Blob([buffer], { type: "image/jpeg" }));
      },
      reject: (error) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    });

    void source.arrayBuffer().then((buffer) => {
      if (signal?.aborted) {
        onAbort();
        return;
      }
      activeWorker.postMessage({ id, buffer, mimeType: source.type }, { transfer: [buffer] });
    }, reject);
  });
}

function isAlreadyGridSized(width: number, height: number) {
  return Math.max(width, height) <= GRID_THUMBNAIL_MAX_EDGE_PX;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
  });
}

// Human: Synchronous resize path when Workers are unavailable (SSR/tests/safari quirks).
// Agent: USES createImageBitmap + canvas; RETURNS original blob when already small enough.
async function resizeImageBlobOnMainThread(source: Blob): Promise<Blob> {
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

// Human: Public resize entry — prefers worker, falls back to main thread.
// Agent: CALLED by explorer thumbnail loader for legacy images without server grid JPEGs.
export async function resizeImageBlobForGridTile(
  source: Blob,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!source.type.startsWith("image/")) {
    return source;
  }
  try {
    return await resizeImageBlobInWorker(source, signal);
  } catch {
    return resizeImageBlobOnMainThread(source);
  }
}
