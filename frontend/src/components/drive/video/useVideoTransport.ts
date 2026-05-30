// Human: Shared playback state for desktop and mobile video surfaces — progress, mute, chrome hide.
// Agent: READS videoRef + file id; WRITES isPlaying/progress/duration; EXPOSES transport handlers.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import {
  readBufferedSegments,
  type BufferedSegment,
} from "@/components/drive/audio/audio-buffered";

type UseVideoTransportOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  file: FileItem;
  loading?: boolean;
  error?: string;
  fullscreenTargetRef: RefObject<HTMLElement | null>;
};

export function useVideoTransport({
  videoRef,
  file,
  loading = false,
  error = "",
  fullscreenTargetRef,
}: UseVideoTransportOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSegments, setBufferedSegments] = useState<BufferedSegment[]>([]);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const hideChromeTimerRef = useRef<number | null>(null);

  const failed = file.hls_encode_status === "failed";
  const transportDisabled = loading || Boolean(error) || failed || !file.hls_ready;

  const clearHideChromeTimer = useCallback(() => {
    if (hideChromeTimerRef.current !== null) {
      window.clearTimeout(hideChromeTimerRef.current);
      hideChromeTimerRef.current = null;
    }
  }, []);

  const scheduleHideChrome = useCallback(() => {
    clearHideChromeTimer();
    if (!isPlaying || isFullscreen) return;
    hideChromeTimerRef.current = window.setTimeout(() => {
      setShowChrome(false);
    }, 2800);
  }, [clearHideChromeTimer, isFullscreen, isPlaying]);

  const revealChrome = useCallback(() => {
    setShowChrome(true);
    scheduleHideChrome();
  }, [scheduleHideChrome]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncProgress = () => {
      setProgress(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setBufferedSegments(readBufferedSegments(video.buffered));
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    video.addEventListener("timeupdate", syncProgress);
    video.addEventListener("durationchange", syncProgress);
    video.addEventListener("progress", syncProgress);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);

    syncProgress();

    return () => {
      video.removeEventListener("timeupdate", syncProgress);
      video.removeEventListener("durationchange", syncProgress);
      video.removeEventListener("progress", syncProgress);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoRef, file.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted, videoRef]);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
    setBufferedSegments([]);
    setShowChrome(true);
    clearHideChromeTimer();
  }, [file.id, clearHideChromeTimer]);

  useEffect(() => {
    function onFullscreenChange() {
      const target = fullscreenTargetRef.current;
      setIsFullscreen(Boolean(target && document.fullscreenElement === target));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [fullscreenTargetRef]);

  useEffect(() => {
    return () => {
      clearHideChromeTimer();
      const target = fullscreenTargetRef.current;
      if (target && document.fullscreenElement === target) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [clearHideChromeTimer, fullscreenTargetRef]);

  useEffect(() => {
    if (isPlaying) scheduleHideChrome();
    else {
      clearHideChromeTimer();
      setShowChrome(true);
    }
  }, [isPlaying, scheduleHideChrome, clearHideChromeTimer]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || transportDisabled) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
    revealChrome();
  }, [revealChrome, transportDisabled, videoRef]);

  const handleSeek = useCallback(
    (timeSeconds: number) => {
      const video = videoRef.current;
      if (!video || transportDisabled) return;
      video.currentTime = timeSeconds;
      setProgress(timeSeconds);
      revealChrome();
    },
    [revealChrome, transportDisabled, videoRef],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
    revealChrome();
  }, [revealChrome]);

  const toggleFullscreen = useCallback(() => {
    const target = fullscreenTargetRef.current;
    if (!target) return;
    revealChrome();
    if (document.fullscreenElement === target) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void target.requestFullscreen().catch(() => undefined);
  }, [fullscreenTargetRef, revealChrome]);

  const chromeVisible = showChrome || !isPlaying || isFullscreen;

  return {
    isPlaying,
    progress,
    duration,
    bufferedSegments,
    muted,
    isFullscreen,
    transportDisabled,
    failed,
    chromeVisible,
    revealChrome,
    togglePlay,
    handleSeek,
    toggleMute,
    toggleFullscreen,
  };
}
