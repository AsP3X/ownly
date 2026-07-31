// Human: Shared volume mute button + range rail for desktop and mobile audio players.
// Agent: PROPS effectiveVolume + handlers; RENDERS mute toggle and invisible range over styled track.

import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

type VolumeRailProps = {
  effectiveVolume: number;
  onToggleMute: () => void;
  onVolumeInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Human: default = desktop player core; compact = mobile sheet; embedded = dialog chrome. */
  variant?: "default" | "compact" | "embedded";
  className?: string;
};

export function VolumeRail({
  effectiveVolume,
  onToggleMute,
  onVolumeInput,
  variant = "default",
  className,
}: VolumeRailProps) {
  const isEmbedded = variant === "embedded";
  const isCompact = variant === "compact";
  const railWidth = isEmbedded ? "w-[100px]" : isCompact ? "w-[90px]" : "w-20";
  const railHeight = isEmbedded ? "h-1.5" : "h-3";
  const fillHeight = isEmbedded ? "h-1.5 top-0" : "h-1 top-1/2 -translate-y-1/2";
  const trackHeight = isEmbedded ? "h-1.5 top-0" : "h-1 top-1/2 -translate-y-1/2";
  const fillColor = isEmbedded ? "bg-ink-muted" : "bg-ink-muted";
  const iconSize = isCompact ? "h-4 w-4" : "h-[18px] w-[18px]";

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
        className={cn(
          "inline-flex shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink",
          isCompact ? "h-8 w-8" : "h-8 w-8",
        )}
      >
        {effectiveVolume === 0 ? (
          <VolumeX className={iconSize} strokeWidth={1.75} />
        ) : (
          <Volume2 className={iconSize} strokeWidth={1.75} />
        )}
      </button>

      <div className={cn("relative cursor-pointer", railHeight, railWidth)}>
        <div className={cn("absolute inset-x-0 rounded-sm bg-edge", trackHeight)} />
        <div
          className={cn("absolute left-0 rounded-sm", fillHeight, fillColor)}
          style={{ width: `${effectiveVolume * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-ink pointer-events-none"
          style={{ left: `calc(${effectiveVolume * 100}% - 4px)` }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={effectiveVolume}
          onChange={onVolumeInput}
          aria-label="Volume"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}
