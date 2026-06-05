// Human: Derive responsive grid column count from a container width (matches auto-fill minmax tiles).
// Agent: READS containerRef via ResizeObserver; RETURNS column count for virtualized explorer rows.

import { useEffect, useState, type RefObject } from "react";

type UseGridColumnCountOptions = {
  minTileWidth?: number;
  gapPx?: number;
};

// Human: Match DriveCloudExplorer tile grid — minmax(140px, 1fr) with gap-3/gap-4.
// Agent: USED by VirtualizedExplorerGrid to pack folder/file entries into virtual rows.
export function useGridColumnCount(
  containerRef: RefObject<HTMLElement | null>,
  { minTileWidth = 140, gapPx = 16 }: UseGridColumnCountOptions = {},
) {
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateColumnCount = () => {
      const width = element.clientWidth;
      if (width <= 0) return;
      const next = Math.max(1, Math.floor((width + gapPx) / (minTileWidth + gapPx)));
      setColumnCount((current) => (current === next ? current : next));
    };

    updateColumnCount();
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, gapPx, minTileWidth]);

  return columnCount;
}
