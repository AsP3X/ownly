// Human: Seek bar with Aurora-style hover time preview — adapted for Ownly's light UI palette.
// Agent: PROPS progress+duration+onSeek; INTERNAL hoverPercent; EMITS onSeek(seconds) from hidden range input.

import { useCallback, useState } from "react";
import type { BufferedSegment } from "@/components/drive/audio/audio-buffered";
import { formatAudioDelta, formatAudioTime } from "@/components/drive/audio/audio-time";

type AudioSeekBarProps = {
  progress: number;
  duration: number;
  bufferedSegments?: BufferedSegment[];
  disabled?: boolean;
  showTimeLabels?: boolean;
  onSeek: (timeSeconds: number) => void;
  className?: string;
};

export function AudioSeekBar({
  progress,
  duration,
  bufferedSegments = [],
  disabled = false,
  showTimeLabels = true,
  onSeek,
  className = "",
}: AudioSeekBarProps) {
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);

  // Human: Map pointer X on the track to 0–100% for the hover tooltip position and preview time.
  // Agent: onMouseMove; SETS hoverPercent from clientX/rect.width.
  const handleProgressMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setHoverPercent(pct);
  }, []);

  // Human: Hide the hover preview when the pointer leaves the seek track.
  // Agent: SETS hoverPercent null.
  const handleProgressMouseLeave = useCallback(() => {
    setHoverPercent(null);
  }, []);

  const trackDuration = duration > 0 ? duration : 0;
  const max = trackDuration > 0 ? trackDuration : 1;
  const progressPercent =
    trackDuration > 0 ? Math.min(100, (progress / trackDuration) * 100) : 0;
  const seekValue = trackDuration > 0 ? Math.min(progress, trackDuration) : progress;
  const previewPercent = hoverPercent ?? progressPercent;
  const previewSeconds = trackDuration ? (trackDuration * previewPercent) / 100 : 0;

  // Human: Convert each TimeRanges entry into left/width percentages on the seek rail.
  // Agent: MAPS bufferedSegments against trackDuration; CLAMPS segment bounds to track length.
  const bufferedBars = bufferedSegments
    .map((segment, index) => {
      if (trackDuration <= 0) return null;
      const start = Math.max(0, Math.min(segment.start, trackDuration));
      const end = Math.max(start, Math.min(segment.end, trackDuration));
      if (end <= start) return null;
      return {
        key: `${segment.start}-${segment.end}-${index}`,
        leftPct: (start / trackDuration) * 100,
        widthPct: ((end - start) / trackDuration) * 100,
      };
    })
    .filter((bar): bar is NonNullable<typeof bar> => bar !== null);

  function handleSeekInput(event: React.ChangeEvent<HTMLInputElement>) {
    onSeek(Number(event.target.value));
  }

  return (
    <div className={className}>
      <div className="relative pt-3">
        <div
          className={`relative w-full h-2.5 group ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          onMouseMove={disabled ? undefined : handleProgressMouseMove}
          onMouseLeave={disabled ? undefined : handleProgressMouseLeave}
        >
          {/* Human: Muted rail with thin buffered segment pills — Aurora proportions, light palette. */}
          <div className="relative w-full h-full rounded-full bg-muted">
            {bufferedBars.map((bar) => (
              <div
                key={bar.key}
                className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-muted-foreground/30"
                style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
              />
            ))}
            <div
              className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-foreground/85 transition-[width] duration-300 ease-linear z-[1]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Human: Resting playhead dot — always visible at current progress. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground shadow-sm pointer-events-none z-10 transition-[left] duration-300 ease-linear"
            style={{ left: `calc(${progressPercent}% - 5px)` }}
          />

          {/* Human: Enlarged playhead on hover — Aurora pattern with light ring. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background border border-border shadow-md opacity-0 group-hover:opacity-100 transition-[left,opacity] duration-300 ease-linear pointer-events-none flex items-center justify-center z-10"
            style={{ left: `calc(${progressPercent}% - 8px)` }}
          >
            <div className="w-2 h-2 rounded-full bg-foreground" />
          </div>

          <input
            type="range"
            min={0}
            max={max}
            step={0.05}
            value={seekValue}
            onChange={handleSeekInput}
            disabled={disabled || trackDuration <= 0}
            aria-label="Seek"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-30"
          />

          {/* Human: Aurora-style hover tooltip — absolute time plus delta from current position. */}
          <div
            className="absolute bottom-full mb-2 pointer-events-none z-50 flex flex-col items-center"
            style={{ left: `${previewPercent}%`, transform: "translateX(-50%)" }}
          >
            <div className="flex flex-col items-center drop-shadow-md origin-bottom transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] opacity-0 scale-75 translate-y-2 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0">
              <div className="rounded-xl px-3.5 py-2.5 flex flex-col items-center gap-0.5 relative z-10 bg-background shadow-lg ring-1 ring-border/80">
                <span className="text-sm font-semibold text-foreground leading-none tracking-tight tabular-nums">
                  {formatAudioTime(previewSeconds)}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground leading-none tabular-nums">
                  {formatAudioDelta(previewSeconds - progress)}
                </span>
              </div>
              <div className="w-2.5 h-2.5 bg-background rotate-45 -mt-1.5 relative z-0 shadow ring-1 ring-border/80" />
            </div>
          </div>
        </div>
      </div>

      {showTimeLabels && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono tabular-nums mt-1.5">
          <span>{formatAudioTime(progress)}</span>
          <span>{formatAudioTime(trackDuration)}</span>
        </div>
      )}
    </div>
  );
}
