// Human: Seek bar with Pencil teardrop hover preview — pointer-driven on both default and embedded variants.
// Agent: PROPS progress+duration+onSeek+variant; REF track rail; EMITS onSeek(seconds) from range input.

import { useCallback, useRef, useState } from "react";
import type { BufferedSegment } from "@/components/drive/audio/audio-buffered";
import { formatAudioTime } from "@/components/drive/audio/audio-time";
import { AudioSeekTeardropTooltip } from "@/components/drive/audio/audio-seek-teardrop";
import { cn } from "@/lib/utils";

type AudioSeekBarVariant = "default" | "minimal" | "mobile-sheet" | "mobile-card";

type AudioSeekBarProps = {
  progress: number;
  duration: number;
  bufferedSegments?: BufferedSegment[];
  disabled?: boolean;
  showTimeLabels?: boolean;
  variant?: AudioSeekBarVariant;
  onSeek: (timeSeconds: number) => void;
  className?: string;
};

export function AudioSeekBar({
  progress,
  duration,
  bufferedSegments = [],
  disabled = false,
  showTimeLabels = true,
  variant = "default",
  onSeek,
  className = "",
}: AudioSeekBarProps) {
  const trackRailRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const isMinimal = variant === "minimal";
  const isMobileSheet = variant === "mobile-sheet";
  const isMobileCard = variant === "mobile-card";
  const isMobile = isMobileSheet || isMobileCard;
  const showTeardropHover = !isMobile;
  const isHovering = showTeardropHover && hoverPercent !== null;

  // Human: Map clientX to 0–100% on the visible rail — used by pointer move on input + wrapper.
  // Agent: READS trackRailRef rect; SETS hoverPercent; IGNORES when pointer leaves rail width.
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

  // Human: Clear teardrop and hover dot when the pointer leaves the seek hit area.
  // Agent: SETS hoverPercent null on pointer leave.
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
    <div className={cn("overflow-visible", className)}>
      {/* Human: Top padding reserves space for the 52px teardrop so it is not clipped by dialog edges. */}
      <div className={cn("relative overflow-visible", showTeardropHover && "pt-[52px]")}>
        {/* Human: Tall hit target (py-3) so hover works reliably; visual rail stays thin inside. */}
        <div
          className={cn(
            "relative w-full overflow-visible",
            isMobile ? "py-0" : "py-3",
            disabled ? "opacity-50" : "cursor-pointer",
          )}
          onPointerMove={showTeardropHover ? handlePointerMove : undefined}
          onPointerLeave={showTeardropHover ? handlePointerLeave : undefined}
        >
          <div
            ref={trackRailRef}
            className={cn(
              "relative w-full",
              isMobileSheet && "h-4",
              isMobileCard && "h-1.5",
              isMinimal && "h-1.5",
              !isMobile && !isMinimal && "h-3",
            )}
          >
            {/* Human: Pencil rails — desktop 4px blue; mobile-sheet 4px blue; mobile-card 6px blue on gray track. */}
            <div
              className={cn(
                "relative w-full rounded-sm bg-[#E5E7EB]",
                isMobileSheet && "h-1 top-1/2 -translate-y-1/2",
                isMobileCard && "h-1.5",
                isMinimal && "h-1.5",
                !isMobile && !isMinimal && "h-1 top-1/2 -translate-y-1/2",
              )}
            >
              {!isMinimal &&
                !isMobile &&
                bufferedBars.map((bar) => (
                  <div
                    key={bar.key}
                    className="absolute top-1/2 -translate-y-1/2 h-1 rounded-sm bg-[#888888]/25"
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                  />
                ))}

              <div
                className={cn(
                  "absolute top-0 left-0 rounded-sm transition-[width] duration-300 ease-linear z-[1]",
                  isMobileSheet && "h-1 bg-blue-600",
                  isMobileCard && "h-1.5 rounded-[3px] bg-blue-600",
                  isMinimal && "h-1.5 bg-[#1A1A1A]",
                  !isMobile && !isMinimal && "h-1 bg-blue-600",
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Human: Playback thumb — mobile-sheet white disc w/ blue ring; mobile-card solid blue circle. */}
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none z-10 transition-[left] duration-300 ease-linear",
                isMobileSheet &&
                  "h-4 w-4 border-[3px] border-blue-600 bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)]",
                isMobileCard && "h-3 w-3 bg-blue-600",
                isMinimal && "h-3 w-3 bg-[#1A1A1A]",
                !isMobile && !isMinimal && "h-3 w-3 bg-white border-2 border-blue-600 shadow-sm",
              )}
              style={{
                left: isMobileSheet
                  ? `calc(${progressPercent}% - 8px)`
                  : isMobileCard
                    ? `calc(${progressPercent}% - 6px)`
                    : `calc(${progressPercent}% - 6px)`,
              }}
            />

            {/* Human: Pencil Timeline Hover Dot — black fill, white stroke, aligned to teardrop tip. */}
            {isHovering ? (
              <div
                className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-[1.5px] border-white bg-[#1A1A1A] pointer-events-none"
                style={{ left: `calc(${hoverPercent}% - 5px)` }}
              />
            ) : null}

            {/* Human: Teardrop tooltip — 44×52 inverted drop with time centered in the round cap. */}
            {isHovering ? (
              <div
                className="absolute bottom-full z-50 mb-[-4px] flex flex-col items-center pointer-events-none"
                style={{
                  left: `${hoverPercent}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <AudioSeekTeardropTooltip timeLabel={formatAudioTime(hoverSeconds)} />
              </div>
            ) : null}
          </div>

          {/* Human: Keep input enabled so pointermove fires; block seek commits when transport is disabled. */}
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
            onPointerMove={showTeardropHover ? handlePointerMove : undefined}
            onPointerLeave={showTeardropHover ? handlePointerLeave : undefined}
            aria-label="Seek"
            aria-disabled={seekInputDisabled}
            className={cn(
              "absolute inset-0 z-30 h-full w-full opacity-0",
              seekInputDisabled ? "cursor-not-allowed" : "cursor-pointer",
            )}
          />
        </div>
      </div>

      {showTimeLabels ? (
        <div
          className={cn(
            "flex items-center justify-between font-normal tabular-nums",
            isMobile && "mt-2 text-[11px] text-[#666666]",
            isMinimal && !isMobile && "mt-2 text-[11px] text-[#888888]",
            !isMobile && !isMinimal && "mt-1.5 text-[11px] text-[#666666]",
          )}
        >
          <span>{formatAudioTime(progress)}</span>
          <span>{formatAudioTime(trackDuration)}</span>
        </div>
      ) : null}
    </div>
  );
}
