// Human: iOS GIF preview — static poster first, server MP4 on active slide, client fallback last.
// Agent: READS byteSource poster; FETCHES preview-animation only when enableServerAnimation; PLAYS video.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { startIosGifPlayback } from "@/components/drive/image/animated-gif-playback";
import { withAnimatedPreviewContainFit } from "@/components/drive/image/image-preview-layout";
import {
  isAppleTouchDevice,
  isServerGifAnimationPreviewUrl,
} from "@/components/drive/image/image-preview-gif";
import { cn } from "@/lib/utils";

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
  /** Human: Blob object URL for the static poster while server MP4 is generated. */
  url: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onNaturalSize?: (width: number, height: number) => void;
  /** Human: When false, show the static poster only (carousel neighbors — no ffmpeg). */
  enableServerAnimation?: boolean;
  /** Human: Resolve ticket URL for preview-animation; does not download the MP4 body. */
  resolveAnimationPreviewUrl?: (
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<string | null>;
};

// Human: Build an object URL for the first GIF/WebP frame shown while MP4 transcode runs.
// Agent: READS byteSource; FALLBACK to existing blob display URL from the preview cache.
function usePosterObjectUrl(
  byteSource: Blob | ArrayBuffer | null | undefined,
  fallbackUrl: string,
): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(() =>
    fallbackUrl.startsWith("blob:") ? fallbackUrl : null,
  );

  useEffect(() => {
    if (byteSource instanceof Blob) {
      const nextUrl = URL.createObjectURL(byteSource);
      setObjectUrl(nextUrl);
      return () => URL.revokeObjectURL(nextUrl);
    }
    if (byteSource instanceof ArrayBuffer) {
      const nextUrl = URL.createObjectURL(new Blob([byteSource]));
      setObjectUrl(nextUrl);
      return () => URL.revokeObjectURL(nextUrl);
    }
    if (fallbackUrl.startsWith("blob:")) {
      setObjectUrl(fallbackUrl);
      return;
    }
    setObjectUrl(null);
  }, [byteSource, fallbackUrl]);

  return objectUrl;
}

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

type StaticGifPosterProps = {
  posterUrl: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
};

// Human: Static first frame for iOS while server ffmpeg transcode runs in the background.
// Agent: RENDERS img with sync decode; SAME layout box as the eventual MP4 surface.
function StaticGifPoster({ posterUrl, alt, fitStyle, className }: StaticGifPosterProps) {
  const mediaStyle = resolveAnimatedMediaStyle(fitStyle);

  return (
    <img
      src={posterUrl}
      alt={alt}
      style={mediaStyle}
      className={cn(className, "block object-contain")}
      draggable={false}
      loading="eager"
      decoding="sync"
    />
  );
}

type ServerGifVideoProps = {
  animationUrl: string;
  posterUrl: string | null;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onFailed?: () => void;
};

// Human: Play ffmpeg-generated MP4 — poster stays visible until the stream can play.
// Agent: SETS video src on mount (starts server transcode); HIDES poster on canplay/playing.
function ServerGifVideo({
  animationUrl,
  posterUrl,
  alt,
  fitStyle,
  className,
  onFailed,
}: ServerGifVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStyle = withAnimatedPreviewContainFit(fitStyle, 0, 0);
  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    setIsVideoReady(false);
  }, [animationUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const markReady = () => setIsVideoReady(true);

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
    video.addEventListener("canplay", markReady);
    video.addEventListener("playing", markReady);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && video.paused) {
        tryPlay();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      video.removeEventListener("canplay", tryPlay);
      video.removeEventListener("canplay", markReady);
      video.removeEventListener("playing", markReady);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [animationUrl, onFailed]);

  return (
    <div className="relative" style={mediaStyle}>
      {posterUrl && !isVideoReady ? (
        <StaticGifPoster
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={cn(className, "absolute inset-0 size-full")}
        />
      ) : null}
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={{ objectFit: "contain" }}
        className={cn(
          className,
          "block size-full",
          !isVideoReady && posterUrl ? "opacity-0" : "opacity-100",
        )}
        src={animationUrl}
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
      {!isVideoReady ? (
        <span className="sr-only" aria-live="polite">
          Preparing animation…
        </span>
      ) : null}
    </div>
  );
}

// Human: Animated GIF surface for iOS — static poster, lazy server MP4, or client decode fallback.
// Agent: SKIPS preview-animation fetch unless enableServerAnimation; AVOIDS ffmpeg on prefetch slides.
export function AnimatedGifCanvas({
  byteSource,
  fileId,
  url,
  alt,
  fitStyle,
  className,
  onNaturalSize,
  enableServerAnimation = true,
  resolveAnimationPreviewUrl,
}: AnimatedGifCanvasProps) {
  const posterUrl = usePosterObjectUrl(byteSource, url);
  const [animationUrl, setAnimationUrl] = useState<string | null>(
    enableServerAnimation && isServerGifAnimationPreviewUrl(url) ? url : null,
  );
  const [serverVideoFailed, setServerVideoFailed] = useState(false);

  useEffect(() => {
    setServerVideoFailed(false);
    setAnimationUrl(
      enableServerAnimation && isServerGifAnimationPreviewUrl(url) ? url : null,
    );
  }, [enableServerAnimation, fileId, url]);

  useEffect(() => {
    if (
      !enableServerAnimation ||
      !fileId ||
      !resolveAnimationPreviewUrl ||
      serverVideoFailed ||
      animationUrl
    ) {
      return;
    }

    const controller = new AbortController();
    void resolveAnimationPreviewUrl(fileId, controller.signal).then((nextUrl) => {
      if (!controller.signal.aborted && nextUrl) {
        setAnimationUrl(nextUrl);
      }
    });

    return () => controller.abort();
  }, [
    animationUrl,
    enableServerAnimation,
    fileId,
    resolveAnimationPreviewUrl,
    serverVideoFailed,
  ]);

  if (!enableServerAnimation) {
    return posterUrl ? (
      <StaticGifPoster
        posterUrl={posterUrl}
        alt={alt}
        fitStyle={fitStyle}
        className={className}
      />
    ) : null;
  }

  if (animationUrl && !serverVideoFailed) {
    return (
      <ServerGifVideo
        animationUrl={animationUrl}
        posterUrl={posterUrl}
        alt={alt}
        fitStyle={fitStyle}
        className={className}
        onFailed={() => setServerVideoFailed(true)}
      />
    );
  }

  if (!serverVideoFailed && posterUrl) {
    return (
      <>
        <StaticGifPoster
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={className}
        />
        <span className="sr-only" aria-live="polite">
          Preparing animation…
        </span>
      </>
    );
  }

  return (
    <ClientGifPlayback
      byteSource={byteSource}
      fileId={fileId}
      url={url}
      posterUrl={posterUrl}
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
  posterUrl?: string | null;
};

// Human: Client-side GIF decode when server MP4 is unavailable (share links, offline dev).
// Agent: CALLS startIosGifPlayback; KEEPS static poster visible until client MP4 plays.
function ClientGifPlayback({
  byteSource,
  fileId,
  url,
  posterUrl,
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
  const [clientVideoReady, setClientVideoReady] = useState(false);
  const waitingForBytes =
    isAppleTouchDevice() && !byteSource && (preferByteSource || !isServerGifAnimationPreviewUrl(url));

  useEffect(() => {
    setClientVideoReady(false);
  }, [byteSource, fileId, url, preferByteSource]);

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
    return posterUrl ? (
      <StaticGifPoster
        posterUrl={posterUrl}
        alt={alt}
        fitStyle={fitStyle}
        className={className}
      />
    ) : (
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

  const showPoster =
    Boolean(posterUrl) &&
    (waitingForBytes || isPreparing || (Boolean(videoUrl) && !clientVideoReady));

  return (
    <div className="relative" style={mediaStyle}>
      {showPoster && posterUrl ? (
        <StaticGifPoster
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={cn(className, "absolute inset-0 size-full")}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        style={{
          objectFit: "contain",
          display: videoUrl ? "none" : undefined,
        }}
        className={cn(className, "block size-full")}
      />
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={{
          objectFit: "contain",
          display: videoUrl ? undefined : "none",
          opacity: clientVideoReady || !posterUrl ? 1 : 0,
        }}
        className={cn(className, "block size-full")}
        src={videoUrl ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        {...({ "webkit-playsinline": "true" } as Record<string, string>)}
        disablePictureInPicture
        controls={false}
        onPlaying={() => setClientVideoReady(true)}
      />
      {waitingForBytes || isPreparing ? (
        <span className="sr-only" aria-live="polite">
          Preparing animated image…
        </span>
      ) : null}
    </div>
  );
}
