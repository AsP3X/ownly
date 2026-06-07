// Human: iOS GIF preview — static poster first, server MP4 on active slide, client fallback last.
// Agent: ONE progress reporter; POSTER until video `playing`; RETRIES server once before client fallback.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { startIosGifPlayback } from "@/components/drive/image/animated-gif-playback";
import {
  GifPosterLayout,
  GifPreviewProcessingReporter,
  type GifPreviewProcessingState,
  type GifPreviewProgressPhase,
} from "@/components/drive/image/gif-preview-progress";
import { GIF_SERVER_TRANSCODE_CLIENT_TIMEOUT_MS } from "@/components/drive/image/gif-preview-timing";
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
  ) => Promise<{ url: string; ready: boolean } | null>;
  /** Human: Lift transcode progress to the preview top bar (non-blocking). */
  onGifPreviewProcessingChange?: (state: GifPreviewProcessingState | null) => void;
  /** Human: Called once server MP4 playback succeeds so sidecar reuse is known in-session. */
  onServerPreviewCached?: (fileId: string) => void;
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

// Human: Never drop the top-bar percent when switching ticket → server → client phases.
// Agent: READS child reporter updates; WRITES floored progress to parent chrome.
function useMonotonicGifPreviewReporter(
  onGifPreviewProcessingChange?: (state: GifPreviewProcessingState | null) => void,
  resetKey?: string,
) {
  const floorRef = useRef(0);

  useEffect(() => {
    floorRef.current = 0;
  }, [resetKey]);

  return useCallback(
    (state: GifPreviewProcessingState | null) => {
      if (!onGifPreviewProcessingChange) return;
      if (!state) {
        onGifPreviewProcessingChange(null);
        return;
      }
      if (state.progress === null) {
        onGifPreviewProcessingChange(state);
        return;
      }
      const floored = Math.max(floorRef.current, state.progress);
      floorRef.current = floored;
      onGifPreviewProcessingChange({ ...state, progress: floored });
    },
    [onGifPreviewProcessingChange],
  );
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
  videoRef: RefObject<HTMLVideoElement | null>;
  onFailed?: () => void;
  onPlaying?: () => void;
};

// Human: Play ffmpeg-generated MP4 — poster stays until `playing` (not `canplay`) to avoid black flashes.
// Agent: SETS video src on mount; CALLS onPlaying when frames are actually rendering.
function ServerGifVideo({
  animationUrl,
  posterUrl,
  alt,
  fitStyle,
  className,
  videoRef,
  onFailed,
  onPlaying,
}: ServerGifVideoProps) {
  const onFailedRef = useRef(onFailed);
  const onPlayingRef = useRef(onPlaying);
  const mediaStyle = withAnimatedPreviewContainFit(fitStyle, 0, 0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    onFailedRef.current = onFailed;
    onPlayingRef.current = onPlaying;
  }, [onFailed, onPlaying]);

  useEffect(() => {
    setIsPlaying(false);
  }, [animationUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const markPlaying = () => {
      setIsPlaying(true);
      onPlayingRef.current?.();
    };

    // Human: iOS may block first autoplay — retry on canplay and when tab becomes visible again.
    // Agent: CALLS muted play(); ONLY markPlaying on `playing` so poster hides with real frames.
    const tryPlay = () => {
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      void video.play().catch(() => undefined);
    };

    tryPlay();
    video.addEventListener("canplay", tryPlay);
    video.addEventListener("playing", markPlaying);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && video.paused) {
        tryPlay();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      video.removeEventListener("canplay", tryPlay);
      video.removeEventListener("playing", markPlaying);
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
    };
  }, [animationUrl, videoRef]);

  if (!posterUrl) {
    return (
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={mediaStyle}
        className={cn(className, "block object-contain")}
        src={animationUrl}
        preload="auto"
        autoPlay
        muted
        loop
        playsInline
        {...({ "webkit-playsinline": "true" } as Record<string, string>)}
        disablePictureInPicture
        controls={false}
        onError={() => onFailedRef.current?.()}
      />
    );
  }

  return (
    <GifPosterLayout
      posterUrl={posterUrl}
      alt={alt}
      fitStyle={mediaStyle}
      className={className}
      showPoster={!isPlaying}
    >
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={{ objectFit: "contain" }}
        className={cn(
          "absolute inset-0 block size-full",
          isPlaying ? "opacity-100" : "opacity-0",
        )}
        src={animationUrl}
        preload="auto"
        autoPlay
        muted
        loop
        playsInline
        {...({ "webkit-playsinline": "true" } as Record<string, string>)}
        disablePictureInPicture
        controls={false}
        onError={() => onFailedRef.current?.()}
      />
    </GifPosterLayout>
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
  onGifPreviewProcessingChange,
  onServerPreviewCached,
}: AnimatedGifCanvasProps) {
  const posterUrl = usePosterObjectUrl(byteSource, url);
  const serverVideoRef = useRef<HTMLVideoElement>(null);
  const clientVideoRef = useRef<HTMLVideoElement>(null);
  const reportProgress = useMonotonicGifPreviewReporter(
    onGifPreviewProcessingChange,
    `${fileId ?? ""}:${url}:${enableServerAnimation}`,
  );

  const [animationUrl, setAnimationUrl] = useState<string | null>(null);
  const [serverPreviewReady, setServerPreviewReady] = useState(false);
  const [serverVideoFailed, setServerVideoFailed] = useState(false);
  const [serverRetryCount, setServerRetryCount] = useState(0);
  const [ticketFetchSettled, setTicketFetchSettled] = useState(!enableServerAnimation);
  const [serverPlaybackStarted, setServerPlaybackStarted] = useState(false);
  const [clientPlaybackStarted, setClientPlaybackStarted] = useState(false);
  const [useClientFallback, setUseClientFallback] = useState(false);

  const handleServerVideoFailed = useCallback(() => {
    if (serverRetryCount < 1) {
      setServerRetryCount((count) => count + 1);
      setAnimationUrl(null);
      setServerPlaybackStarted(false);
      setTicketFetchSettled(false);
      setServerVideoFailed(false);
      return;
    }
    setServerVideoFailed(true);
    setUseClientFallback(true);
  }, [serverRetryCount]);

  useEffect(() => {
    setServerVideoFailed(false);
    setUseClientFallback(false);
    setAnimationUrl(null);
    setServerPreviewReady(false);
    setServerPlaybackStarted(false);
    setClientPlaybackStarted(false);
    setServerRetryCount(0);
    setTicketFetchSettled(!enableServerAnimation);
    reportProgress(null);
  }, [enableServerAnimation, fileId, reportProgress, url]);

  useEffect(() => {
    if (
      !enableServerAnimation ||
      !fileId ||
      !resolveAnimationPreviewUrl ||
      serverVideoFailed ||
      useClientFallback
    ) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setTicketFetchSettled(false);

    void resolveAnimationPreviewUrl(fileId, controller.signal).then((resolved) => {
      if (cancelled || controller.signal.aborted) return;
      if (resolved) {
        setAnimationUrl(resolved.url);
        setServerPreviewReady(resolved.ready);
      } else {
        setUseClientFallback(true);
      }
      setTicketFetchSettled(true);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    enableServerAnimation,
    fileId,
    resolveAnimationPreviewUrl,
    serverRetryCount,
    serverVideoFailed,
    useClientFallback,
  ]);

  const waitingForServerTranscode =
    enableServerAnimation &&
    !useClientFallback &&
    Boolean(animationUrl) &&
    !serverPlaybackStarted;

  useEffect(() => {
    if (!waitingForServerTranscode || serverPreviewReady) return;

    const timeoutId = window.setTimeout(() => {
      handleServerVideoFailed();
    }, GIF_SERVER_TRANSCODE_CLIENT_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    animationUrl,
    handleServerVideoFailed,
    serverPreviewReady,
    waitingForServerTranscode,
  ]);

  let progressPhase: GifPreviewProgressPhase = "idle";
  if (enableServerAnimation && !serverPlaybackStarted && !clientPlaybackStarted) {
    if (!ticketFetchSettled) {
      progressPhase = "ticket";
    } else if (!useClientFallback && animationUrl) {
      progressPhase = "server";
    } else if (useClientFallback) {
      progressPhase = "client";
    }
  } else if (serverPlaybackStarted || clientPlaybackStarted) {
    progressPhase = "complete";
  }

  const activeVideoRef =
    !useClientFallback && animationUrl ? serverVideoRef : clientVideoRef;

  const progressReporter =
    progressPhase !== "idle" && progressPhase !== "complete" ? (
      <GifPreviewProcessingReporter
        phase={progressPhase}
        videoRef={activeVideoRef}
        serverPreviewReady={serverPreviewReady}
        onChange={reportProgress}
      />
    ) : null;

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

  if (animationUrl && !useClientFallback) {
    return (
      <>
        {progressReporter}
        <ServerGifVideo
          animationUrl={animationUrl}
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={className}
          videoRef={serverVideoRef}
          onFailed={handleServerVideoFailed}
          onPlaying={() => {
            setServerPlaybackStarted(true);
            setServerPreviewReady(true);
            if (fileId) onServerPreviewCached?.(fileId);
            reportProgress(null);
          }}
        />
      </>
    );
  }

  if (!useClientFallback && posterUrl && !animationUrl) {
    return (
      <>
        {progressReporter}
        <StaticGifPoster
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={className}
        />
      </>
    );
  }

  if (useClientFallback) {
    return (
      <>
        {progressReporter}
        <ClientGifPlayback
          byteSource={byteSource}
          fileId={fileId}
          url={url}
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={className}
          onNaturalSize={onNaturalSize}
          preferByteSource
          videoRef={clientVideoRef}
          onPlaybackStarted={() => {
            setClientPlaybackStarted(true);
            reportProgress(null);
          }}
        />
      </>
    );
  }

  return null;
}

type ClientGifPlaybackProps = {
  byteSource?: Blob | ArrayBuffer | null;
  fileId?: string;
  url: string;
  posterUrl?: string | null;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onNaturalSize?: (width: number, height: number) => void;
  preferByteSource?: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onPlaybackStarted?: () => void;
};

// Human: Client-side GIF decode when server MP4 is unavailable (share links, offline dev).
// Agent: CALLS startIosGifPlayback; KEEPS static poster visible until playback actually starts.
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
  videoRef,
  onPlaybackStarted,
}: ClientGifPlaybackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStyle = resolveAnimatedMediaStyle(fitStyle);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const onPlaybackStartedRef = useRef(onPlaybackStarted);

  useEffect(() => {
    onPlaybackStartedRef.current = onPlaybackStarted;
  }, [onPlaybackStarted]);

  const waitingForBytes =
    isAppleTouchDevice() && !byteSource && (preferByteSource || !isServerGifAnimationPreviewUrl(url));

  useEffect(() => {
    setPlaybackStarted(false);
  }, [byteSource, fileId, url, preferByteSource]);

  useEffect(() => {
    if (waitingForBytes) {
      return;
    }
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

        // Human: Canvas loops draw async — mark started on the next frame so poster stays until pixels land.
        // Agent: AVOIDS black flash when server fallback uses gifuct/ImageDecoder canvas path.
        if (!objectUrl) {
          requestAnimationFrame(() => {
            if (cancelled) return;
            setPlaybackStarted(true);
            onPlaybackStartedRef.current?.();
          });
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
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
  }, [byteSource, fileId, onNaturalSize, preferByteSource, url, videoRef, waitingForBytes]);

  const markVideoPlaying = useCallback(() => {
    setPlaybackStarted(true);
    onPlaybackStartedRef.current?.();
  }, []);

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

  const showPoster = Boolean(posterUrl) && !playbackStarted;

  if (posterUrl) {
    return (
      <GifPosterLayout
        posterUrl={posterUrl}
        alt={alt}
        fitStyle={mediaStyle}
        className={className}
        showPoster={showPoster}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={alt}
          style={{
            objectFit: "contain",
            opacity: playbackStarted && !videoUrl ? 1 : 0,
          }}
          className="absolute inset-0 block size-full"
        />
        <video
          ref={videoRef}
          role="img"
          aria-label={alt}
          style={{
            objectFit: "contain",
            display: videoUrl ? "block" : "none",
            opacity: playbackStarted ? 1 : 0,
          }}
          className="absolute inset-0 block size-full"
          src={videoUrl ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          {...({ "webkit-playsinline": "true" } as Record<string, string>)}
          disablePictureInPicture
          controls={false}
          onPlaying={markVideoPlaying}
        />
      </GifPosterLayout>
    );
  }

  return (
    <div className="relative" style={mediaStyle}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        style={{ objectFit: "contain" }}
        className={cn(className, "block size-full")}
      />
      <video
        ref={videoRef}
        role="img"
        aria-label={alt}
        style={{
          objectFit: "contain",
          display: videoUrl ? "block" : "none",
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
        onPlaying={markVideoPlaying}
      />
    </div>
  );
}
