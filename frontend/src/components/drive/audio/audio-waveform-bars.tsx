// Human: Decorative or analyzed waveform bars for mobile sheet and desktop audio preview dialog.
// Agent: READS optional bars from API sidecar; FALLS BACK to Pencil static heights when absent.

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
  className?: string;
};

export function AudioWaveformBars({ progressPercent, bars, className }: AudioWaveformBarsProps) {
  const heights = bars?.length ? bars : FALLBACK_WAVEFORM_BAR_HEIGHTS;
  const playedBarCount = Math.round((progressPercent / 100) * heights.length);

  return (
    <div
      className={cn(
        "flex h-16 items-center justify-center gap-[3px] px-0 py-2.5",
        className,
      )}
      aria-hidden
    >
      {heights.map((height, index) => (
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

export type AudioWaveformArtifact = {
  version: number;
  bar_count: number;
  max_height: number;
  bars: number[];
};
