// Human: Shared audio playback state for desktop and mobile player surfaces.
// Agent: OWNS hidden <audio> ref contract; SYNC progress/buffered; CALLS onEnded when track finishes.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readBufferedSegments,
  type BufferedSegment,
} from "@/components/drive/audio/audio-buffered";
import {
  readStoredAudioVolume,
  writeStoredAudioVolume,
} from "@/components/drive/audio/audio-volume-storage";

export type AudioRepeatMode = "off" | "track";

export const AUDIO_SKIP_SECONDS = 10;

type UseAudioTransportOptions = {
  src: string | null;
  loading?: boolean;
  error?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  /** Human: Track title for lock-screen / headset Media Session metadata. */
  mediaTitle?: string;
  /** Human: Optional artwork URL for Media Session (share cover or generic). */
  mediaArtworkUrl?: string | null;
  /** Human: Wired to Media Session previoustrack / nexttrack when the gallery has neighbors. */
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
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
  mediaTitle,
  mediaArtworkUrl,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
}: UseAudioTransportOptions) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSegments, setBufferedSegments] = useState<BufferedSegment[]>([]);
  const [volume, setVolume] = useState(() => readStoredAudioVolume().volume);
  const [muted, setMuted] = useState(() => readStoredAudioVolume().muted);
  const [playbackError, setPlaybackError] = useState("");
  const [repeatMode, setRepeatMode] = useState<AudioRepeatMode>("off");
  const [isScrubbing, setIsScrubbing] = useState(false);

  const effectiveVolume = muted ? 0 : volume;
  const combinedError = error || playbackError;
  const transportDisabled = loading || !src || Boolean(combinedError);
  const repeatTrack = repeatMode === "track";

  // Human: Clear element-level playback errors when the active src changes or parent clears fetch errors.
  // Agent: RESETS playbackError on src/error prop changes so a new track starts clean.
  useEffect(() => {
    setPlaybackError("");
  }, [src, error]);

  // Human: Reset progress when the stream URL changes so the rail does not stick on the prior track.
  // Agent: SETS progress/duration/buffered to empty until the new element reports metadata.
  useEffect(() => {
    setProgress(0);
    setDuration(0);
    setBufferedSegments([]);
    setIsPlaying(false);
  }, [src]);

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

  // Human: Persist volume/mute so the next player open reuses the last preference.
  // Agent: WRITES localStorage whenever volume or muted changes.
  useEffect(() => {
    writeStoredAudioVolume({ volume, muted });
  }, [volume, muted]);

  // Human: Track-loop uses the native loop attribute so ended does not advance the gallery.
  // Agent: WRITES audio.loop from repeatMode.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = repeatTrack;
  }, [repeatTrack, src]);

  // Human: Smooth progress while playing — timeupdate alone is only ~4 Hz.
  // Agent: rAF reads currentTime while isPlaying and not scrubbing.
  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let frameId = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setProgress(audio.currentTime);
        if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying, isScrubbing]);

  // Human: Sync playback position and every buffered TimeRanges segment for the seek bar.
  // Agent: READS audio.currentTime + audio.buffered; SETS progress, duration, bufferedSegments.
  const syncPlaybackState = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isScrubbing) {
      setProgress(audio.currentTime);
    }
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    setBufferedSegments(readBufferedSegments(audio.buffered));
  }, [isScrubbing]);

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
    if (repeatTrack) {
      // Human: Native loop usually prevents ended; if it fires, restart the same track.
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => setIsPlaying(false));
      }
      return;
    }
    setIsPlaying(false);
    onEnded?.();
  }, [onEnded, repeatTrack]);

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

  // Human: Seek via range input / waveform — writes currentTime on the element directly.
  // Agent: SETS audio.currentTime; UPDATES progress state; CLAMPS to [0, duration].
  const handleSeek = useCallback((timeSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : timeSeconds;
    const next = Math.min(Math.max(0, timeSeconds), max);
    audio.currentTime = next;
    setProgress(next);
  }, []);

  const beginScrub = useCallback(() => {
    setIsScrubbing(true);
  }, []);

  const endScrub = useCallback(() => {
    setIsScrubbing(false);
    const audio = audioRef.current;
    if (audio) setProgress(audio.currentTime);
  }, []);

  // Human: Relative seek for skip buttons and keyboard shortcuts (±10s by default).
  // Agent: READS duration; CALLS handleSeek with clamped current + delta.
  const skipBy = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (!audio || transportDisabled) return;
      const base = audio.currentTime;
      const max = Number.isFinite(audio.duration) ? audio.duration : base + deltaSeconds;
      handleSeek(Math.min(Math.max(0, base + deltaSeconds), max));
    },
    [handleSeek, transportDisabled],
  );

  const handleVolumeInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setVolume(next);
    if (next > 0) setMuted(false);
  }, []);

  // Human: Keyboard / hotkey volume nudge — keeps mute cleared when raising from zero.
  // Agent: CLAMPS volume to 0–1; SETS muted false when next > 0.
  const adjustVolume = useCallback((delta: number) => {
    setVolume((prev) => {
      const next = Math.min(1, Math.max(0, prev + delta));
      if (next > 0) setMuted(false);
      return next;
    });
  }, []);

  const setVolumeLevel = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    setVolume(clamped);
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  // Human: Cycle track-loop on/off — shuffle remains decorative until playlist shuffle ships.
  // Agent: TOGGLES repeatMode between off and track.
  const toggleRepeat = useCallback(() => {
    setRepeatMode((prev) => (prev === "off" ? "track" : "off"));
  }, []);

  // Human: Lock-screen / headset controls via the Media Session API.
  // Agent: SETS metadata + action handlers; CLEARS handlers on unmount or src change.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!src || transportDisabled) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        // Human: Some browsers throw when clearing metadata — ignore.
      }
      return;
    }

    const artwork =
      mediaArtworkUrl && mediaArtworkUrl.length > 0
        ? [{ src: mediaArtworkUrl, sizes: "512x512", type: "image/png" }]
        : [];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: mediaTitle?.trim() || "Audio",
        artist: "Ownly",
        album: "Drive",
        artwork,
      });
    } catch {
      // Human: MediaMetadata unsupported — skip metadata only.
    }

    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Human: Unsupported action on this browser — ignore.
      }
    };

    setHandler("play", () => {
      const audio = audioRef.current;
      if (!audio) return;
      void audio.play().catch(() => setIsPlaying(false));
    });
    setHandler("pause", () => {
      audioRef.current?.pause();
    });
    setHandler("seekbackward", (details) => {
      skipBy(-(details.seekOffset ?? AUDIO_SKIP_SECONDS));
    });
    setHandler("seekforward", (details) => {
      skipBy(details.seekOffset ?? AUDIO_SKIP_SECONDS);
    });
    setHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") handleSeek(details.seekTime);
    });
    setHandler("previoustrack", hasPrevious && onPrevious ? () => onPrevious() : null);
    setHandler("nexttrack", hasNext && onNext ? () => onNext() : null);

    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("seekbackward", null);
      setHandler("seekforward", null);
      setHandler("seekto", null);
      setHandler("previoustrack", null);
      setHandler("nexttrack", null);
    };
  }, [
    src,
    transportDisabled,
    mediaTitle,
    mediaArtworkUrl,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
    skipBy,
    handleSeek,
  ]);

  // Human: Keep Media Session playback state in sync for OS UI.
  // Agent: WRITES mediaSession.playbackState from isPlaying.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // Human: playbackState is best-effort.
    }
  }, [isPlaying]);

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
    repeatMode,
    isScrubbing,
    togglePlay,
    handleSeek,
    beginScrub,
    endScrub,
    skipBy,
    handleVolumeInput,
    adjustVolume,
    setVolumeLevel,
    toggleMute,
    toggleRepeat,
  };
}
