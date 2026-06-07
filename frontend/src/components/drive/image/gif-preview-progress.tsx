// Human: Progress UI while iOS GIF preview waits on server ffmpeg or client decode.
// Agent: RENDERS native progress in top chrome; MONOTONIC percent; ALIGNED to 60s server timeout.

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";
import {
  estimateServerTranscodeProgress,
  estimateTicketResolveProgress,
  TRANSCODE_PROGRESS_START,
} from "@/components/drive/image/gif-preview-timing";

export type GifPreviewProcessingState = {
  active: boolean;
  progress: number | null;
  label?: string;
};

export type GifPreviewProgressPhase =
  | "idle"
  | "ticket"
  | "server"
  | "client"
  | "complete";

// Human: Pace progress while ffmpeg runs server-side (no byte events until the MP4 stream starts).
// Agent: LINEAR over GIF_SERVER_TRANSCODE_TIMEOUT_MS.
function useServerTranscodeEstimate(active: boolean, complete: boolean): number | null {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active || complete) {
      setElapsedMs(0);
      return;
    }

    const started = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 200);

    return () => window.clearInterval(timer);
  }, [active, complete]);

  return estimateServerTranscodeProgress(active && !complete, elapsedMs);
}

// Human: Short ramp while fetching preview-animation ticket (no ffmpeg yet).
// Agent: CAPS at TICKET_RESOLVE_PROGRESS_CAP.
function useTicketResolveEstimate(active: boolean): number | null {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }

    const started = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 120);

    return () => window.clearInterval(timer);
  }, [active]);

  return estimateTicketResolveProgress(active, elapsedMs);
}

// Human: Read HTMLMediaElement.buffered ranges once the preview-animation response streams.
// Agent: LISTENS progress/loadedmetadata/playing; RETURNS 0–99 percent downloaded.
function useVideoBufferProgress(
  videoRef: RefObject<HTMLVideoElement | null> | undefined,
  active: boolean,
): number | null {
  const [bufferPercent, setBufferPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !videoRef) {
      setBufferPercent(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const update = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (video.buffered.length === 0) return;
      const end = video.buffered.end(video.buffered.length - 1);
      setBufferPercent(Math.min(99, (end / duration) * 100));
    };

    video.addEventListener("progress", update);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("playing", update);
    update();

    return () => {
      video.removeEventListener("progress", update);
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("playing", update);
    };
  }, [active, videoRef]);

  return bufferPercent;
}

type GifPreviewProcessingProgressOptions = {
  phase: GifPreviewProgressPhase;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Human: False when MP4 sidecar is already in object storage (stream only, no ffmpeg). */
  serverPreviewReady?: boolean;
};

// Human: Combined progress for ticket resolve, server transcode, and client decode phases.
// Agent: PICKS phase hook + optional buffer; NEVER decreases within a session.
export function useGifPreviewProcessingProgress({
  phase,
  videoRef,
  serverPreviewReady = false,
}: GifPreviewProcessingProgressOptions): number | null {
  const ticketEstimate = useTicketResolveEstimate(phase === "ticket");
  const serverEstimate = useServerTranscodeEstimate(
    phase === "server" && !serverPreviewReady,
    phase === "complete",
  );
  const clientEstimate = useServerTranscodeEstimate(phase === "client", phase === "complete");
  const bufferPercent = useVideoBufferProgress(
    videoRef,
    phase === "server" || phase === "client",
  );

  if (phase === "idle" || phase === "complete") return phase === "complete" ? 100 : null;

  let raw: number | null = null;
  if (phase === "ticket") {
    raw = ticketEstimate;
  } else if (phase === "server") {
    if (serverPreviewReady) {
      raw = bufferPercent ?? ticketEstimate ?? TRANSCODE_PROGRESS_START;
    } else {
      raw = bufferPercent !== null
        ? Math.max(serverEstimate ?? TRANSCODE_PROGRESS_START, bufferPercent)
        : serverEstimate;
    }
  } else if (phase === "client") {
    raw = bufferPercent !== null
      ? Math.max(clientEstimate ?? TRANSCODE_PROGRESS_START, bufferPercent)
      : clientEstimate;
  }

  return raw;
}

type GifPreviewBottomBarProgressProps = {
  progress: number | null;
  label?: string;
  className?: string;
};

// Human: Compact progress strip for the preview top chrome (non-blocking).
// Agent: RENDERS native progress centered between page indicator and close; pointer-events-none.
export function GifPreviewBottomBarProgress({
  progress,
  label = "Preparing animation…",
  className,
}: GifPreviewBottomBarProgressProps) {
  const indeterminate = progress === null;
  const clamped =
    progress === null ? undefined : Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div
      className={cn("flex w-full flex-col items-stretch gap-1", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <progress
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/20 accent-white [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-white [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-white/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-white [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-200"
        max={100}
        value={indeterminate ? undefined : clamped}
      />
      <span className="text-center text-[10px] tabular-nums text-white/70">
        {!indeterminate && clamped !== undefined ? `${clamped}%` : "Working…"}
      </span>
    </div>
  );
}

type GifPreviewProcessingReporterProps = {
  phase: GifPreviewProgressPhase;
  videoRef?: RefObject<HTMLVideoElement | null>;
  serverPreviewReady?: boolean;
  label?: string;
  onChange?: (state: GifPreviewProcessingState | null) => void;
};

// Human: Lift GIF transcode progress to the preview top bar without overlaying the image.
// Agent: CALLS useGifPreviewProcessingProgress; WRITES onChange when phase/progress shifts.
export function GifPreviewProcessingReporter({
  phase,
  videoRef,
  serverPreviewReady = false,
  label = "Preparing animation…",
  onChange,
}: GifPreviewProcessingReporterProps) {
  const progress = useGifPreviewProcessingProgress({
    phase,
    videoRef,
    serverPreviewReady,
  });

  useEffect(() => {
    if (!onChange) return;

    if (phase === "idle" || phase === "complete") {
      onChange(null);
      return;
    }

    onChange({ active: true, progress, label });
  }, [phase, label, onChange, progress]);

  return null;
}

type GifPosterLayoutProps = {
  posterUrl: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  posterClassName?: string;
  showPoster: boolean;
  children?: React.ReactNode;
};

// Human: Static poster with optional video/canvas siblings — no blocking overlay.
// Agent: WRAPS img + media children in one layout box for iOS GIF preview surfaces.
export function GifPosterLayout({
  posterUrl,
  alt,
  fitStyle,
  className,
  posterClassName,
  showPoster,
  children,
}: GifPosterLayoutProps) {
  return (
    <div className={cn("relative", className)} style={fitStyle}>
      {showPoster ? (
        <img
          src={posterUrl}
          alt={alt}
          style={{ objectFit: "contain" }}
          className={cn("block size-full object-contain", posterClassName)}
          draggable={false}
          loading="eager"
          decoding="sync"
        />
      ) : null}
      {children}
    </div>
  );
}

export { GIF_SERVER_TRANSCODE_CLIENT_TIMEOUT_MS } from "@/components/drive/image/gif-preview-timing";
