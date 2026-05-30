// Human: Safari iOS often keeps orientation:portrait in modals — drive layout from viewport aspect instead.
// Agent: WRITES data-video-layout on target; READS visualViewport/innerWidth; LISTENS orientationchange + resize.

import { useLayoutEffect, useState, type RefObject } from "react";

export type NarrowVideoLayout = "portrait" | "landscape";

// Human: Landscape when layout viewport is wider than tall — innerWidth/Height (not visualViewport alone).
// Agent: visualViewport can skew aspect inside Safari modals; screen.orientation is tie-breaker only.
export function readNarrowVideoLayout(): NarrowVideoLayout {
  if (typeof window === "undefined") return "portrait";

  const width = window.innerWidth;
  const height = window.innerHeight;

  if (width > height) return "landscape";
  if (height > width) return "portrait";

  const orientationType = window.screen?.orientation?.type ?? "";
  if (orientationType.startsWith("landscape")) return "landscape";

  return "portrait";
}

// Human: Sync data-video-layout on the dialog viewport for video-* Tailwind variants (Safari rotation).
// Agent: RETURNS layout state for React; useLayoutEffect WRITES dataset on targetRef; deferred apply on rotate.
export function useNarrowVideoLayout(
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): NarrowVideoLayout {
  const [layout, setLayout] = useState<NarrowVideoLayout>(() =>
    enabled ? readNarrowVideoLayout() : "portrait",
  );

  useLayoutEffect(() => {
    if (!enabled) {
      setLayout("portrait");
      const el = targetRef.current;
      if (el) delete el.dataset.videoLayout;
      return;
    }

    let orientationTimer: number | undefined;

    const apply = () => {
      const next = readNarrowVideoLayout();
      setLayout(next);
      const node = targetRef.current;
      if (node) node.dataset.videoLayout = next;
    };

    const applyDeferred = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(apply);
      });
      if (orientationTimer !== undefined) {
        window.clearTimeout(orientationTimer);
      }
      orientationTimer = window.setTimeout(apply, 200);
    };

    apply();

    window.addEventListener("resize", applyDeferred);
    window.addEventListener("orientationchange", applyDeferred);
    window.visualViewport?.addEventListener("resize", applyDeferred);
    window.visualViewport?.addEventListener("scroll", applyDeferred);
    window.screen.orientation?.addEventListener("change", applyDeferred);

    return () => {
      window.removeEventListener("resize", applyDeferred);
      window.removeEventListener("orientationchange", applyDeferred);
      window.visualViewport?.removeEventListener("resize", applyDeferred);
      window.visualViewport?.removeEventListener("scroll", applyDeferred);
      window.screen.orientation?.removeEventListener("change", applyDeferred);
      if (orientationTimer !== undefined) {
        window.clearTimeout(orientationTimer);
      }
      const el = targetRef.current;
      if (el) delete el.dataset.videoLayout;
    };
  }, [enabled, targetRef]);

  return layout;
}
