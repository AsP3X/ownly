// Human: Shared playback state for desktop and mobile video surfaces — progress, mute, fullscreen.
// Agent: READS videoRef; mobile uses video-native fullscreen + CSS immersive fallback when API fails.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import {
  readBufferedSegments,
  type BufferedSegment,
} from "@/components/drive/audio/audio-buffered";
import {
  enterVideoFullscreen,
  exitVideoFullscreen,
  isVideoFullscreenActive,
} from "@/components/drive/video/video-fullscreen";

type UseVideoTransportOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  file: FileItem;
  loading?: boolean;
  error?: string;
  fullscreenTargetRef: RefObject<HTMLElement | null>;
  /** Human: Mobile — try <video> fullscreen first (required on iOS). */
  preferVideoElementFullscreen?: boolean;
};

export function useVideoTransport({
  videoRef,
  file,
  loading = false,
  error = "",
  fullscreenTargetRef,
  preferVideoElementFullscreen = false,
}: UseVideoTransportOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSegments, setBufferedSegments] = useState<BufferedSegment[]>([]);
  const [muted, setMuted] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const hideChromeTimerRef = useRef<number | null>(null);
  const wasNativeFullscreenRef = useRef(false);

  const isFullscreen = isNativeFullscreen || isImmersive;

  const failed = file.hls_encode_status === "failed";
  const transportDisabled = loading || Boolean(error) || failed || !file.hls_ready;

  const getFullscreenTargets = useCallback(
    () => ({
      container: fullscreenTargetRef.current,
      video: videoRef.current,
    }),
    [fullscreenTargetRef, videoRef],
  );

  const syncNativeFullscreen = useCallback(() => {
    setIsNativeFullscreen(isVideoFullscreenActive(getFullscreenTargets()));
  }, [getFullscreenTargets]);

  const clearHideChromeTimer = useCallback(() => {
    if (hideChromeTimerRef.current !== null) {
      window.clearTimeout(hideChromeTimerRef.current);
      hideChromeTimerRef.current = null;
    }
  }, []);

  const scheduleHideChrome = useCallback(() => {
    clearHideChromeTimer();
    if (!isPlaying) return;
    hideChromeTimerRef.current = window.setTimeout(() => {
      setShowChrome(false);
    }, 2800);
  }, [clearHideChromeTimer, isPlaying]);

  const revealChrome = useCallback(() => {
    setShowChrome(true);
    scheduleHideChrome();
  }, [scheduleHideChrome]);

  // Human: Reveal chrome on pointer activity over the player shell (including the <video> child).
  // Agent: BINDS capture-phase pointer/mouse listeners on fullscreenTargetRef.
  useEffect(() => {
    const shell = fullscreenTargetRef.current;
    if (!shell) return;

    const onPointerActivity = () => {
      revealChrome();
    };

    shell.addEventListener("pointermove", onPointerActivity, true);
    shell.addEventListener("pointerenter", onPointerActivity, true);
    shell.addEventListener("mousemove", onPointerActivity, true);
    shell.addEventListener("mouseenter", onPointerActivity, true);

    return () => {
      shell.removeEventListener("pointermove", onPointerActivity, true);
      shell.removeEventListener("pointerenter", onPointerActivity, true);
      shell.removeEventListener("mousemove", onPointerActivity, true);
      shell.removeEventListener("mouseenter", onPointerActivity, true);
    };
  }, [file.id, fullscreenTargetRef, revealChrome]);

  // Human: Native/CSS fullscreen — document-level moves (dialog transforms break shell bubbling).
  // Agent: WHEN isFullscreen LISTENS document pointermove/mousemove; CALLS revealChrome.
  useEffect(() => {
    if (!isFullscreen) return;

    const onDocumentPointerActivity = () => {
      revealChrome();
    };

    document.addEventListener("pointermove", onDocumentPointerActivity);
    document.addEventListener("mousemove", onDocumentPointerActivity);

    return () => {
      document.removeEventListener("pointermove", onDocumentPointerActivity);
      document.removeEventListener("mousemove", onDocumentPointerActivity);
    };
  }, [isFullscreen, revealChrome]);

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
    setIsImmersive(false);
    clearHideChromeTimer();
  }, [file.id, clearHideChromeTimer]);

  // Human: Track native fullscreen — standard events plus iOS webkit video fullscreen.
  // Agent: LISTENS fullscreenchange on document and webkit* events on the video element.
  useEffect(() => {
    const video = videoRef.current;

    const onFullscreenChange = () => {
      const wasNative = wasNativeFullscreenRef.current;
      syncNativeFullscreen();
      const nowNative = isVideoFullscreenActive(getFullscreenTargets());
      wasNativeFullscreenRef.current = nowNative;
      if (nowNative && !wasNative) {
        revealChrome();
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    video?.addEventListener("webkitbeginfullscreen", onFullscreenChange);
    video?.addEventListener("webkitendfullscreen", onFullscreenChange);

    wasNativeFullscreenRef.current = isVideoFullscreenActive(getFullscreenTargets());
    syncNativeFullscreen();

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      video?.removeEventListener("webkitbeginfullscreen", onFullscreenChange);
      video?.removeEventListener("webkitendfullscreen", onFullscreenChange);
    };
  }, [syncNativeFullscreen, videoRef, file.id, revealChrome, getFullscreenTargets]);

  useEffect(() => {
    return () => {
      clearHideChromeTimer();
      void exitVideoFullscreen();
      setIsImmersive(false);
    };
  }, [clearHideChromeTimer]);

  useEffect(() => {
    if (isPlaying) scheduleHideChrome();
    else {
      clearHideChromeTimer();
      setShowChrome(true);
    }
  }, [isPlaying, isFullscreen, scheduleHideChrome, clearHideChromeTimer]);

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

  // Human: Exit native or immersive fullscreen; on mobile fall back to CSS immersive when API fails.
  // Agent: CALLS enterVideoFullscreen preferring video; SETS isImmersive when enter returns failed.
  const toggleFullscreen = useCallback(() => {
    revealChrome();

    if (isFullscreen) {
      void exitVideoFullscreen();
      setIsImmersive(false);
      syncNativeFullscreen();
      return;
    }

    void (async () => {
      const result = await enterVideoFullscreen(
        getFullscreenTargets(),
        preferVideoElementFullscreen,
      );
      if (result === "failed" && preferVideoElementFullscreen) {
        setIsImmersive(true);
        revealChrome();
        return;
      }
      syncNativeFullscreen();
      if (result === "failed") {
        setIsImmersive(true);
        revealChrome();
        return;
      }
      revealChrome();
    })();
  }, [
    getFullscreenTargets,
    isFullscreen,
    preferVideoElementFullscreen,
    revealChrome,
    syncNativeFullscreen,
  ]);

  const chromeVisible = showChrome || !isPlaying;

  return {
    isPlaying,
    progress,
    duration,
    bufferedSegments,
    muted,
    isFullscreen,
    isImmersive,
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
