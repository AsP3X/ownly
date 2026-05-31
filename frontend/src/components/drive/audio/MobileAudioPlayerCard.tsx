// Human: Pencil public-share mobile audio card — icon hero, blue seek rail, compact transport row.
// Agent: USES useAudioTransport; RENDERS inline card for PublicShareInlineAudio on narrow viewports.

import {
  Loader2,
  Music4,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AudioSeekBar } from "@/components/drive/audio/AudioSeekBar";
import { useAudioTransport } from "@/components/drive/audio/useAudioTransport";
import { audioFormatLabel } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type MobileAudioPlayerCardProps = {
  title: string;
  mimeType: string | null;
  specsLabel?: string | null;
  src: string | null;
  loading?: boolean;
  error?: string;
  autoPlay?: boolean;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onEnded?: () => void;
  className?: string;
};

export function MobileAudioPlayerCard({
  title,
  mimeType,
  specsLabel,
  src,
  loading = false,
  error = "",
  autoPlay = false,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  onEnded,
  className,
}: MobileAudioPlayerCardProps) {
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
    toggleMute,
  } = useAudioTransport({ src, loading, error, autoPlay, onEnded });

  const formatLabel = audioFormatLabel(mimeType, title);
  const specs = specsLabel ?? formatLabel;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-[20px] border border-[#E5E7EB] bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.05)]",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-blue-600">Audio preview</p>
        <p className="mt-1 truncate text-[15px] font-bold leading-snug text-[#1A1A1A]">{title}</p>
      </div>

      <div className="flex h-[120px] flex-col items-center justify-center gap-2 rounded-xl bg-[#F7F8FA]">
        <Music4 className="h-10 w-10 text-blue-600" strokeWidth={1.5} aria-hidden />
        <p className="text-[11px] font-medium text-[#666666]">{specs}</p>
      </div>

      {combinedError ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {combinedError}
        </p>
      ) : null}

      {loading ? (
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
        variant="mobile-card"
        onSeek={handleSeek}
      />

      {/* Human: Repeat and volume flank centered prev/play/next cluster per Pencil mobile card. */}
      <div className="flex items-center justify-between px-2 pt-1">
        <button
          type="button"
          disabled
          aria-hidden
          tabIndex={-1}
          className="inline-flex items-center justify-center text-[#666666] opacity-40"
        >
          <Repeat className="h-5 w-5" strokeWidth={1.75} />
        </button>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!hasPrevious || transportDisabled}
            aria-label="Previous track"
            className="inline-flex items-center justify-center text-[#1A1A1A] transition-opacity disabled:opacity-40 disabled:pointer-events-none"
          >
            <SkipBack className="h-6 w-6" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={transportDisabled}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#0A0A0A] text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : isPlaying ? (
              <Pause className="h-5 w-5" fill="currentColor" />
            ) : (
              <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext || transportDisabled}
            aria-label="Next track"
            className="inline-flex items-center justify-center text-[#1A1A1A] transition-opacity disabled:opacity-40 disabled:pointer-events-none"
          >
            <SkipForward className="h-6 w-6" strokeWidth={1.75} />
          </button>
        </div>

        <button
          type="button"
          onClick={toggleMute}
          aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
          className="inline-flex items-center justify-center text-[#666666]"
        >
          {effectiveVolume === 0 ? (
            <VolumeX className="h-5 w-5" strokeWidth={1.75} />
          ) : (
            <Volume2 className="h-5 w-5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <audio {...audioElementProps} />
    </div>
  );
}
