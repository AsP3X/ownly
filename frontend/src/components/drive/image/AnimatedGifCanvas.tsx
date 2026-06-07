// Human: iOS GIF preview — static poster first, server MP4 on active slide, client fallback last.
// Agent: READS byteSource poster; FETCHES preview-animation only when enableServerAnimation; PLAYS video.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { startIosGifPlayback } from "@/components/drive/image/animated-gif-playback";
import {
  GifPosterLayout,
  GifPreviewProcessingReporter,
  type GifPreviewProcessingState,
} from "@/components/drive/image/gif-preview-progress";
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

/** Human: Align with backend GIF_PREVIEW_TRANSCODE_TIMEOUT plus client buffer slack. */
const SERVER_GIF_TRANSCODE_CLIENT_TIMEOUT_MS = 10 * 60 * 1000 + 45_000;

type ServerGifVideoProps = {
  animationUrl: string;
  /** Human: MP4 sidecar already in object storage — skip ffmpeg progress UI. */
  serverPreviewReady: boolean;
  posterUrl: string | null;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  onFailed?: () => void;
  onGifPreviewProcessingChange?: (state: GifPreviewProcessingState | null) => void;
  onServerPreviewCached?: () => void;
};

// Human: Play ffmpeg-generated MP4 — static poster until playback starts; progress in top bar.
// Agent: SETS video src on mount (starts server transcode); HIDES poster when canplay/playing.
function ServerGifVideo({
  animationUrl,
  serverPreviewReady,
  posterUrl,
  alt,
  fitStyle,
  className,
  onFailed,
  onGifPreviewProcessingChange,
  onServerPreviewCached,
}: ServerGifVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onFailedRef = useRef(onFailed);
  const onCachedRef = useRef(onServerPreviewCached);
  const mediaStyle = withAnimatedPreviewContainFit(fitStyle, 0, 0);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const processingActive = !isVideoReady;
  const showTranscodeProgress = processingActive && !serverPreviewReady;

  useEffect(() => {
    onFailedRef.current = onFailed;
    onCachedRef.current = onServerPreviewCached;
  }, [onFailed, onServerPreviewCached]);

  useEffect(() => {
    setIsVideoReady(false);
  }, [animationUrl]);

  // Human: Abort client wait when server ffmpeg exceeds the backend transcode timeout window.
  // Agent: CALLS onFailed; FALLBACK to client decode path in AnimatedGifCanvas.
  useEffect(() => {
    if (!showTranscodeProgress) return;

    const timeoutId = window.setTimeout(() => {
      onFailedRef.current?.();
    }, SERVER_GIF_TRANSCODE_CLIENT_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [animationUrl, showTranscodeProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const markReady = () => {
      setIsVideoReady(true);
      onCachedRef.current?.();
    };

    // Human: iOS may block first autoplay — retry on canplay and when tab becomes visible again.
    // Agent: CALLS muted play(); IGNORES early reject while MP4 transcode/buffer is in flight.
    const tryPlay = () => {
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      void video.play().catch(() => undefined);
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
      // Human: Pause when the slide unmounts; keep src until DOM removal so ffmpeg stream is not aborted mid-flight.
      // Agent: CALLS pause(); AVOIDS removeAttribute('src') which cancels preview-animation GET on parent re-renders.
      video.pause();
    };
  }, [animationUrl]);

  if (!posterUrl) {
    return (
      <>
        <GifPreviewProcessingReporter
          active={showTranscodeProgress}
          complete={isVideoReady}
          videoRef={videoRef}
          transcodePending={!serverPreviewReady}
          onChange={onGifPreviewProcessingChange}
        />
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
      </>
    );
  }

  return (
    <>
      <GifPreviewProcessingReporter
        active={showTranscodeProgress}
        complete={isVideoReady}
        videoRef={videoRef}
        transcodePending={!serverPreviewReady}
        onChange={onGifPreviewProcessingChange}
      />
      <GifPosterLayout
        posterUrl={posterUrl}
        alt={alt}
        fitStyle={mediaStyle}
        className={className}
        showPoster={!isVideoReady}
      >
        <video
          ref={videoRef}
          role="img"
          aria-label={alt}
          style={{ objectFit: "contain" }}
          className={cn(
            "absolute inset-0 block size-full",
            isVideoReady ? "opacity-100" : "opacity-0",
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
    </>
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
  const [animationUrl, setAnimationUrl] = useState<string | null>(null);
  const [serverPreviewReady, setServerPreviewReady] = useState(false);
  const [serverVideoFailed, setServerVideoFailed] = useState(false);
  const [ticketFetchSettled, setTicketFetchSettled] = useState(!enableServerAnimation);

  const handleServerVideoFailed = useCallback(() => {
    setServerVideoFailed(true);
  }, []);

  useEffect(() => {
    setServerVideoFailed(false);
    setAnimationUrl(null);
    setServerPreviewReady(false);
    setTicketFetchSettled(!enableServerAnimation);
    onGifPreviewProcessingChange?.(null);
  }, [enableServerAnimation, fileId, onGifPreviewProcessingChange, url]);

  useEffect(() => {
    if (
      !enableServerAnimation ||
      !fileId ||
      !resolveAnimationPreviewUrl ||
      serverVideoFailed
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
        setServerVideoFailed(true);
      }
      setTicketFetchSettled(true);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enableServerAnimation, fileId, resolveAnimationPreviewUrl, serverVideoFailed]);

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
        serverPreviewReady={serverPreviewReady}
        posterUrl={posterUrl}
        alt={alt}
        fitStyle={fitStyle}
        className={className}
        onFailed={handleServerVideoFailed}
        onGifPreviewProcessingChange={onGifPreviewProcessingChange}
        onServerPreviewCached={() => {
          setServerPreviewReady(true);
          if (fileId) onServerPreviewCached?.(fileId);
        }}
      />
    );
  }

  if (!serverVideoFailed && posterUrl && !animationUrl) {
    return (
      <>
        <GifPreviewProcessingReporter
          active={!ticketFetchSettled}
          complete={false}
          onChange={onGifPreviewProcessingChange}
        />
        <StaticGifPoster
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={fitStyle}
          className={className}
        />
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
      onGifPreviewProcessingChange={onGifPreviewProcessingChange}
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
  onGifPreviewProcessingChange,
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

  const showProcessing =
    waitingForBytes || isPreparing || (Boolean(videoUrl) && !clientVideoReady);

  if (posterUrl && showProcessing) {
    return (
      <>
        <GifPreviewProcessingReporter
          active={showProcessing}
          complete={clientVideoReady}
          videoRef={videoRef}
          onChange={onGifPreviewProcessingChange}
        />
        <GifPosterLayout
          posterUrl={posterUrl}
          alt={alt}
          fitStyle={mediaStyle}
          className={className}
          showPoster={showPoster && !clientVideoReady}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={alt}
            style={{
              objectFit: "contain",
              display: videoUrl ? "none" : undefined,
            }}
            className="absolute inset-0 block size-full"
          />
          <video
            ref={videoRef}
            role="img"
            aria-label={alt}
            style={{
              objectFit: "contain",
              display: videoUrl ? undefined : "none",
              opacity: clientVideoReady ? 1 : 0,
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
            onPlaying={() => setClientVideoReady(true)}
          />
        </GifPosterLayout>
      </>
    );
  }

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
