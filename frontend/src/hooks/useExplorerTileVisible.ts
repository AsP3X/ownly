// Human: Track whether a grid tile intersects the explorer scroll pane — toggles on and off while scrolling.
// Agent: IntersectionObserver root = mainScrollRef; UNLOAD previews when false to drop decoded bitmaps.

import { useEffect, useState, type RefObject } from "react";
import { useExplorerScrollRoot } from "@/hooks/useExplorerScrollRoot";

// Human: Tight margin — only load previews for tiles actually near the viewport, not hundreds ahead.
// Agent: 48px rootMargin balances prefetch vs keeping too many decoded images alive during scroll.
const EXPLORER_TILE_ROOT_MARGIN = "48px";

// Human: Bidirectional visibility for explorer tiles (load on enter, unload on leave).
// Agent: READS scrollElementRef from context; RETURNS inView boolean updated on each intersection change.
export function useExplorerTileVisible(containerRef: RefObject<HTMLElement | null>) {
  const scrollRootRef = useExplorerScrollRoot();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting ?? false);
      },
      {
        root: scrollRootRef?.current ?? null,
        rootMargin: EXPLORER_TILE_ROOT_MARGIN,
        threshold: 0,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, scrollRootRef]);

  return visible;
}
