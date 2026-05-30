// Human: Desktop vs narrow viewport for which video player component to mount (only one <video>).
// Agent: READS min-width 1024px MQ; Safari defers updates after orientationchange so mount matches viewport.

import { useEffect, useState } from "react";

const DESKTOP_MIN_WIDTH_PX = 1024;

function readIsDesktop(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches;
}

// Human: Mount desktop OR mobile player — never both (shared videoRef).
// Agent: LISTENS matchMedia + resize; Safari gets rAF + timeout after orientationchange.
export function useIsDesktopPlayer(enabled = true): boolean {
  const [isDesktop, setIsDesktop] = useState(readIsDesktop);

  useEffect(() => {
    if (!enabled) return;

    const desktopMq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`);
    let orientationTimer: number | undefined;

    const apply = () => setIsDesktop(desktopMq.matches);

    // Human: Safari iOS reports stale innerWidth until after orientation animation ends.
    // Agent: DOUBLE rAF then optional 150ms timeout before re-reading desktop MQ.
    const applyDeferred = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(apply);
      });
      if (orientationTimer !== undefined) {
        window.clearTimeout(orientationTimer);
      }
      orientationTimer = window.setTimeout(apply, 150);
    };

    desktopMq.addEventListener("change", applyDeferred);
    window.addEventListener("resize", applyDeferred);
    window.addEventListener("orientationchange", applyDeferred);
    window.visualViewport?.addEventListener("resize", applyDeferred);
    apply();

    return () => {
      desktopMq.removeEventListener("change", applyDeferred);
      window.removeEventListener("resize", applyDeferred);
      window.removeEventListener("orientationchange", applyDeferred);
      window.visualViewport?.removeEventListener("resize", applyDeferred);
      if (orientationTimer !== undefined) {
        window.clearTimeout(orientationTimer);
      }
    };
  }, [enabled]);

  return isDesktop;
}
