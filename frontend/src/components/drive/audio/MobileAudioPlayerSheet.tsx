// Human: Pencil mobile explorer audio player — bottom sheet with waveform, blue play FAB, volume rail.
// Agent: USES useAudioTransport; RENDERS Sheet side=bottom; CALLS parent onPrevious/onNext for gallery nav.

import {
  Airplay,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AudioSeekBar } from "@/components/drive/audio/AudioSeekBar";
import { AudioWaveformBars } from "@/components/drive/audio/audio-waveform-bars";
import { useAudioTransport } from "@/components/drive/audio/useAudioTransport";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";

type MobileAudioPlayerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  src: string | null;
  loading?: boolean;
  error?: string;
  autoPlay?: boolean;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onEnded?: () => void;
  positionLabel?: string | null;
};

export function MobileAudioPlayerSheet({
  open,
  onOpenChange,
  title,
  src,
  loading = false,
  error = "",
  autoPlay = false,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  onEnded,
  positionLabel,
}: MobileAudioPlayerSheetProps) {
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

  const progressPercent = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-none border-0 bg-transparent p-0 shadow-none"
        overlayClassName="bg-[#0A0A15]/60 backdrop-blur-2xl"
      >
        {/* Human: Pencil Audio Player Bottom Sheet — drag handle, header, waveform, transport. */}
        <div className="rounded-t-3xl border border-b-0 border-[#E5E7EB] bg-white px-6 pb-8 pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
          <div className="flex h-2 items-center justify-center" aria-hidden>
            <div className="h-1 w-9 rounded-sm bg-[#D1D5DB]" />
          </div>

          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                Audio preview
              </p>
              <p className="mt-0.5 truncate text-lg font-bold leading-tight text-[#1A1A1A]">
                {title}
              </p>
              {positionLabel ? (
                <p className="mt-0.5 text-xs text-[#888888]">{positionLabel}</p>
              ) : null}
            </div>
            <SheetClose
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-[#F7F8FA] text-[#666666] transition-colors hover:bg-[#E5E7EB]"
              aria-label="Close audio player"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </SheetClose>
          </div>

          {combinedError ? (
            <p
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {combinedError}
            </p>
          ) : null}

          {loading ? (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-[#888888]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading audio…
            </p>
          ) : null}

          <div className="mt-4">
            <AudioWaveformBars progressPercent={progressPercent} />
          </div>

          <div className="mt-2">
            <AudioSeekBar
              progress={progress}
              duration={duration}
              bufferedSegments={bufferedSegments}
              disabled={transportDisabled}
              showTimeLabels
              variant="mobile-sheet"
              onSeek={handleSeek}
            />
          </div>

          {/* Human: Playback cluster — shuffle/repeat decorative; prev/next wired to gallery handlers. */}
          <div className="mt-3 flex items-center justify-around px-0 py-3">
            <button
              type="button"
              disabled
              aria-hidden
              tabIndex={-1}
              className="inline-flex items-center justify-center text-[#666666] opacity-40"
            >
              <Shuffle className="h-5 w-5" strokeWidth={1.75} />
            </button>

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
              className="inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.24)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              ) : isPlaying ? (
                <Pause className="h-6 w-6" fill="currentColor" />
              ) : (
                <Play className="ml-0.5 h-6 w-6" fill="currentColor" />
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

            <button
              type="button"
              disabled
              aria-hidden
              tabIndex={-1}
              className="inline-flex items-center justify-center text-[#666666] opacity-40"
            >
              <Repeat className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          {/* Human: Volume rail left; output label right — device picker is display-only on web. */}
          <div className="mt-2 flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
                className="inline-flex h-8 w-8 items-center justify-center text-[#666666]"
              >
                {effectiveVolume === 0 ? (
                  <VolumeX className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Volume2 className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
              <div className="relative h-3 w-[90px]">
                <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[#E5E7EB]" />
                <div
                  className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[#666666]"
                  style={{ width: `${effectiveVolume * 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#1A1A1A] pointer-events-none"
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

            <div
              className="flex items-center gap-1 text-[11px] font-medium text-[#666666]"
              aria-hidden
            >
              <Airplay className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Device speaker</span>
              <ChevronUp className="h-2.5 w-2.5 text-[#888888]" strokeWidth={2} />
            </div>
          </div>
        </div>

        {/* Agent: WRITES src when resolved; LISTENS media events via useAudioTransport. */}
        <audio {...audioElementProps} />
      </SheetContent>
    </Sheet>
  );
}
