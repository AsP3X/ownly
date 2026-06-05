// Human: Track explorer tile visibility phase for prioritized thumbnail loading.
// Agent: IntersectionObserver on scroll root; RETURNS off | near | on for queue priority.

import { useEffect, useState, type RefObject } from "react";
import { useExplorerScrollRoot } from "@/hooks/useExplorerScrollRoot";
import type { ExplorerThumbnailPriority } from "@/lib/explorer-thumbnail-queue";

// Human: Wider band so near-phase prefetch fills the LRU before tiles enter the viewport.
// Agent: INCREASED margin; MORE tiles load into cache during fast scroll.
const EXPLORER_TILE_ROOT_MARGIN = "280px 0px";
const EXPLORER_TILE_HIDE_DEBOUNCE_MS = 180;

export type ExplorerTilePhase = "off" | "near" | "on";

// Human: Map visibility phase to thumbnail queue priority — null when tile should unload.
// Agent: on => high; near => low prefetch; off => cancel loads.
export function thumbnailPriorityForPhase(
  phase: ExplorerTilePhase,
): ExplorerThumbnailPriority | null {
  if (phase === "off") return null;
  if (phase === "on") return "high";
  return "low";
}

// Human: Bidirectional visibility with debounced hide so quick scroll does not strand tiles off.
// Agent: READS scroll root inside effect; DEBOUNCES off; IMMEDIATE on/near when intersecting.
export function useExplorerTileVisible(containerRef: RefObject<HTMLElement | null>) {
  const scrollRootRef = useExplorerScrollRoot();
  const [phase, setPhase] = useState<ExplorerTilePhase>("off");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let hideTimer: number | null = null;
    let observer: IntersectionObserver | null = null;
    let rafId = 0;

    const attachObserver = () => {
      observer?.disconnect();
      const scrollRoot = scrollRootRef?.current ?? null;

      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;

          if (entry.isIntersecting) {
            if (hideTimer !== null) {
              window.clearTimeout(hideTimer);
              hideTimer = null;
            }
            setPhase(entry.intersectionRatio >= 0.12 ? "on" : "near");
            return;
          }

          if (hideTimer !== null) {
            window.clearTimeout(hideTimer);
          }
          hideTimer = window.setTimeout(() => {
            hideTimer = null;
            setPhase("off");
          }, EXPLORER_TILE_HIDE_DEBOUNCE_MS);
        },
        {
          root: scrollRoot,
          rootMargin: EXPLORER_TILE_ROOT_MARGIN,
          threshold: [0, 0.01, 0.12, 0.5],
        },
      );

      observer.observe(element);
    };

    attachObserver();
    if (!scrollRootRef?.current) {
      rafId = window.requestAnimationFrame(attachObserver);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }
      observer?.disconnect();
    };
  }, [containerRef, scrollRootRef]);

  return phase;
}
