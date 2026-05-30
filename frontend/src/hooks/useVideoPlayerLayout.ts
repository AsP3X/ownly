// Human: Pick desktop vs mobile portrait/landscape chrome for the video preview dialog.
// Agent: READS viewport size + orientation; LISTENS resize/orientationchange/visualViewport for rotation.

import { useEffect, useState } from "react";

export type VideoPlayerLayout = "desktop" | "mobile-portrait" | "mobile-landscape";

const DESKTOP_MIN_WIDTH_PX = 1024;

// Human: Mobile landscape when width exceeds height — more reliable than orientation MQ alone on rotate.
// Agent: RETURNS false on desktop breakpoints regardless of orientation media query lag.
function isMobileLandscapeViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches) return false;
  if (window.innerWidth > window.innerHeight) return true;
  return window.matchMedia("(orientation: landscape)").matches;
}

function resolveLayout(): VideoPlayerLayout {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches) return "desktop";
  if (isMobileLandscapeViewport()) return "mobile-landscape";
  return "mobile-portrait";
}

export function useVideoPlayerLayout(enabled = true): VideoPlayerLayout {
  const [layout, setLayout] = useState<VideoPlayerLayout>(resolveLayout);

  useEffect(() => {
    if (!enabled) return;

    const update = () => setLayout(resolveLayout());

    const desktopMq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`);
    const landscapeMq = window.matchMedia("(orientation: landscape)");

    desktopMq.addEventListener("change", update);
    landscapeMq.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    update();

    return () => {
      desktopMq.removeEventListener("change", update);
      landscapeMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [enabled]);

  return layout;
}
