// Human: Track explorer tile visibility phase for prioritized thumbnail loading.
// Agent: IntersectionObserver on scroll root; RETURNS off | near | on for queue priority.

import { useEffect, useState, type RefObject } from "react";
import { useExplorerScrollRoot } from "@/hooks/useExplorerScrollRoot";
import type { ExplorerThumbnailPriority } from "@/lib/explorer-thumbnail-queue";

const EXPLORER_TILE_ROOT_MARGIN = "48px";

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

// Human: Bidirectional visibility with coarse priority bands for the thumbnail loader.
// Agent: READS scrollElementRef; WRITES phase from intersection ratio thresholds.
export function useExplorerTileVisible(containerRef: RefObject<HTMLElement | null>) {
  const scrollRootRef = useExplorerScrollRoot();
  const [phase, setPhase] = useState<ExplorerTilePhase>("off");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          setPhase("off");
          return;
        }
        setPhase(entry.intersectionRatio >= 0.2 ? "on" : "near");
      },
      {
        root: scrollRootRef?.current ?? null,
        rootMargin: EXPLORER_TILE_ROOT_MARGIN,
        threshold: [0, 0.2, 0.6],
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, scrollRootRef]);

  return phase;
}
