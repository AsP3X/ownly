// Human: iOS GIF preview — server MP4 first, then client transcode; never uses broken captureStream.
// Agent: READS preview-animation URL or byteSource; PLAYS muted video or CALLS startIosGifPlayback.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { startIosGifPlayback } from "@/components/drive/image/animated-gif-playback";
import {
  isAppleTouchDevice,
  isServerGifAnimationPreviewUrl,
} from "@/components/drive/image/image-preview-gif";

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

type ServerGifVideoProps = {
  url: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onNaturalSize?: (width: number, height: number) => void;
};

// Human: Play ffmpeg-generated MP4 from the API — primary iOS WebKit GIF workaround.
// Agent: MOUNTS muted looping video; READS natural size from loadedmetadata.
function ServerGifVideo({ url, alt, fitStyle, className, onNaturalSize }: ServerGifVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    void video.play().catch(() => undefined);
  }, [url]);

  return (
    <video
      ref={videoRef}
      role="img"
      aria-label={alt}
      style={fitStyle}
      className={className}
      src={url}
      autoPlay
      muted
      loop
      playsInline
      disablePictureInPicture
      controls={false}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          onNaturalSize?.(video.videoWidth, video.videoHeight);
        }
      }}
    />
  );
}

// Human: Animated GIF surface for iOS — server MP4, client MP4 transcode, or canvas loops.
// Agent: MOUNTS video/canvas; STARTS playback when bytes or preview-animation URL are ready.
export function AnimatedGifCanvas({
  byteSource,
  fileId,
  url,
  alt,
  fitStyle,
  className,
  onNaturalSize,
}: AnimatedGifCanvasProps) {
  if (isServerGifAnimationPreviewUrl(url)) {
    return (
      <ServerGifVideo
        url={url}
        alt={alt}
        fitStyle={fitStyle}
        className={className}
        onNaturalSize={onNaturalSize}
      />
    );
  }

  return (
    <ClientGifPlayback
      byteSource={byteSource}
      fileId={fileId}
      url={url}
      alt={alt}
      fitStyle={fitStyle}
      className={className}
      onNaturalSize={onNaturalSize}
    />
  );
}

type ClientGifPlaybackProps = AnimatedGifCanvasProps;

// Human: Client-side GIF decode when server MP4 is unavailable (share links, offline dev).
// Agent: CALLS startIosGifPlayback; FALLBACK img only off iOS.
function ClientGifPlayback({
  byteSource,
  fileId,
  url,
  alt,
  fitStyle,
  className,
  onNaturalSize,
}: ClientGifPlaybackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isPreparing, setIsPreparing] = useState(true);
  const waitingForBytes = isAppleTouchDevice() && !byteSource;

  useEffect(() => {
    if (waitingForBytes) {
      return;
    }
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
  }, [byteSource, fileId, url, onNaturalSize, waitingForBytes]);

  if (loadError && !isAppleTouchDevice()) {
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

  if (loadError && isAppleTouchDevice()) {
    return (
      <p className="px-4 text-center text-sm text-white/70" role="status">
        Could not play this animated image on iOS.
      </p>
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
