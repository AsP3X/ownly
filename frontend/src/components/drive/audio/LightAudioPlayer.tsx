// Human: Ownly audio transport — Pencil Audio Player Core (default) or embedded dialog chrome (minimal metadata).
// Agent: USES useAudioTransport; desktop/default variant only — mobile uses MobileAudioPlayer* surfaces.

import {
  Loader2,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AudioSeekBar } from "@/components/drive/audio/AudioSeekBar";
import { useAudioTransport } from "@/components/drive/audio/useAudioTransport";
import { formatAudioTime } from "@/components/drive/audio/audio-time";
import { audioFormatLabel } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type LightAudioPlayerVariant = "default" | "embedded";

type LightAudioPlayerProps = {
  src: string | null;
  title: string;
  mimeType: string | null;
  loading?: boolean;
  error?: string;
  autoPlay?: boolean;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onEnded?: () => void;
  /** Human: default = full metadata card; embedded = seek + controls only for Audio preview dialog. */
  variant?: LightAudioPlayerVariant;
  className?: string;
};

export function LightAudioPlayer({
  src,
  title,
  mimeType,
  loading = false,
  error = "",
  autoPlay = false,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  onEnded,
  variant = "default",
  className,
}: LightAudioPlayerProps) {
  const {
    audioElementProps,
    isPlaying,
    progress,
    duration,
    bufferedSegments,
    effectiveVolume,
    combinedError,
    transportDisabled,
    togglePlay,
    handleSeek,
    handleVolumeInput,
    toggleMute,
  } = useAudioTransport({ src, loading, error, autoPlay, onEnded });

  const isEmbedded = variant === "embedded";
  const formatLabel = audioFormatLabel(mimeType, title);
  const playButtonSize = isEmbedded ? "h-11 w-11" : "h-12 w-12";
  const playIconSize = isEmbedded ? "h-4 w-4" : "h-[18px] w-[18px]";

  return (
    <div
      className={cn(
        isEmbedded
          ? "flex flex-col gap-5 overflow-visible"
          : "overflow-visible rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-6",
        className,
      )}
    >
      {/* Human: File metadata row — Pencil Audio Player Core; omitted in embedded dialog variant. */}
      {!isEmbedded ? (
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50"
              aria-hidden
            >
              <Music className="h-[22px] w-[22px] text-blue-600" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#1A1A1A]">{title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#666666] bg-[#F7F8FA]">
                  {formatLabel}
                </span>
                {loading ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[#888888]">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Loading…
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-[#666666]">
            {formatAudioTime(progress)} / {formatAudioTime(duration)}
          </span>
        </div>
      ) : null}

      {combinedError ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {combinedError}
        </p>
      ) : null}

      {isEmbedded && loading ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-[#888888]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading audio…
        </p>
      ) : null}

      <AudioSeekBar
        progress={progress}
        duration={duration}
        bufferedSegments={bufferedSegments}
        disabled={transportDisabled}
        showTimeLabels
        variant={isEmbedded ? "minimal" : "default"}
        onSeek={handleSeek}
      />

      {/* Human: Transport row — centered playback cluster with volume rail on the right per Pencil layout. */}
      <div
        className={cn(
          "flex items-center justify-between",
          isEmbedded ? "h-11" : "h-12",
        )}
      >
        <div className={cn("shrink-0", isEmbedded ? "w-[126px]" : "w-[120px]")} aria-hidden />

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!hasPrevious || transportDisabled}
            aria-label="Previous track"
            className={cn(
              "inline-flex items-center justify-center transition-opacity disabled:opacity-40 disabled:pointer-events-none",
              isEmbedded ? "text-[#666666]" : "text-[#1A1A1A]",
            )}
          >
            <SkipBack className="h-5 w-5" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={transportDisabled}
            aria-label={isPlaying ? "Pause" : "Play"}
            className={cn(
              "inline-flex items-center justify-center rounded-full bg-[#0A0A0A] text-white shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none",
              playButtonSize,
            )}
          >
            {loading ? (
              <Loader2 className={cn(playIconSize, "animate-spin")} aria-hidden />
            ) : isPlaying ? (
              <Pause className={playIconSize} fill="currentColor" />
            ) : (
              <Play className={cn(playIconSize, "ml-0.5")} fill="currentColor" />
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext || transportDisabled}
            aria-label="Next track"
            className={cn(
              "inline-flex items-center justify-center transition-opacity disabled:opacity-40 disabled:pointer-events-none",
              isEmbedded ? "text-[#666666]" : "text-[#1A1A1A]",
            )}
          >
            <SkipForward className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div
          className={cn(
            "flex items-center gap-2 min-w-0 shrink-0",
            isEmbedded ? "w-[126px] justify-end" : "w-[120px] justify-end",
          )}
        >
          <button
            type="button"
            onClick={toggleMute}
            aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[#666666] transition-colors hover:text-[#1A1A1A]"
          >
            {effectiveVolume === 0 ? (
              <VolumeX className="h-[18px] w-[18px]" strokeWidth={1.75} />
            ) : (
              <Volume2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
            )}
          </button>

          {/* Human: Volume rail — 80px default core, 100px embedded dialog; 4px/6px track heights. */}
          <div
            className={cn(
              "relative cursor-pointer",
              isEmbedded ? "h-1.5 w-[100px]" : "h-3 w-20",
            )}
          >
            <div
              className={cn(
                "absolute inset-x-0 rounded-sm bg-[#E5E7EB]",
                isEmbedded ? "top-0 h-1.5" : "top-1/2 h-1 -translate-y-1/2",
              )}
            />
            <div
              className={cn(
                "absolute left-0 rounded-sm",
                isEmbedded ? "top-0 h-1.5 bg-[#4B5563]" : "top-1/2 h-1 -translate-y-1/2 bg-[#666666]",
              )}
              style={{ width: `${effectiveVolume * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 rounded-full bg-[#1A1A1A] pointer-events-none h-2 w-2"
              style={{ left: `calc(${effectiveVolume * 100}% - 4px)` }}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effectiveVolume}
              onChange={handleVolumeInput}
              aria-label="Volume"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
        </div>
      </div>

      {/* Human: Keep the media element mounted so transport refs stay valid while src loads. */}
      {/* Agent: WRITES src only when resolved; LISTENS error for failed decode/network. */}
      <audio {...audioElementProps} />
    </div>
  );
}
