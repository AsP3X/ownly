// Human: iOS 26 WebKit blocks animated <img> GIFs and canvas.captureStream video — decode frames natively or mux MP4.
// Agent: READS ArrayBuffer; TRIES ImageDecoder canvas loop, gifuct canvas loop, then WebCodecs MP4 for <video> src.

import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { sniffImageDecoderMimeType } from "@/components/drive/image/image-preview-gif";

export type GifPlaybackHandle = {
  stop: () => void;
};

type DrawFrame = {
  delayMs: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
};

const mp4Cache = new Map<string, Blob>();

// Human: H.264 encoders require even frame sizes — round down without changing aspect ratio much.
// Agent: USED before VideoEncoder.configure and canvas sizing for client MP4 transcodes.
function evenEncodeDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded - (rounded % 2);
}

function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (isCancelled()) {
      resolve();
      return;
    }
    const id = window.setTimeout(() => resolve(), ms);
    const poll = window.setInterval(() => {
      if (isCancelled()) {
        window.clearTimeout(id);
        window.clearInterval(poll);
        resolve();
      }
    }, 50);
    window.setTimeout(() => window.clearInterval(poll), ms + 50);
  });
}

// Human: Safari freezes VideoEncoder metadata — copy fields before passing to mp4-muxer.
// Agent: RETURNS shallow clone of meta.decoderConfig for muxer.addVideoChunk on iOS WebKit.
function sanitizeEncoderMeta(meta: EncodedVideoChunkMetadata | undefined) {
  if (!meta) return undefined;
  const clean: EncodedVideoChunkMetadata = {};
  if (meta.decoderConfig !== undefined) {
    clean.decoderConfig = meta.decoderConfig;
  }
  if (meta.svc !== undefined) {
    clean.svc = meta.svc;
  }
  return clean;
}

// Human: True when the browser exposes ImageDecoder for animated GIF frame stepping.
// Agent: READS globalThis.ImageDecoder; used before gifuct on iOS 26+.
export function canUseImageDecoder(): boolean {
  return typeof ImageDecoder !== "undefined";
}

// Human: True when WebCodecs can mux a looping MP4 fallback for iOS preview.
// Agent: READS VideoEncoder + Muxer availability via typeof checks.
export function canTranscodeGifToMp4(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

// Human: Build gifuct-js draw steps including GIF disposal handling.
// Agent: READS ParsedFrame[]; RETURNS sequential draw callbacks for canvas or MP4 encode.
function buildGifuctDrawFrames(
  frames: ParsedFrame[],
  width: number,
  height: number,
): DrawFrame[] {
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return [];

  const composeCanvas = document.createElement("canvas");
  composeCanvas.width = width;
  composeCanvas.height = height;
  const composeCtx = composeCanvas.getContext("2d", { willReadFrequently: true });
  if (!composeCtx) return [];

  let frameImageData: ImageData | null = null;
  let disposalSnapshot: ImageData | null = null;
  const internalSteps: Array<{ delayMs: number; compose: () => void }> = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    internalSteps.push({
      delayMs: Math.max(20, frame.delay),
      compose: () => {
        if (index > 0) {
          const previous = frames[index - 1]!;
          if (previous.disposalType === 2) {
            composeCtx.clearRect(0, 0, width, height);
          } else if (previous.disposalType === 3 && disposalSnapshot) {
            composeCtx.putImageData(disposalSnapshot, 0, 0);
          }
        }

        if (frame.disposalType === 3) {
          disposalSnapshot = composeCtx.getImageData(0, 0, width, height);
        }

        const { dims, patch } = frame;
        if (
          !frameImageData ||
          frameImageData.width !== dims.width ||
          frameImageData.height !== dims.height
        ) {
          tempCanvas.width = dims.width;
          tempCanvas.height = dims.height;
          frameImageData = tempCtx.createImageData(dims.width, dims.height);
        }
        frameImageData.data.set(patch);
        tempCtx.putImageData(frameImageData, 0, 0);
        composeCtx.drawImage(tempCanvas, dims.left, dims.top);
      },
    });
  }

  return internalSteps.map((step) => ({
    delayMs: step.delayMs,
    draw: (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
      step.compose();
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.drawImage(composeCanvas, 0, 0);
    },
  }));
}

// Human: Parse GIF bytes into timed draw steps via gifuct-js.
// Agent: THROWS when not animated; RETURNS width/height + draw sequence.
function parseGifuctDrawFrames(buffer: ArrayBuffer): {
  width: number;
  height: number;
  frames: DrawFrame[];
} {
  const parsed = parseGIF(buffer);
  const rawFrames = decompressFrames(parsed, true);
  if (rawFrames.length <= 1) {
    throw new Error("static gif");
  }
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  return {
    width,
    height,
    frames: buildGifuctDrawFrames(rawFrames, width, height),
  };
}

// Human: Animate on a visible canvas using the browser ImageDecoder (Safari 26+).
// Agent: DECODES frameIndex loop; DRAWS VideoFrame to canvas; RETURNS stop handle.
async function startImageDecoderCanvasPlayback(
  buffer: ArrayBuffer,
  canvas: HTMLCanvasElement,
  onNaturalSize: ((width: number, height: number) => void) | undefined,
  isCancelled: () => boolean,
  mimeType: string,
): Promise<GifPlaybackHandle> {
  const decoder = new ImageDecoder({ data: buffer, type: mimeType });
  await decoder.completed;
  if (isCancelled()) {
    decoder.close();
    return { stop: () => decoder.close() };
  }

  const track = decoder.tracks.selectedTrack;
  if (!track || track.frameCount <= 1) {
    decoder.close();
    throw new Error("static gif");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    decoder.close();
    throw new Error("no canvas context");
  }

  const first = await decoder.decode({ frameIndex: 0 });
  if (isCancelled()) {
    first.image.close();
    decoder.close();
    return { stop: () => decoder.close() };
  }

  canvas.width = evenEncodeDimension(first.image.displayWidth);
  canvas.height = evenEncodeDimension(first.image.displayHeight);
  onNaturalSize?.(canvas.width, canvas.height);
  first.image.close();

  let frameIndex = 0;
  let running = true;

  const tick = async () => {
    while (running && !isCancelled()) {
      const result = await decoder.decode({ frameIndex });
      if (!running || isCancelled()) {
        result.image.close();
        break;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(result.image, 0, 0, canvas.width, canvas.height);
      const delayMs = Math.max(20, (result.image.duration ?? 100_000) / 1000);
      result.image.close();

      frameIndex = (frameIndex + 1) % track.frameCount;
      await sleep(delayMs, () => !running || isCancelled());
    }
    decoder.close();
  };

  void tick();

  return {
    stop: () => {
      running = false;
      decoder.close();
    },
  };
}

// Human: Run a timed draw-frame loop on a visible 2D canvas.
// Agent: CALLS draw() each tick via setTimeout; RETURNS stop handle.
function startCanvasDrawLoop(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  frames: DrawFrame[],
  onNaturalSize: ((width: number, height: number) => void) | undefined,
  isCancelled: () => boolean,
): GifPlaybackHandle {
  canvas.width = evenEncodeDimension(width);
  canvas.height = evenEncodeDimension(height);
  onNaturalSize?.(canvas.width, canvas.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("no canvas context");
  }

  let frameIndex = 0;
  let timeoutId = 0;
  let running = true;

  const composeCanvas = document.createElement("canvas");
  composeCanvas.width = width;
  composeCanvas.height = height;
  const composeCtx = composeCanvas.getContext("2d");
  if (!composeCtx) {
    throw new Error("no compose canvas context");
  }

  const render = () => {
    if (!running || isCancelled()) return;
    frames[frameIndex]!.draw(composeCtx, width, height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(composeCanvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
    const delayMs = frames[frameIndex]!.delayMs;
    frameIndex = (frameIndex + 1) % frames.length;
    timeoutId = window.setTimeout(render, delayMs);
  };

  render();

  return {
    stop: () => {
      running = false;
      window.clearTimeout(timeoutId);
    },
  };
}

// Human: Mux gifuct frames into a looping H.264 MP4 blob for iOS <video> playback.
// Agent: USES VideoEncoder + mp4-muxer; CACHES by cacheKey when provided.
export async function transcodeGifToMp4(
  buffer: ArrayBuffer,
  cacheKey?: string,
  onNaturalSize?: (width: number, height: number) => void,
): Promise<Blob> {
  if (cacheKey) {
    const cached = mp4Cache.get(cacheKey);
    if (cached) return cached;
  }

  const { width, height, frames } = parseGifuctDrawFrames(buffer);
  const encodeWidth = evenEncodeDimension(width);
  const encodeHeight = evenEncodeDimension(height);
  onNaturalSize?.(encodeWidth, encodeHeight);

  const composeCanvas = document.createElement("canvas");
  composeCanvas.width = width;
  composeCanvas.height = height;
  const composeCtx = composeCanvas.getContext("2d");
  if (!composeCtx) {
    throw new Error("no compose canvas context");
  }

  const canvas = document.createElement("canvas");
  canvas.width = encodeWidth;
  canvas.height = encodeHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("no canvas context");
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: encodeWidth, height: encodeHeight },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, sanitizeEncoderMeta(meta));
    },
    error: (error) => {
      throw error;
    },
  });

  encoder.configure({
    codec: "avc1.42001f",
    width: encodeWidth,
    height: encodeHeight,
    bitrate: 1_000_000,
  });

  let timestampUs = 0;
  for (let index = 0; index < frames.length; index += 1) {
    frames[index]!.draw(composeCtx, width, height);
    ctx.clearRect(0, 0, encodeWidth, encodeHeight);
    ctx.drawImage(composeCanvas, 0, 0, width, height, 0, 0, encodeWidth, encodeHeight);
    const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });
    encoder.encode(videoFrame, { keyFrame: index === 0 || index % 30 === 0 });
    videoFrame.close();
    timestampUs += frames[index]!.delayMs * 1000;
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: "video/mp4" });
  if (cacheKey) {
    mp4Cache.set(cacheKey, blob);
  }
  return blob;
}

// Human: Mux ImageDecoder frames (GIF or WebP) into H.264 MP4 for iOS <video> playback.
// Agent: DECODES each frameIndex; ENCODES via VideoEncoder; CACHES by cacheKey when provided.
async function transcodeViaImageDecoderToMp4(
  buffer: ArrayBuffer,
  mimeType: string,
  cacheKey?: string,
  onNaturalSize?: (width: number, height: number) => void,
): Promise<Blob> {
  if (cacheKey) {
    const cached = mp4Cache.get(cacheKey);
    if (cached) return cached;
  }

  const decoder = new ImageDecoder({ data: buffer, type: mimeType });
  await decoder.completed;
  const track = decoder.tracks.selectedTrack;
  if (!track || track.frameCount <= 1) {
    decoder.close();
    throw new Error("static image");
  }

  const first = await decoder.decode({ frameIndex: 0 });
  const encodeWidth = evenEncodeDimension(first.image.displayWidth);
  const encodeHeight = evenEncodeDimension(first.image.displayHeight);
  first.image.close();
  onNaturalSize?.(encodeWidth, encodeHeight);

  const canvas = document.createElement("canvas");
  canvas.width = encodeWidth;
  canvas.height = encodeHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    decoder.close();
    throw new Error("no canvas context");
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: encodeWidth, height: encodeHeight },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, sanitizeEncoderMeta(meta));
    },
    error: (error) => {
      throw error;
    },
  });

  encoder.configure({
    codec: "avc1.42001f",
    width: encodeWidth,
    height: encodeHeight,
    bitrate: 1_000_000,
  });

  let timestampUs = 0;
  for (let index = 0; index < track.frameCount; index += 1) {
    const result = await decoder.decode({ frameIndex: index });
    ctx.clearRect(0, 0, encodeWidth, encodeHeight);
    ctx.drawImage(
      result.image,
      0,
      0,
      result.image.displayWidth,
      result.image.displayHeight,
      0,
      0,
      encodeWidth,
      encodeHeight,
    );
    const delayMs = Math.max(20, (result.image.duration ?? 100_000) / 1000);
    result.image.close();

    const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });
    encoder.encode(videoFrame, { keyFrame: index === 0 || index % 30 === 0 });
    videoFrame.close();
    timestampUs += delayMs * 1000;
  }

  decoder.close();
  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: "video/mp4" });
  if (cacheKey) {
    mp4Cache.set(cacheKey, blob);
  }
  return blob;
}

export type StartIosGifPlaybackOptions = {
  buffer: ArrayBuffer;
  canvas: HTMLCanvasElement;
  cacheKey?: string;
  onNaturalSize?: (width: number, height: number) => void;
  isCancelled: () => boolean;
  onVideoReady?: (objectUrl: string) => void;
};

// Human: Pick the best iOS GIF strategy — MP4 first (WebKit 26), then ImageDecoder, then gifuct canvas.
// Agent: RETURNS canvas handle or null when MP4 video takes over via onVideoReady.
export async function startIosGifPlayback(
  options: StartIosGifPlaybackOptions,
): Promise<GifPlaybackHandle | null> {
  const { buffer, canvas, cacheKey, onNaturalSize, isCancelled, onVideoReady } = options;
  const mimeType = sniffImageDecoderMimeType(buffer);
  const isWebp = mimeType === "image/webp";

  if (canTranscodeGifToMp4() && onVideoReady) {
    try {
      const mp4Blob = isWebp
        ? await transcodeViaImageDecoderToMp4(buffer, mimeType, cacheKey, onNaturalSize)
        : await transcodeGifToMp4(buffer, cacheKey, onNaturalSize);
      if (isCancelled()) return { stop: () => undefined };
      const objectUrl = URL.createObjectURL(mp4Blob);
      onVideoReady(objectUrl);
      return {
        stop: () => {
          URL.revokeObjectURL(objectUrl);
        },
      };
    } catch {
      // Human: Fall through to canvas loops when WebCodecs mux fails (older WebKit builds).
    }
  }

  if (canUseImageDecoder()) {
    try {
      return await startImageDecoderCanvasPlayback(
        buffer,
        canvas,
        onNaturalSize,
        isCancelled,
        mimeType,
      );
    } catch {
      // Human: Fall through to gifuct when ImageDecoder rejects the bitstream.
    }
  }

  if (isWebp) {
    throw new Error("webp playback unavailable");
  }

  try {
    const { width, height, frames } = parseGifuctDrawFrames(buffer);
    return startCanvasDrawLoop(canvas, width, height, frames, onNaturalSize, isCancelled);
  } catch {
    throw new Error("gif playback unavailable");
  }
}
