// Human: iOS GIF preview — native ImageDecoder or gifuct canvas; MP4 video when WebKit blocks both.
// Agent: READS byteSource; CALLS startIosGifPlayback; NEVER uses captureStream (broken on iOS WebKit).

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { startIosGifPlayback } from "@/components/drive/image/animated-gif-playback";
import { isAppleTouchDevice } from "@/components/drive/image/image-preview-gif";

type AnimatedGifCanvasProps = {
  /** Human: Preferred on iOS — avoids fetch(blob:) and duplicate stream requests. */
  byteSource?: Blob | ArrayBuffer | null;
  /** Human: Cache key for MP4 transcode reuse across carousel swipes. */
  fileId?: string;
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

// Human: Animated GIF surface for iOS — canvas frame loop or transcoded MP4, not native <img>.
// Agent: MOUNTS canvas or video; STARTS startIosGifPlayback when bytes are ready.
export function AnimatedGifCanvas({
  byteSource,
  fileId,
  url,
  alt,
  fitStyle,
  className,
  onNaturalSize,
}: AnimatedGifCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isPreparing, setIsPreparing] = useState(true);
  const [waitingForBytes, setWaitingForBytes] = useState(
    isAppleTouchDevice() && !byteSource,
  );

  useEffect(() => {
    if (isAppleTouchDevice() && !byteSource) {
      setWaitingForBytes(true);
      return;
    }
    setWaitingForBytes(false);
    setIsPreparing(true);

    let cancelled = false;
    let playbackHandle: { stop: () => void } | null = null;
    let objectUrl: string | null = null;

    async function start() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        const buffer = await loadGifArrayBuffer(byteSource, url);
        if (cancelled) return;

        const handle = await startIosGifPlayback({
          buffer,
          canvas,
          cacheKey: fileId,
          onNaturalSize,
          isCancelled: () => cancelled,
          onVideoReady: (nextUrl) => {
            if (cancelled) {
              URL.revokeObjectURL(nextUrl);
              return;
            }
            objectUrl = nextUrl;
            setVideoUrl(nextUrl);
            setIsPreparing(false);
            const video = videoRef.current;
            if (video) {
              video.src = nextUrl;
              video.muted = true;
              video.playsInline = true;
              video.loop = true;
              void video.play().catch(() => undefined);
            }
          },
        });

        if (cancelled) {
          handle?.stop();
          return;
        }

        playbackHandle = handle;
        setLoadError(false);
        setIsPreparing(false);
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setIsPreparing(false);
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      playbackHandle?.stop();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setVideoUrl(null);
    };
  }, [byteSource, fileId, url, onNaturalSize]);

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
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        style={{
          ...fitStyle,
          display: videoUrl ? "none" : undefined,
        }}
        className={className}
      />
      {waitingForBytes || isPreparing ? (
        <span className="sr-only" aria-live="polite">
          Preparing animated image…
        </span>
      ) : null}
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={{
          ...fitStyle,
          display: videoUrl ? undefined : "none",
        }}
        className={className}
        src={videoUrl ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        controls={false}
      />
    </>
  );
}
