// Human: Ownly audio transport — Pencil Audio Player Core (default) or embedded dialog chrome (minimal metadata).
// Agent: USES useAudioTransport; desktop/default variant only — mobile uses MobileAudioPlayer* surfaces.

import {
  Loader2,
  Music,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { AudioSeekBar } from "@/components/drive/audio/AudioSeekBar";
import { AudioWaveformBars } from "@/components/drive/audio/audio-waveform-bars";
import { formatAudioTime } from "@/components/drive/audio/audio-time";
import {
  AUDIO_SKIP_SECONDS,
  useAudioTransport,
} from "@/components/drive/audio/useAudioTransport";
import { useAudioPlayerHotkeys } from "@/components/drive/audio/useAudioPlayerHotkeys";
import { VolumeRail } from "@/components/drive/audio/VolumeRail";
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
  /** Human: default = full metadata card; embedded = waveform + seek + controls for Audio preview dialog. */
  variant?: LightAudioPlayerVariant;
  /** Human: Analyzed peak heights from Nebular waveform.json; shows decorative fallback when absent. */
  waveformBars?: number[] | null;
  /** Human: Enable document hotkeys (Space, J/L, arrows). Off for secondary inline embeds if needed. */
  hotkeysEnabled?: boolean;
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
  waveformBars,
  hotkeysEnabled = true,
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
    repeatMode,
    isScrubbing,
    togglePlay,
    handleSeek,
    beginScrub,
    endScrub,
    skipBy,
    handleVolumeInput,
    adjustVolume,
    toggleMute,
    toggleRepeat,
  } = useAudioTransport({
    src,
    loading,
    error,
    autoPlay,
    onEnded,
    mediaTitle: title,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
  });

  useAudioPlayerHotkeys({
    enabled: hotkeysEnabled,
    transportDisabled,
    togglePlay,
    toggleMute,
    toggleRepeat,
    skipBy,
    handleSeek,
    adjustVolume,
    duration,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
  });

  const isEmbedded = variant === "embedded";
  const formatLabel = audioFormatLabel(mimeType, title);
  const playButtonSize = isEmbedded ? "h-11 w-11" : "h-12 w-12";
  const playIconSize = isEmbedded ? "h-4 w-4" : "h-[18px] w-[18px]";
  const progressPercent =
    duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  const repeatActive = repeatMode === "track";

  // Human: Prev/next skip through the gallery when available; otherwise jump ±10 seconds.
  // Agent: CALLS onPrevious/onNext or skipBy; buttons stay enabled when relative skip is possible.
  const handlePreviousClick = () => {
    if (hasPrevious && onPrevious) {
      onPrevious();
      return;
    }
    skipBy(-AUDIO_SKIP_SECONDS);
  };

  const handleNextClick = () => {
    if (hasNext && onNext) {
      onNext();
      return;
    }
    skipBy(AUDIO_SKIP_SECONDS);
  };

  const previousDisabled = transportDisabled || (!hasPrevious && duration <= 0);
  const nextDisabled = transportDisabled || (!hasNext && duration <= 0);

  const showWaveform = isEmbedded || Boolean(waveformBars?.length);

  return (
    <div
      className={cn(
        isEmbedded
          ? "flex flex-col gap-5 overflow-visible"
          : "overflow-visible rounded-2xl border border-edge bg-surface p-6",
        className,
      )}
    >
      {/* Human: File metadata row — Pencil Audio Player Core; omitted in embedded dialog variant. */}
      {!isEmbedded ? (
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand-weak"
              aria-hidden
            >
              <Music className="h-[22px] w-[22px] text-brand" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-ink-muted bg-surface">
                  {formatLabel}
                </span>
                {loading ? (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Loading…
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-ink-muted">
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
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading audio…
        </p>
      ) : null}

      {/* Human: Waveform + seek rail — embedded always; default when peaks are available. */}
      {showWaveform ? (
        <div className="flex flex-col gap-2">
          <AudioWaveformBars
            progressPercent={progressPercent}
            bars={waveformBars}
            duration={duration}
            disabled={transportDisabled}
            onSeek={handleSeek}
            onSeekStart={beginScrub}
            onSeekEnd={endScrub}
          />
          <AudioSeekBar
            progress={progress}
            duration={duration}
            bufferedSegments={bufferedSegments}
            disabled={transportDisabled}
            isScrubbing={isScrubbing}
            showTimeLabels
            variant={isEmbedded ? "minimal" : "default"}
            onSeek={handleSeek}
            onSeekStart={beginScrub}
            onSeekEnd={endScrub}
          />
        </div>
      ) : (
        <AudioSeekBar
          progress={progress}
          duration={duration}
          bufferedSegments={bufferedSegments}
          disabled={transportDisabled}
          isScrubbing={isScrubbing}
          showTimeLabels
          variant="default"
          onSeek={handleSeek}
          onSeekStart={beginScrub}
          onSeekEnd={endScrub}
        />
      )}

      {/* Human: Transport row — repeat, prev/play/next, volume rail. */}
      <div
        className={cn(
          "flex items-center justify-between",
          isEmbedded ? "h-11" : "h-12",
        )}
      >
        <div className={cn("flex shrink-0 items-center", isEmbedded ? "w-[126px]" : "w-[120px]")}>
          <button
            type="button"
            onClick={toggleRepeat}
            aria-label={repeatActive ? "Disable repeat" : "Repeat track"}
            aria-pressed={repeatActive}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center transition-colors",
              repeatActive ? "text-brand" : "text-ink-muted hover:text-ink",
            )}
          >
            <Repeat className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={handlePreviousClick}
            disabled={previousDisabled}
            aria-label={hasPrevious ? "Previous track" : `Skip back ${AUDIO_SKIP_SECONDS} seconds`}
            className={cn(
              "inline-flex items-center justify-center transition-opacity disabled:opacity-40 disabled:pointer-events-none",
              isEmbedded ? "text-ink-muted" : "text-ink",
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
              "inline-flex items-center justify-center rounded-full bg-ink text-panel shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none",
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
            onClick={handleNextClick}
            disabled={nextDisabled}
            aria-label={hasNext ? "Next track" : `Skip forward ${AUDIO_SKIP_SECONDS} seconds`}
            className={cn(
              "inline-flex items-center justify-center transition-opacity disabled:opacity-40 disabled:pointer-events-none",
              isEmbedded ? "text-ink-muted" : "text-ink",
            )}
          >
            <SkipForward className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div
          className={cn(
            "flex items-center justify-end min-w-0 shrink-0",
            isEmbedded ? "w-[126px]" : "w-[120px]",
          )}
        >
          <VolumeRail
            effectiveVolume={effectiveVolume}
            onToggleMute={toggleMute}
            onVolumeInput={handleVolumeInput}
            variant={isEmbedded ? "embedded" : "default"}
          />
        </div>
      </div>

      {/* Human: Keep the media element mounted so transport refs stay valid while src loads. */}
      {/* Agent: WRITES src only when resolved; LISTENS error for failed decode/network. */}
      <audio {...audioElementProps} />
    </div>
  );
}
