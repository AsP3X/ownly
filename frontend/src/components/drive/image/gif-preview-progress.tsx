// Human: Progress UI while iOS GIF preview waits on server ffmpeg or client decode.
// Agent: RENDERS native progress in top chrome; HOOK merges buffer bytes with paced transcode estimate.

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";

const TRANSCODE_PROGRESS_CAP = 88;
const TRANSCODE_PROGRESS_START = 6;
/** Human: After the estimate plateaus, creep slowly toward completion so the bar does not look frozen. */
const TRANSCODE_PLATEAU_ESCAPE_MS = 45_000;
const TRANSCODE_PLATEAU_MAX = 97;

export type GifPreviewProcessingState = {
  active: boolean;
  progress: number | null;
  label?: string;
};

// Human: Pace progress while ffmpeg runs server-side (no byte events until the MP4 stream starts).
// Agent: EXPONENTIAL ease toward TRANSCODE_PROGRESS_CAP; STOPS when complete is true.
function useTranscodeEstimateProgress(active: boolean, complete: boolean): number | null {
  const [estimate, setEstimate] = useState<number | null>(active ? TRANSCODE_PROGRESS_START : null);

  useEffect(() => {
    if (!active) {
      setEstimate(null);
      return;
    }
    if (complete) {
      setEstimate(100);
      return;
    }

    setEstimate(TRANSCODE_PROGRESS_START);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const eased =
        TRANSCODE_PROGRESS_START +
        (TRANSCODE_PROGRESS_CAP - TRANSCODE_PROGRESS_START) * (1 - Math.exp(-elapsed / 9000));
      let next = Math.min(TRANSCODE_PROGRESS_CAP, eased);
      if (elapsed > TRANSCODE_PLATEAU_ESCAPE_MS) {
        const plateauElapsed = elapsed - TRANSCODE_PLATEAU_ESCAPE_MS;
        const creep =
          (TRANSCODE_PLATEAU_MAX - TRANSCODE_PROGRESS_CAP) *
          (1 - Math.exp(-plateauElapsed / 120_000));
        next = Math.min(TRANSCODE_PLATEAU_MAX, TRANSCODE_PROGRESS_CAP + creep);
      }
      setEstimate(next);
    }, 160);

    return () => window.clearInterval(timer);
  }, [active, complete]);

  return complete ? 100 : estimate;
}

// Human: Read HTMLMediaElement.buffered ranges once the preview-animation response begins streaming.
// Agent: LISTENS progress/loadedmetadata; RETURNS 0–99 percent downloaded.
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
    update();

    return () => {
      video.removeEventListener("progress", update);
      video.removeEventListener("loadedmetadata", update);
    };
  }, [active, videoRef]);

  return bufferPercent;
}

type GifPreviewProcessingProgressOptions = {
  active: boolean;
  complete: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Human: False when MP4 sidecar is already in object storage (stream only, no ffmpeg). */
  transcodePending?: boolean;
};

// Human: Combined progress — estimate until bytes arrive, then buffer percent.
// Agent: READS useTranscodeEstimateProgress + optional video buffer; RETURNS null when inactive.
export function useGifPreviewProcessingProgress({
  active,
  complete,
  videoRef,
  transcodePending = true,
}: GifPreviewProcessingProgressOptions): number | null {
  const estimate = useTranscodeEstimateProgress(
    active && transcodePending,
    complete,
  );
  const bufferPercent = useVideoBufferProgress(
    videoRef,
    Boolean(active && videoRef && !complete),
  );

  if (!active) return null;
  if (complete) return 100;

  if (bufferPercent !== null) {
    if (!transcodePending) return bufferPercent;
    return Math.max(estimate ?? TRANSCODE_PROGRESS_START, bufferPercent);
  }

  return transcodePending ? estimate : null;
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
  active: boolean;
  complete: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Human: False when cached MP4 sidecar streams without server ffmpeg. */
  transcodePending?: boolean;
  label?: string;
  onChange?: (state: GifPreviewProcessingState | null) => void;
};

// Human: Lift GIF transcode progress to the preview top bar without overlaying the image.
// Agent: CALLS useGifPreviewProcessingProgress; WRITES onChange when active/complete/progress shifts.
export function GifPreviewProcessingReporter({
  active,
  complete,
  videoRef,
  transcodePending = true,
  label = "Preparing animation…",
  onChange,
}: GifPreviewProcessingReporterProps) {
  const progress = useGifPreviewProcessingProgress({
    active: active && !complete,
    complete,
    videoRef,
    transcodePending,
  });

  useEffect(() => {
    if (!onChange) return;

    if (!active || complete) {
      onChange(null);
      return;
    }

    onChange({ active: true, progress, label });
  }, [active, complete, label, onChange, progress]);

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
