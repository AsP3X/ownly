// Human: Pick desktop vs mobile portrait/landscape chrome for the video preview dialog.
// Agent: READS matchMedia (min-width 1024px, orientation); RETURNS layout id for player surface.

import { useEffect, useState } from "react";

export type VideoPlayerLayout = "desktop" | "mobile-portrait" | "mobile-landscape";

// Human: lg matches drive shell — below 1024px uses Pencil mobile video frames.
// Agent: ORIENTATION landscape on narrow viewports maps to Mobile Landscape wireframe.
function resolveLayout(): VideoPlayerLayout {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(min-width: 1024px)").matches) return "desktop";
  if (window.matchMedia("(orientation: landscape)").matches) return "mobile-landscape";
  return "mobile-portrait";
}

export function useVideoPlayerLayout(): VideoPlayerLayout {
  const [layout, setLayout] = useState<VideoPlayerLayout>(resolveLayout);

  useEffect(() => {
    const desktopMq = window.matchMedia("(min-width: 1024px)");
    const landscapeMq = window.matchMedia("(orientation: landscape)");

    const update = () => setLayout(resolveLayout());

    desktopMq.addEventListener("change", update);
    landscapeMq.addEventListener("change", update);
    update();

    return () => {
      desktopMq.removeEventListener("change", update);
      landscapeMq.removeEventListener("change", update);
    };
  }, []);

  return layout;
}
