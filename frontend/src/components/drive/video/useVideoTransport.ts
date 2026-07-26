// Human: Shared playback state for desktop and mobile video surfaces — progress, mute, volume, rate, PiP, fullscreen, resume.
// Agent: READS videoRef; mobile uses video-native fullscreen + CSS immersive fallback when API fails.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
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
import {
  readVideoLoopPreference,
  writeVideoLoopPreference,
} from "@/lib/video-loop-preference";
import {
  nextVideoPlaybackRate,
  previousVideoPlaybackRate,
  readVideoPlaybackPreferences,
  writeVideoPlaybackPreferences,
  type VideoPlaybackRate,
} from "@/lib/video-playback-preference";
import {
  clearVideoResumePosition,
  isMeaningfulResumePosition,
  readVideoResumePosition,
  writeVideoResumePosition,
} from "@/lib/video-resume-preference";

const SEEK_STEP_SECONDS = 5;
const SEEK_JUMP_SECONDS = 10;
const VOLUME_STEP = 0.05;
const RESUME_SAVE_INTERVAL_MS = 4000;

type UseVideoTransportOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  file: FileItem;
  loading?: boolean;
  error?: string;
  fullscreenTargetRef: RefObject<HTMLElement | null>;
  /** Human: Mobile — try <video> fullscreen first (required on iOS). */
  preferVideoElementFullscreen?: boolean;
};

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

function isPictureInPictureSupported(video: HTMLVideoElement | null): boolean {
  if (typeof document === "undefined" || !video) return false;
  if (!("pictureInPictureEnabled" in document) || !document.pictureInPictureEnabled) {
    return false;
  }
  return typeof video.requestPictureInPicture === "function";
}

export function useVideoTransport({
  videoRef,
  file,
  loading = false,
  error = "",
  fullscreenTargetRef,
  preferVideoElementFullscreen = false,
}: UseVideoTransportOptions) {
  const initialPlayback = readVideoPlaybackPreferences();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSegments, setBufferedSegments] = useState<BufferedSegment[]>([]);
  const [volume, setVolumeState] = useState(initialPlayback.volume);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState<VideoPlaybackRate>(
    initialPlayback.playbackRate,
  );
  const [loop, setLoop] = useState(readVideoLoopPreference);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const hideChromeTimerRef = useRef<number | null>(null);
  const wasNativeFullscreenRef = useRef(false);
  const resumeAppliedForFileRef = useRef<string | null>(null);
  const lastResumeWriteRef = useRef(0);

  const isFullscreen = isNativeFullscreen || isImmersive;
  const effectiveVolume = muted ? 0 : volume;

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

  const persistResume = useCallback(
    (force = false) => {
      const video = videoRef.current;
      if (!video || !file.id) return;
      const now = Date.now();
      if (!force && now - lastResumeWriteRef.current < RESUME_SAVE_INTERVAL_MS) return;
      lastResumeWriteRef.current = now;
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      writeVideoResumePosition(file.id, video.currentTime, dur);
    },
    [file.id, videoRef],
  );

  // Human: Reveal chrome on pointer activity over the player shell (including the <video> child).
  // Agent: BINDS capture-phase pointer/mouse listeners on fullscreenTargetRef; FOCUSES shell for keys.
  useEffect(() => {
    const shell = fullscreenTargetRef.current;
    if (!shell) return;
    if (!shell.hasAttribute("tabindex")) {
      shell.tabIndex = -1;
    }

    const onPointerActivity = () => {
      revealChrome();
    };

    // Human: Click/tap steals keyboard focus into the player so Space/j/l shortcuts work.
    // Agent: CALLS shell.focus({ preventScroll }) on pointerdown when target is not an editable control.
    const onPointerDown = (event: PointerEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (document.activeElement === shell) return;
      try {
        shell.focus({ preventScroll: true });
      } catch {
        shell.focus();
      }
    };

    shell.addEventListener("pointermove", onPointerActivity, true);
    shell.addEventListener("pointerenter", onPointerActivity, true);
    shell.addEventListener("mousemove", onPointerActivity, true);
    shell.addEventListener("mouseenter", onPointerActivity, true);
    shell.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      shell.removeEventListener("pointermove", onPointerActivity, true);
      shell.removeEventListener("pointerenter", onPointerActivity, true);
      shell.removeEventListener("mousemove", onPointerActivity, true);
      shell.removeEventListener("mouseenter", onPointerActivity, true);
      shell.removeEventListener("pointerdown", onPointerDown, true);
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

  // Human: Bind transport listeners after the <video> ref is committed (gallery key remounts swap the element).
  // Agent: useLayoutEffect READS videoRef.current; RUNS after ref callback, before parent useEffects.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncProgress = () => {
      setProgress(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setBufferedSegments(readBufferedSegments(video.buffered));
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      persistResume(true);
    };
    const onEnded = () => {
      setIsPlaying(false);
      clearVideoResumePosition(file.id);
    };

    // Human: Continue watching — seek once when metadata is ready for this file.
    // Agent: READS resume map; SEEKS if meaningful; MARKS resumeAppliedForFileRef.
    const applyResume = () => {
      if (resumeAppliedForFileRef.current === file.id) return;
      const saved = readVideoResumePosition(file.id);
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      resumeAppliedForFileRef.current = file.id;
      if (saved == null || dur <= 0) return;
      if (!isMeaningfulResumePosition(saved, dur)) return;
      video.currentTime = saved;
      setProgress(saved);
    };

    const onLoadedMetadata = () => {
      syncProgress();
      applyResume();
    };

    video.addEventListener("timeupdate", syncProgress);
    video.addEventListener("durationchange", syncProgress);
    video.addEventListener("progress", syncProgress);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);

    setPipSupported(isPictureInPictureSupported(video));
    setIsPiP(document.pictureInPictureElement === video);

    // Human: Apply persisted volume/rate as soon as the element is bound.
    // Agent: WRITES video.volume, video.muted, video.playbackRate, video.loop.
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = playbackRate;
    video.loop = loop;

    if (video.readyState >= 1) {
      syncProgress();
      applyResume();
    } else {
      syncProgress();
    }

    return () => {
      video.removeEventListener("timeupdate", syncProgress);
      video.removeEventListener("durationchange", syncProgress);
      video.removeEventListener("progress", syncProgress);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      // Human: Persist playhead when unmounting (gallery advance / close).
      // Agent: CALLS writeVideoResumePosition with currentTime.
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      writeVideoResumePosition(file.id, video.currentTime, dur);
    };
    // volume/muted/rate/loop applied via dedicated effects; only bind listeners on file/ref change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: rebind on file swap only
  }, [videoRef, file.id, persistResume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
  }, [muted, volume, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, videoRef]);

  // Human: Native loop restarts HLS playback at end without firing `ended`.
  // Agent: WRITES video.loop when preference or ref changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.loop = loop;
  }, [loop, videoRef]);

  // Human: Periodically checkpoint resume while playing.
  // Agent: INTERVAL when isPlaying; CALLS persistResume.
  useEffect(() => {
    if (!isPlaying || transportDisabled) return;
    const id = window.setInterval(() => {
      persistResume(false);
    }, RESUME_SAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isPlaying, transportDisabled, persistResume]);

  // Human: Track document PiP enter/leave for the active video element.
  // Agent: LISTENS enterpictureinpicture / leavepictureinpicture on video.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);

    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    setPipSupported(isPictureInPictureSupported(video));
    setIsPiP(document.pictureInPictureElement === video);

    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [videoRef, file.id]);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
    setBufferedSegments([]);
    setShowChrome(true);
    setIsImmersive(false);
    resumeAppliedForFileRef.current = null;
    lastResumeWriteRef.current = 0;
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
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const next = Math.min(Math.max(0, timeSeconds), dur > 0 ? dur : timeSeconds);
      video.currentTime = next;
      setProgress(next);
      revealChrome();
    },
    [revealChrome, transportDisabled, videoRef],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video || transportDisabled) return;
      handleSeek(video.currentTime + deltaSeconds);
    },
    [handleSeek, transportDisabled, videoRef],
  );

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeState(clamped);
      if (clamped > 0) setMuted(false);
      writeVideoPlaybackPreferences({ volume: clamped });
      revealChrome();
    },
    [revealChrome],
  );

  const handleVolumeInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setVolume(Number(event.target.value));
    },
    [setVolume],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
    revealChrome();
  }, [revealChrome]);

  const setPlaybackRate = useCallback(
    (rate: VideoPlaybackRate) => {
      setPlaybackRateState(rate);
      writeVideoPlaybackPreferences({ playbackRate: rate });
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
      revealChrome();
    },
    [revealChrome, videoRef],
  );

  const cyclePlaybackRate = useCallback(
    (direction: "next" | "prev" = "next") => {
      setPlaybackRate(
        direction === "prev"
          ? previousVideoPlaybackRate(playbackRate)
          : nextVideoPlaybackRate(playbackRate),
      );
    },
    [playbackRate, setPlaybackRate],
  );

  // Human: Loop the active clip instead of stopping at the end.
  // Agent: TOGGLES loop state; PERSISTS preference; WRITES video.loop via effect.
  const toggleLoop = useCallback(() => {
    setLoop((prev) => {
      const next = !prev;
      writeVideoLoopPreference(next);
      return next;
    });
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

  // Human: Toggle browser Picture-in-Picture for multitasking while browsing the drive.
  // Agent: CALLS requestPictureInPicture / exitPictureInPicture; NO-OP when unsupported.
  const togglePictureInPicture = useCallback(() => {
    const video = videoRef.current;
    if (!video || transportDisabled || !isPictureInPictureSupported(video)) return;
    revealChrome();
    void (async () => {
      try {
        if (document.pictureInPictureElement === video) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          await video.requestPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } catch {
        // User gesture / policy may reject PiP — leave transport intact.
      }
    })();
  }, [revealChrome, transportDisabled, videoRef]);

  // Human: Keyboard shortcuts while the player shell (or fullscreen) has focus context.
  // Agent: LISTENS keydown on shell + document when fullscreen; IGNORES editable targets.
  // Space/k play · m mute · f fullscreen · p PiP · j/l ±10s · ←/→ ±5s · ↑/↓ volume · < > rate
  useEffect(() => {
    const shell = fullscreenTargetRef.current;
    if (shell && !shell.hasAttribute("tabindex")) {
      shell.tabIndex = -1;
    }

    const isPlayerContext = (event: KeyboardEvent): boolean => {
      if (isFullscreen) return true;
      const targetNode = event.target instanceof Node ? event.target : null;
      if (shell && targetNode && shell.contains(targetNode)) return true;
      if (shell && document.activeElement && shell.contains(document.activeElement)) {
        return true;
      }
      return false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (isEditableKeyboardTarget(event.target)) return;
      if (transportDisabled) return;
      if (!isPlayerContext(event)) return;

      const key = event.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;

      switch (lower) {
        case " ":
        case "k":
          event.preventDefault();
          event.stopPropagation();
          togglePlay();
          break;
        case "m":
          event.preventDefault();
          event.stopPropagation();
          toggleMute();
          break;
        case "f":
          event.preventDefault();
          event.stopPropagation();
          toggleFullscreen();
          break;
        case "p":
          event.preventDefault();
          event.stopPropagation();
          togglePictureInPicture();
          break;
        case "j":
          event.preventDefault();
          event.stopPropagation();
          seekBy(-SEEK_JUMP_SECONDS);
          break;
        case "l":
          event.preventDefault();
          event.stopPropagation();
          seekBy(SEEK_JUMP_SECONDS);
          break;
        case "arrowleft":
          event.preventDefault();
          event.stopPropagation();
          seekBy(-SEEK_STEP_SECONDS);
          break;
        case "arrowright":
          event.preventDefault();
          event.stopPropagation();
          seekBy(SEEK_STEP_SECONDS);
          break;
        case "arrowup":
          event.preventDefault();
          event.stopPropagation();
          setVolume(volume + VOLUME_STEP);
          break;
        case "arrowdown":
          event.preventDefault();
          event.stopPropagation();
          setVolume(volume - VOLUME_STEP);
          break;
        case "<":
        case ",":
          if (event.shiftKey || lower === "<") {
            event.preventDefault();
            event.stopPropagation();
            cyclePlaybackRate("prev");
          }
          break;
        case ">":
        case ".":
          if (event.shiftKey || lower === ">") {
            event.preventDefault();
            event.stopPropagation();
            cyclePlaybackRate("next");
          }
          break;
        default:
          break;
      }
    };

    // Capture on shell so Space works; document capture while fullscreen.
    shell?.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      shell?.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    cyclePlaybackRate,
    fullscreenTargetRef,
    isFullscreen,
    seekBy,
    setVolume,
    toggleFullscreen,
    toggleMute,
    togglePictureInPicture,
    togglePlay,
    transportDisabled,
    volume,
  ]);

  const chromeVisible = showChrome || !isPlaying;

  return {
    isPlaying,
    progress,
    duration,
    bufferedSegments,
    volume,
    effectiveVolume,
    muted,
    playbackRate,
    loop,
    isFullscreen,
    isImmersive,
    isPiP,
    pipSupported,
    transportDisabled,
    failed,
    chromeVisible,
    revealChrome,
    togglePlay,
    handleSeek,
    seekBy,
    setVolume,
    handleVolumeInput,
    toggleMute,
    setPlaybackRate,
    cyclePlaybackRate,
    toggleLoop,
    toggleFullscreen,
    togglePictureInPicture,
  };
}
