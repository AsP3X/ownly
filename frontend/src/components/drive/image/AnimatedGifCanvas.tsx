// Human: Canvas GIF playback for iOS Safari — manual frame painting avoids frozen <img> animation in modals.
// Agent: FETCHES url bytes; CALLS gifuct-js parse/decompress; RENDERS frames via requestAnimationFrame loop.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { decompressFrames, parseGIF } from "gifuct-js";

type AnimatedGifCanvasProps = {
  url: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onNaturalSize?: (width: number, height: number) => void;
};

// Human: Paint GIF frames to canvas using gifuct-js patches — same approach as the library demo.
// Agent: READS ParsedFrame[]; WRITES compose buffer then blits to visible canvas each tick.
export function AnimatedGifCanvas({
  url,
  alt,
  fitStyle,
  className,
  onNaturalSize,
}: AnimatedGifCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    let rafId = 0;

    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    const composeCanvas = document.createElement("canvas");
    const composeCtx = composeCanvas.getContext("2d");

    async function start() {
      if (!tempCtx || !composeCtx) return;

      try {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) {
          throw new Error("gif fetch failed");
        }

        const buffer = await response.arrayBuffer();
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

        const display = canvasRef.current;
        if (!display || cancelled) return;

        display.width = width;
        display.height = height;
        onNaturalSize?.(width, height);

        const displayCtx = display.getContext("2d");
        if (!displayCtx) return;

        let frameIndex = 0;
        let frameImageData: ImageData | null = null;

        const drawPatch = (frame: (typeof frames)[number]) => {
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
        };

        const renderFrame = () => {
          if (cancelled) return;

          const frame = frames[frameIndex]!;
          if (frame.disposalType === 2) {
            composeCtx.clearRect(0, 0, width, height);
          }

          drawPatch(frame);
          displayCtx.clearRect(0, 0, width, height);
          displayCtx.drawImage(composeCanvas, 0, 0);

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
    };
  }, [url, onNaturalSize]);

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
