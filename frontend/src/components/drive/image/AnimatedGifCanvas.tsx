// Human: Canvas GIF playback for iOS Safari — manual frame painting avoids frozen <img> animation in modals.
// Agent: READS byteSource or FETCHES url; CALLS gifuct-js; RENDERS via hidden canvas + captureStream video on iOS.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import { shouldUseGifVideoPlayback } from "@/components/drive/image/image-preview-gif";

type AnimatedGifCanvasProps = {
  /** Human: Preferred on iOS — avoids fetch(blob:) and duplicate stream requests. */
  byteSource?: Blob | ArrayBuffer | null;
  /** Human: Fallback when bytes are not cached (public share or legacy paths). */
  url: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onNaturalSize?: (width: number, height: number) => void;
};

// Human: Resolve GIF bytes from an in-memory blob or a same-origin / blob URL fetch.
// Agent: READS byteSource first; FETCHES url with credentials when bytes are missing.
async function loadGifArrayBuffer(
  byteSource: Blob | ArrayBuffer | null | undefined,
  url: string,
): Promise<ArrayBuffer> {
  if (byteSource instanceof ArrayBuffer) {
    return byteSource;
  }
  if (byteSource instanceof Blob) {
    return byteSource.arrayBuffer();
  }

  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    throw new Error("gif fetch failed");
  }
  return response.arrayBuffer();
}

// Human: Paint one gifuct-js patch onto the compose buffer.
// Agent: WRITES patch RGBA into temp ImageData; drawImage at frame offset on compose canvas.
function drawPatch(
  frame: ParsedFrame,
  tempCanvas: HTMLCanvasElement,
  tempCtx: CanvasRenderingContext2D,
  composeCtx: CanvasRenderingContext2D,
  frameImageDataRef: { current: ImageData | null },
) {
  const { dims, patch } = frame;
  if (
    !frameImageDataRef.current ||
    frameImageDataRef.current.width !== dims.width ||
    frameImageDataRef.current.height !== dims.height
  ) {
    tempCanvas.width = dims.width;
    tempCanvas.height = dims.height;
    frameImageDataRef.current = tempCtx.createImageData(dims.width, dims.height);
  }
  frameImageDataRef.current.data.set(patch);
  tempCtx.putImageData(frameImageDataRef.current, 0, 0);
  composeCtx.drawImage(tempCanvas, dims.left, dims.top);
}

// Human: Paint GIF frames to canvas; on iOS Safari mirror through captureStream + muted video.
// Agent: READS ParsedFrame[]; WRITES compose buffer; UPDATES visible canvas or video each tick.
export function AnimatedGifCanvas({
  byteSource,
  url,
  alt,
  fitStyle,
  className,
  onNaturalSize,
}: AnimatedGifCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadError, setLoadError] = useState(false);
  const useVideoPlayback = shouldUseGifVideoPlayback();

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    let rafId = 0;
    let mediaStream: MediaStream | null = null;

    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    const composeCanvas = document.createElement("canvas");
    const composeCtx = composeCanvas.getContext("2d", { willReadFrequently: true });
    const frameImageDataRef = { current: null as ImageData | null };

    async function start() {
      if (!tempCtx || !composeCtx) return;

      try {
        const buffer = await loadGifArrayBuffer(byteSource, url);
        if (cancelled) return;

        const parsed = parseGIF(buffer);
        const frames = decompressFrames(parsed, true);
        if (frames.length <= 1) {
          throw new Error("static gif");
        }

        const width = parsed.lsd.width;
        const height = parsed.lsd.height;
        composeCanvas.width = width;
        composeCanvas.height = height;

        const displayCanvas = useVideoPlayback ? null : canvasRef.current;
        const displayVideo = useVideoPlayback ? videoRef.current : null;
        if (cancelled || (!displayCanvas && !displayVideo)) return;

        if (displayCanvas) {
          displayCanvas.width = width;
          displayCanvas.height = height;
        }

        onNaturalSize?.(width, height);

        let displayCtx: CanvasRenderingContext2D | null = null;
        if (displayCanvas) {
          displayCtx = displayCanvas.getContext("2d");
          if (!displayCtx) return;
        }

        if (displayVideo) {
          mediaStream = composeCanvas.captureStream(15);
          displayVideo.srcObject = mediaStream;
          displayVideo.muted = true;
          displayVideo.playsInline = true;
          displayVideo.loop = true;
          await displayVideo.play().catch(() => undefined);
        }

        let frameIndex = 0;
        let disposalSnapshot: ImageData | null = null;

        const blitToDisplay = () => {
          if (useVideoPlayback) return;
          displayCtx?.clearRect(0, 0, width, height);
          displayCtx?.drawImage(composeCanvas, 0, 0);
        };

        const renderFrame = () => {
          if (cancelled) return;

          if (frameIndex > 0) {
            const previous = frames[frameIndex - 1]!;
            if (previous.disposalType === 2) {
              composeCtx.clearRect(0, 0, width, height);
            } else if (previous.disposalType === 3 && disposalSnapshot) {
              composeCtx.putImageData(disposalSnapshot, 0, 0);
            }
          }

          const frame = frames[frameIndex]!;
          if (frame.disposalType === 3) {
            disposalSnapshot = composeCtx.getImageData(0, 0, width, height);
          }

          drawPatch(frame, tempCanvas, tempCtx, composeCtx, frameImageDataRef);
          blitToDisplay();

          const delay = Math.max(20, frame.delay);
          frameIndex = (frameIndex + 1) % frames.length;

          timeoutId = window.setTimeout(() => {
            rafId = requestAnimationFrame(renderFrame);
          }, delay);
        };

        rafId = requestAnimationFrame(renderFrame);
        setLoadError(false);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      cancelAnimationFrame(rafId);
      for (const track of mediaStream?.getTracks() ?? []) {
        track.stop();
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [byteSource, url, onNaturalSize, useVideoPlayback]);

  if (loadError) {
    return (
      <img
        src={url}
        alt={alt}
        style={fitStyle}
        className={className}
        draggable={false}
        loading="eager"
        decoding="sync"
      />
    );
  }

  if (useVideoPlayback) {
    return (
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={fitStyle}
        className={className}
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        controls={false}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      style={fitStyle}
      className={className}
    />
  );
}
