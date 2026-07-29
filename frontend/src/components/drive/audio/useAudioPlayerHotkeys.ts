// Human: Shared keyboard shortcuts for desktop and focused mobile audio players.
// Agent: LISTENS document keydown while enabled; IGNORES typing targets and composition.

import { useEffect } from "react";
import { AUDIO_SKIP_SECONDS } from "@/components/drive/audio/useAudioTransport";

type UseAudioPlayerHotkeysOptions = {
  enabled: boolean;
  transportDisabled: boolean;
  togglePlay: () => void;
  toggleMute: () => void;
  toggleRepeat: () => void;
  skipBy: (deltaSeconds: number) => void;
  handleSeek: (timeSeconds: number) => void;
  adjustVolume: (delta: number) => void;
  duration: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
};

// Human: Skip hotkeys when the user is typing in an input, textarea, or contenteditable.
// Agent: READS event.target tagName + isContentEditable.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

// Human: Space play/pause, M mute, J/L seek, arrows for tracks or seek, R repeat, Home/End.
// Agent: CAPTURE-phase document listener while enabled so dialog traps do not swallow keys first.
export function useAudioPlayerHotkeys({
  enabled,
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
}: UseAudioPlayerHotkeysOptions) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key;

      if (key === " " || key === "Spacebar") {
        if (transportDisabled) return;
        event.preventDefault();
        event.stopPropagation();
        togglePlay();
        return;
      }

      if (key === "m" || key === "M") {
        event.preventDefault();
        event.stopPropagation();
        toggleMute();
        return;
      }

      if (key === "r" || key === "R") {
        event.preventDefault();
        event.stopPropagation();
        toggleRepeat();
        return;
      }

      if (key === "j" || key === "J") {
        if (transportDisabled) return;
        event.preventDefault();
        event.stopPropagation();
        skipBy(-AUDIO_SKIP_SECONDS);
        return;
      }

      if (key === "l" || key === "L") {
        if (transportDisabled) return;
        event.preventDefault();
        event.stopPropagation();
        skipBy(AUDIO_SKIP_SECONDS);
        return;
      }

      if (key === "Home") {
        if (transportDisabled) return;
        event.preventDefault();
        event.stopPropagation();
        handleSeek(0);
        return;
      }

      if (key === "End") {
        if (transportDisabled || duration <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        handleSeek(duration);
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        adjustVolume(0.05);
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        adjustVolume(-0.05);
        return;
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey || !hasPrevious) {
          if (!transportDisabled) skipBy(event.shiftKey ? -AUDIO_SKIP_SECONDS : -5);
        } else {
          onPrevious?.();
        }
        return;
      }

      if (key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey || !hasNext) {
          if (!transportDisabled) skipBy(event.shiftKey ? AUDIO_SKIP_SECONDS : 5);
        } else {
          onNext?.();
        }
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    enabled,
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
  ]);
}
