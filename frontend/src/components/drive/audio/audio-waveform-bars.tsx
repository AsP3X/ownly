// Human: Decorative or analyzed waveform bars for mobile sheet and desktop audio preview dialog.
// Agent: READS optional bars from API sidecar; FALLS BACK to Pencil static heights when absent.

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

// Human: Static bar heights from Pencil Ownly Explorer Audio Player — Mobile Portrait (32 bars).
// Agent: CONST fallback when waveform sidecar is unavailable (legacy uploads or analysis pending).
const FALLBACK_WAVEFORM_BAR_HEIGHTS = [
  20, 28, 44, 32, 24, 48, 56, 38, 22, 16, 32, 42, 58, 64, 48, 36, 28, 40, 52, 44, 30, 18, 26,
  34, 46, 50, 38, 24, 18, 28, 36, 20,
] as const;

type AudioWaveformBarsProps = {
  /** Human: 0–100 playback position — bars at or before this index use accent fill. */
  progressPercent: number;
  /** Human: Peak heights from Nebular waveform.json; omit to use decorative fallback. */
  bars?: number[] | null;
  /** Human: Track duration in seconds — required for click/drag seek. */
  duration?: number;
  disabled?: boolean;
  /** Human: Seek to an absolute time when the user clicks or drags the waveform. */
  onSeek?: (timeSeconds: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  className?: string;
};

export function AudioWaveformBars({
  progressPercent,
  bars,
  duration = 0,
  disabled = false,
  onSeek,
  onSeekStart,
  onSeekEnd,
  className,
}: AudioWaveformBarsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heights = bars?.length ? bars : FALLBACK_WAVEFORM_BAR_HEIGHTS;
  const playedBarCount = Math.round((progressPercent / 100) * heights.length);
  const canSeek = Boolean(onSeek) && duration > 0 && !disabled;

  // Human: Map pointer X across the waveform strip to a track time and emit onSeek.
  // Agent: READS container rect; CLAMPS percent; CALLS onSeek(duration * pct).
  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!canSeek || !onSeek) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(duration * pct);
    },
    [canSeek, duration, onSeek],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canSeek) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      onSeekStart?.();
      seekFromClientX(event.clientX);
    },
    [canSeek, onSeekStart, seekFromClientX],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canSeek) return;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      seekFromClientX(event.clientX);
    },
    [canSeek, seekFromClientX],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canSeek) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onSeekEnd?.();
    },
    [canSeek, onSeekEnd],
  );

  return (
    <div
      ref={containerRef}
      role={canSeek ? "slider" : undefined}
      aria-label={canSeek ? "Seek by waveform" : undefined}
      aria-valuemin={canSeek ? 0 : undefined}
      aria-valuemax={canSeek ? Math.floor(duration) : undefined}
      aria-valuenow={canSeek ? Math.floor((progressPercent / 100) * duration) : undefined}
      aria-disabled={canSeek ? disabled : undefined}
      tabIndex={canSeek ? 0 : undefined}
      className={cn(
        "flex h-16 items-center justify-center gap-[3px] px-0 py-2.5",
        canSeek && "cursor-pointer touch-none select-none",
        disabled && "opacity-50",
        className,
      )}
      onPointerDown={canSeek ? handlePointerDown : undefined}
      onPointerMove={canSeek ? handlePointerMove : undefined}
      onPointerUp={canSeek ? handlePointerUp : undefined}
      onPointerCancel={canSeek ? handlePointerUp : undefined}
    >
      {heights.map((height, index) => (
        <div
          key={index}
          className={cn(
            "w-1 shrink-0 rounded-sm transition-colors duration-150",
            index < playedBarCount ? "bg-blue-600" : "bg-[#E5E7EB]",
          )}
          style={{ height: `${height}px` }}
          aria-hidden
        />
      ))}
    </div>
  );
}

export type AudioWaveformArtifact = {
  version: number;
  bar_count: number;
  max_height: number;
  bars: number[];
};
