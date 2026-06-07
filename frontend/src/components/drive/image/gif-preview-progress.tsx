// Human: Progress UI while iOS GIF preview waits on server ffmpeg or client decode.
// Agent: RENDERS native progress element; HOOK merges buffer bytes with paced transcode estimate.

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";

const TRANSCODE_PROGRESS_CAP = 88;
const TRANSCODE_PROGRESS_START = 6;

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
      const next =
        TRANSCODE_PROGRESS_START +
        (TRANSCODE_PROGRESS_CAP - TRANSCODE_PROGRESS_START) * (1 - Math.exp(-elapsed / 9000));
      setEstimate(Math.min(TRANSCODE_PROGRESS_CAP, next));
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
};

// Human: Combined progress for poster overlay — estimate until bytes arrive, then buffer percent.
// Agent: READS useTranscodeEstimateProgress + optional video buffer; RETURNS null when inactive.
export function useGifPreviewProcessingProgress({
  active,
  complete,
  videoRef,
}: GifPreviewProcessingProgressOptions): number | null {
  const estimate = useTranscodeEstimateProgress(active, complete);
  const bufferPercent = useVideoBufferProgress(
    videoRef,
    Boolean(active && videoRef && !complete),
  );

  if (!active) return null;
  if (complete) return 100;

  if (bufferPercent !== null) {
    return Math.max(estimate ?? TRANSCODE_PROGRESS_START, bufferPercent);
  }

  return estimate;
}

type GifPreviewProcessingOverlayProps = {
  progress: number | null;
  label?: string;
  className?: string;
};

// Human: Centered progress card over the static GIF poster during MP4 preparation.
// Agent: RENDERS native progress; INDETERMINATE when progress is null; DETERMINATE at 0–100 otherwise.
export function GifPreviewProcessingOverlay({
  progress,
  label = "Preparing animation…",
  className,
}: GifPreviewProcessingOverlayProps) {
  const indeterminate = progress === null;
  const clamped =
    progress === null ? undefined : Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center bg-black/30 pointer-events-none",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex min-w-[220px] max-w-[min(84%,300px)] flex-col items-stretch gap-2 rounded-xl border border-white/15 bg-black/75 px-4 py-3 shadow-lg backdrop-blur-sm">
        <p className="text-center text-xs font-medium text-white/90">{label}</p>
        <progress
          className="h-2 w-full overflow-hidden rounded-full bg-white/20 accent-white [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-white [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-white/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-white [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-200"
          max={100}
          value={indeterminate ? undefined : clamped}
          aria-label={label}
        />
        {!indeterminate && clamped !== undefined ? (
          <span className="text-center text-[11px] tabular-nums text-white/70">{clamped}%</span>
        ) : (
          <span className="text-center text-[11px] text-white/60">Working…</span>
        )}
      </div>
    </div>
  );
}

type PosterWithProcessingOverlayProps = {
  posterUrl: string;
  alt: string;
  fitStyle: CSSProperties;
  className?: string;
  posterClassName?: string;
  processingActive: boolean;
  processingComplete: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  children?: React.ReactNode;
};

// Human: Static poster with optional centered progress while animation MP4 is prepared.
// Agent: WRAPS img + overlay + optional video/canvas siblings in one layout box.
export function PosterWithProcessingOverlay({
  posterUrl,
  alt,
  fitStyle,
  className,
  posterClassName,
  processingActive,
  processingComplete,
  videoRef,
  children,
}: PosterWithProcessingOverlayProps) {
  const progress = useGifPreviewProcessingProgress({
    active: processingActive && !processingComplete,
    complete: processingComplete,
    videoRef,
  });

  const showPosterImage = !processingComplete;

  return (
    <div className={cn("relative", className)} style={fitStyle}>
      {showPosterImage ? (
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
      {processingActive && !processingComplete ? (
        <GifPreviewProcessingOverlay progress={progress} />
      ) : null}
      {children}
    </div>
  );
}
