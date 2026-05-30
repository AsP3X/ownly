// Human: Video timeline — Pencil Ownly Video Player seekbar (4px rail, hover dot, tooltip card).
// Agent: PROPS progress+duration+buffered; EMITS onSeek(seconds); READS pointer on 540px-max rail (1.5×).

import { useCallback, useRef, useState } from "react";
import type { BufferedSegment } from "@/components/drive/audio/audio-buffered";
import { formatVideoTime } from "@/components/drive/video/video-time";
import { cn } from "@/lib/utils";

type VideoSeekBarProps = {
  progress: number;
  duration: number;
  bufferedSegments?: BufferedSegment[];
  disabled?: boolean;
  onSeek: (timeSeconds: number) => void;
  className?: string;
};

export function VideoSeekBar({
  progress,
  duration,
  bufferedSegments = [],
  disabled = false,
  onSeek,
  className = "",
}: VideoSeekBarProps) {
  const trackRailRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const isHovering = hoverPercent !== null;

  const updateHoverFromClientX = useCallback((clientX: number) => {
    const rail = trackRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setHoverPercent(pct);
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      updateHoverFromClientX(event.clientX);
    },
    [updateHoverFromClientX],
  );

  const handlePointerLeave = useCallback(() => {
    setHoverPercent(null);
  }, []);

  const trackDuration = duration > 0 ? duration : 0;
  const max = trackDuration > 0 ? trackDuration : 1;
  const progressPercent =
    trackDuration > 0 ? Math.min(100, (progress / trackDuration) * 100) : 0;
  const seekValue = trackDuration > 0 ? Math.min(progress, trackDuration) : progress;
  const hoverSeconds =
    isHovering && trackDuration ? (trackDuration * (hoverPercent ?? 0)) / 100 : 0;
  const seekInputDisabled = disabled || trackDuration <= 0;

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
    <div className={cn("min-w-0 flex-1 max-w-[540px]", className)}>
      <div className="relative overflow-visible py-3">
        <div
          className={cn(
            "relative w-full overflow-visible",
            disabled ? "opacity-50" : "cursor-pointer",
          )}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div ref={trackRailRef} className="relative h-1.5 w-full">
            {/* Human: Pencil Timeline Bg — 6px rail (1.5×) at 20% white on the control bar. */}
            <div className="relative h-1.5 w-full rounded-sm bg-[#FFFFFF33]">
              {bufferedBars.map((bar) => (
                <div
                  key={bar.key}
                  className="absolute top-0 h-1.5 rounded-sm bg-[#FFFFFF66]"
                  style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                />
              ))}
              <div
                className="absolute top-0 left-0 z-[1] h-1.5 rounded-sm bg-[#2563EB] transition-[width] duration-150 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Human: Pencil Timeline Hover Dot — 15px disc (1.5×), black fill, white stroke. */}
            {isHovering ? (
              <div
                className="pointer-events-none absolute top-1/2 z-20 size-[15px] -translate-y-1/2 rounded-full border-2 border-white bg-[#1A1A1A]"
                style={{ left: `calc(${hoverPercent}% - 7.5px)` }}
              />
            ) : null}

            {/* Human: Pencil Timeline Tooltip Card — 165×48 dark pill (1.5×) above the hover dot. */}
            {isHovering ? (
              <div
                className="pointer-events-none absolute bottom-full z-50 mb-3 flex flex-col items-center"
                style={{
                  left: `${hoverPercent}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <div className="flex h-12 min-w-[165px] items-center justify-center rounded-md bg-[#000000E0] px-4 text-xs font-bold tabular-nums text-white shadow-lg">
                  {formatVideoTime(hoverSeconds)}
                </div>
                <div
                  className="h-2 w-4 rotate-45 bg-[#000000E0]"
                  aria-hidden
                />
              </div>
            ) : null}
          </div>

          <input
            type="range"
            min={0}
            max={max}
            step={0.05}
            value={seekValue}
            onChange={(event) => {
              if (seekInputDisabled) return;
              handleSeekInput(event);
            }}
            disabled={seekInputDisabled}
            aria-label="Seek video"
            aria-valuemin={0}
            aria-valuemax={trackDuration}
            aria-valuenow={seekValue}
            aria-valuetext={formatVideoTime(seekValue)}
            className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </div>
  );
}
