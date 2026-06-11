// Human: Video timeline — desktop rail, mobile portrait compact slider, mobile landscape wide track.
// Agent: PROPS variant + progress/duration; EMITS onSeek(seconds); READS pointer for hover tooltip (desktop).

import { useCallback, useRef, useState } from "react";
import type { BufferedSegment } from "@/components/drive/audio/audio-buffered";
import { formatVideoTime } from "@/components/drive/video/video-time";
import { cn } from "@/lib/utils";

export type VideoSeekBarVariant =
  | "desktop"
  | "mobile-portrait"
  | "mobile-landscape"
  | "mobile-edge";

type VideoSeekBarProps = {
  progress: number;
  duration: number;
  bufferedSegments?: BufferedSegment[];
  disabled?: boolean;
  onSeek: (timeSeconds: number) => void;
  variant?: VideoSeekBarVariant;
  className?: string;
};

export function VideoSeekBar({
  progress,
  duration,
  bufferedSegments = [],
  disabled = false,
  onSeek,
  variant = "desktop",
  className = "",
}: VideoSeekBarProps) {
  const trackRailRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const isHovering = hoverPercent !== null && variant === "desktop";

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
      if (variant !== "desktop") return;
      updateHoverFromClientX(event.clientX);
    },
    [updateHoverFromClientX, variant],
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

  const isPortrait = variant === "mobile-portrait";
  const isLandscape = variant === "mobile-landscape";
  const isEdge = variant === "mobile-edge";

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

  const railHeight = isEdge ? "h-[3px]" : isPortrait || isLandscape ? "h-1" : "h-1.5";
  const showThumb = isPortrait || isLandscape || isEdge;

  return (
    <div
      className={cn(
        "min-w-0",
        isPortrait && "w-[110px] shrink-0",
        isLandscape && "min-w-0 flex-1",
        isEdge && "w-full",
        variant === "desktop" && "flex-1 max-w-[540px]",
        className,
      )}
    >
      <div className={cn("relative overflow-visible", variant === "desktop" ? "py-3" : "py-0")}>
        <div
          className={cn(
            "relative w-full overflow-visible",
            disabled ? "opacity-50" : "cursor-pointer",
            (isPortrait || isEdge) && "flex h-5 items-center",
          )}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div ref={trackRailRef} className={cn("relative w-full", railHeight)}>
            <div
              className={cn(
                "relative w-full rounded-sm",
                isLandscape ? "bg-[#FFFFFF40]" : "bg-white/20",
                railHeight,
              )}
            >
              {variant === "desktop" &&
                bufferedBars.map((bar) => (
                  <div
                    key={bar.key}
                    className="absolute top-0 h-1.5 rounded-sm bg-[#FFFFFF66]"
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                  />
                ))}
              <div
                className={cn(
                  "absolute top-0 left-0 z-[1] rounded-sm transition-[width] duration-150 ease-linear",
                  isEdge ? "h-[3px] bg-white" : "bg-[#2563EB]",
                  !isEdge && railHeight,
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {isHovering ? (
              <div
                className="pointer-events-none absolute top-1/2 z-20 size-[15px] -translate-y-1/2 rounded-full border-2 border-white bg-[#1A1A1A]"
                style={{ left: `calc(${hoverPercent}% - 7.5px)` }}
              />
            ) : null}

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
                <div className="h-2 w-4 rotate-45 bg-[#000000E0]" aria-hidden />
              </div>
            ) : null}

            {showThumb ? (
              <div
                className={cn(
                  "pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white shadow-sm",
                  isEdge ? "size-[9px]" : "size-3",
                )}
                style={{ left: `calc(${progressPercent}% - ${isEdge ? 4.5 : 6}px)` }}
              />
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
