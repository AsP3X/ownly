// Human: iOS GIF preview — server MP4 first, then client transcode; never uses broken captureStream.
// Agent: READS preview-animation URL or byteSource; PLAYS muted video or CALLS startIosGifPlayback.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { startIosGifPlayback } from "@/components/drive/image/animated-gif-playback";
import { withAnimatedPreviewContainFit } from "@/components/drive/image/image-preview-layout";
import {
  isAppleTouchDevice,
  isServerGifAnimationPreviewUrl,
} from "@/components/drive/image/image-preview-gif";

// Human: Normalize fit styles so video/canvas never stretch when parent passes width/height percentages.
// Agent: MERGES fitStyle; FORCES objectFit contain on every animated preview surface.
function resolveAnimatedMediaStyle(fitStyle: CSSProperties): CSSProperties {
  return withAnimatedPreviewContainFit(fitStyle, 0, 0);
}

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
  if (!url) {
    throw new Error("gif bytes unavailable");
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
  onFailed?: () => void;
};

// Human: Play ffmpeg-generated MP4 from the API — primary iOS WebKit GIF workaround.
// Agent: MOUNTS muted looping video; CALLS onFailed when the ticket stream is not playable.
function ServerGifVideo({
  url,
  alt,
  fitStyle,
  className,
  onFailed,
}: Omit<ServerGifVideoProps, "onNaturalSize">) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStyle = withAnimatedPreviewContainFit(fitStyle, 0, 0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Human: iOS may block first autoplay — retry on canplay and when tab becomes visible again.
    // Agent: CALLS muted play(); INVOKES onFailed when playback stays blocked.
    const tryPlay = () => {
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      void video.play().catch(() => onFailed?.());
    };

    tryPlay();
    video.addEventListener("canplay", tryPlay);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && video.paused) {
        tryPlay();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      video.removeEventListener("canplay", tryPlay);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, onFailed]);

  return (
    <video
      ref={videoRef}
      role="img"
      aria-label={alt}
      style={mediaStyle}
      className={className}
      src={url}
      autoPlay
      muted
      loop
      playsInline
      // Human: Legacy WebKit attribute — some iOS builds still require it alongside playsInline.
      // Agent: SETS webkit-playsinline for Safari animated preview reliability.
      {...({ "webkit-playsinline": "true" } as Record<string, string>)}
      disablePictureInPicture
      controls={false}
      onError={() => onFailed?.()}
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
  const [serverVideoFailed, setServerVideoFailed] = useState(false);
  const useServerVideo =
    isServerGifAnimationPreviewUrl(url) && !serverVideoFailed;

  if (useServerVideo) {
    return (
      <ServerGifVideo
        url={url}
        alt={alt}
        fitStyle={fitStyle}
        className={className}
        onFailed={() => setServerVideoFailed(true)}
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
      preferByteSource={serverVideoFailed}
    />
  );
}

type ClientGifPlaybackProps = AnimatedGifCanvasProps & {
  preferByteSource?: boolean;
};

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
  preferByteSource = false,
}: ClientGifPlaybackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStyle = resolveAnimatedMediaStyle(fitStyle);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isPreparing, setIsPreparing] = useState(true);
  const waitingForBytes =
    isAppleTouchDevice() && !byteSource && (preferByteSource || !isServerGifAnimationPreviewUrl(url));

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
        const buffer = await loadGifArrayBuffer(
          byteSource,
          preferByteSource ? "" : url,
        );
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
  }, [byteSource, fileId, url, onNaturalSize, waitingForBytes, preferByteSource]);

  if (loadError && !isAppleTouchDevice()) {
    return (
      <img
        src={url}
        alt={alt}
        style={mediaStyle}
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
          ...mediaStyle,
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
          ...mediaStyle,
          display: videoUrl ? undefined : "none",
        }}
        className={className}
        src={videoUrl ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        {...({ "webkit-playsinline": "true" } as Record<string, string>)}
        disablePictureInPicture
        controls={false}
      />
    </>
  );
}
