// Human: Shared audio playback state for desktop and mobile player surfaces.
// Agent: OWNS hidden <audio> ref contract; SYNC progress/buffered; CALLS onEnded when track finishes.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readBufferedSegments,
  type BufferedSegment,
} from "@/components/drive/audio/audio-buffered";

type UseAudioTransportOptions = {
  src: string | null;
  loading?: boolean;
  error?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
};

// Human: Map MediaError codes to short user-facing playback messages.
// Agent: READS HTMLMediaElement.error.code; RETURNS safe text for player alerts.
function describeMediaError(mediaError: MediaError | null): string {
  switch (mediaError?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Playback was interrupted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Could not load this audio file — check your connection.";
    case MediaError.MEDIA_ERR_DECODE:
      return "This audio format could not be decoded in the browser.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This audio file is not supported for in-browser playback.";
    default:
      return "Could not play this audio file.";
  }
}

export function useAudioTransport({
  src,
  loading = false,
  error = "",
  autoPlay = false,
  onEnded,
}: UseAudioTransportOptions) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSegments, setBufferedSegments] = useState<BufferedSegment[]>([]);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackError, setPlaybackError] = useState("");

  const effectiveVolume = muted ? 0 : volume;
  const combinedError = error || playbackError;
  const transportDisabled = loading || !src || Boolean(combinedError);

  // Human: Clear element-level playback errors when the active src changes or parent clears fetch errors.
  // Agent: RESETS playbackError on src/error prop changes so a new track starts clean.
  useEffect(() => {
    setPlaybackError("");
  }, [src, error]);

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

  const handleMediaError = useCallback(() => {
    const audio = audioRef.current;
    setIsPlaying(false);
    setPlaybackError(describeMediaError(audio?.error ?? null));
  }, []);

  // Human: Toggle play/pause on the underlying media element.
  // Agent: CALLS audio.play() or pause(); UPDATES isPlaying on success/failure.
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || transportDisabled) return;

    if (audio.paused) {
      void audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setPlaybackError("");
        })
        .catch(() => {
          setIsPlaying(false);
          setPlaybackError("Playback was blocked or could not start.");
        });
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

  const audioElementProps = {
    ref: audioRef,
    src: src ?? undefined,
    onTimeUpdate: handleTimeUpdate,
    onProgress: handleProgress,
    onLoadedMetadata: handleLoadedMetadata,
    onDurationChange: handleLoadedMetadata,
    onPlay: handlePlay,
    onPause: handlePause,
    onEnded: handleEnded,
    onError: handleMediaError,
    preload: "metadata" as const,
    className: "sr-only",
  };

  return {
    audioRef,
    audioElementProps,
    isPlaying,
    progress,
    duration,
    bufferedSegments,
    volume,
    muted,
    effectiveVolume,
    combinedError,
    transportDisabled,
    togglePlay,
    handleSeek,
    handleVolumeInput,
    toggleMute,
  };
}
