// Human: Self-contained light-themed audio transport — play, seek, volume, and optional folder queue controls.
// Agent: OWNS hidden <audio>; SYNC progress/buffered from events; CALLS onEnded when track finishes.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AudioSeekBar } from "@/components/drive/audio/AudioSeekBar";
import {
  readBufferedSegments,
  type BufferedSegment,
} from "@/components/drive/audio/audio-buffered";
import { formatAudioTime } from "@/components/drive/audio/audio-time";
import { audioFormatLabel } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

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
  className,
}: LightAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSegments, setBufferedSegments] = useState<BufferedSegment[]>([]);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const effectiveVolume = muted ? 0 : volume;
  const formatLabel = audioFormatLabel(mimeType, title);
  const transportDisabled = loading || !src || Boolean(error);

  // Human: Honor autoPlay once when a track finishes loading (gallery advance or queue roll).
  // Agent: READS autoPlay+src; CALLS audio.play() on mount/update without resetting other state.
  useEffect(() => {
    if (!autoPlay || !src) return;
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().catch(() => setIsPlaying(false));
  }, [autoPlay, src]);

  // Human: Keep the audible volume matched to slider and mute toggle.
  // Agent: WRITES audio.volume from effectiveVolume.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = effectiveVolume;
  }, [effectiveVolume]);

  // Human: Sync playback position and every buffered TimeRanges segment for the seek bar.
  // Agent: READS audio.currentTime + audio.buffered; SETS progress, duration, bufferedSegments.
  const syncPlaybackState = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setProgress(audio.currentTime);
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    setBufferedSegments(readBufferedSegments(audio.buffered));
  }, []);

  const handleTimeUpdate = useCallback(() => {
    syncPlaybackState();
  }, [syncPlaybackState]);

  const handleProgress = useCallback(() => {
    syncPlaybackState();
  }, [syncPlaybackState]);

  const handleLoadedMetadata = useCallback(() => {
    syncPlaybackState();
  }, [syncPlaybackState]);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    onEnded?.();
  }, [onEnded]);

  // Human: Toggle play/pause on the underlying media element.
  // Agent: CALLS audio.play() or pause(); UPDATES isPlaying on success/failure.
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || transportDisabled) return;

    if (audio.paused) {
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [transportDisabled]);

  // Human: Seek via range input — writes currentTime on the element directly.
  // Agent: SETS audio.currentTime; UPDATES progress state.
  const handleSeek = useCallback((timeSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = timeSeconds;
    setProgress(timeSeconds);
  }, []);

  const handleVolumeInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setVolume(next);
    if (next > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-background shadow-sm",
        className,
      )}
    >
      <div className="px-4 sm:px-5 py-4 space-y-4">
        {/* Human: Track identity row — title, format chip, and compact elapsed/total on wide screens. */}
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
            aria-hidden
          >
            <Volume2 className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                {formatLabel}
              </span>
              {loading && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  Loading…
                </span>
              )}
            </div>
          </div>
          <span className="hidden sm:block shrink-0 text-[11px] font-mono tabular-nums text-muted-foreground">
            {formatAudioTime(progress)} / {formatAudioTime(duration)}
          </span>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <AudioSeekBar
          progress={progress}
          duration={duration}
          bufferedSegments={bufferedSegments}
          disabled={transportDisabled}
          showTimeLabels
          onSeek={handleSeek}
        />

        {/* Human: Transport row — previous, play/pause, next, and volume on one light toolbar. */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrevious}
              disabled={!hasPrevious || transportDisabled}
              aria-label="Previous track"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={transportDisabled}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4 ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext || transportDisabled}
              aria-label="Next track"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {effectiveVolume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>

            <div className="relative h-1.5 w-20 sm:w-24 rounded-full bg-muted overflow-hidden group cursor-pointer">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
                style={{ width: `${effectiveVolume * 100}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-foreground shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
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
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {src ? (
        <audio
          ref={audioRef}
          src={src}
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          preload="metadata"
          className="sr-only"
        />
      ) : null}
    </div>
  );
}
