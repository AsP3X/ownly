// Human: Decorative waveform bars for the mobile audio bottom sheet — Pencil Waveform Container.
// Agent: READS progressPercent; COLORS bars blue when index is before playback position.

import { cn } from "@/lib/utils";

// Human: Static bar heights from Pencil Ownly Explorer Audio Player — Mobile Portrait (32 bars).
// Agent: CONST array; USED by AudioWaveformBars to render fixed decorative amplitudes.
const WAVEFORM_BAR_HEIGHTS = [
  20, 28, 44, 32, 24, 48, 56, 38, 22, 16, 32, 42, 58, 64, 48, 36, 28, 40, 52, 44, 30, 18, 26,
  34, 46, 50, 38, 24, 18, 28, 36, 20,
] as const;

type AudioWaveformBarsProps = {
  /** Human: 0–100 playback position — bars at or before this index use accent fill. */
  progressPercent: number;
  className?: string;
};

export function AudioWaveformBars({ progressPercent, className }: AudioWaveformBarsProps) {
  const playedBarCount = Math.round((progressPercent / 100) * WAVEFORM_BAR_HEIGHTS.length);

  return (
    <div
      className={cn(
        "flex h-16 items-center justify-center gap-[3px] px-0 py-2.5",
        className,
      )}
      aria-hidden
    >
      {WAVEFORM_BAR_HEIGHTS.map((height, index) => (
        <div
          key={index}
          className={cn(
            "w-1 shrink-0 rounded-sm transition-colors duration-300",
            index < playedBarCount ? "bg-blue-600" : "bg-[#E5E7EB]",
          )}
          style={{ height: `${height}px` }}
        />
      ))}
    </div>
  );
}
