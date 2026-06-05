// Human: Defer explorer tile work until the tile is near the scroll container viewport.
// Agent: IntersectionObserver with ExplorerScrollContext root; RETURNS visible flag once intersecting.

import { useEffect, useState, type RefObject } from "react";
import { useExplorerScrollRoot } from "@/hooks/useExplorerScrollRoot";

// Human: Shared visibility gate for grid thumbnails — avoids fetch/render for off-screen tiles.
// Agent: READS scrollElementRef from context; WRITES visible true once; DISCONNECTS observer.
export function useExplorerTileVisible(containerRef: RefObject<HTMLElement | null>) {
  const scrollRootRef = useExplorerScrollRoot();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      {
        root: scrollRootRef?.current ?? null,
        rootMargin: "240px",
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, scrollRootRef]);

  return visible;
}
