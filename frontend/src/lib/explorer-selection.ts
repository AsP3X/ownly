// Human: Range and marquee maths for explorer multi-select — no DOM, no React.
// Agent: PURE; the explorer owns the DOM rects and the selection Sets.

/** Human: One selectable entry in the explorer listing, in the order it is rendered. */
export type ExplorerEntryRef = {
  kind: "file" | "folder";
  id: string;
};

/** Human: Stable key for an entry — files and folders can share an id space safely. */
export function entryRefKey(ref: ExplorerEntryRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Human: Every entry between the anchor and the clicked entry, inclusive, in listing order.
 * Agent: RETURNS [] when either end is missing (a stale anchor after the listing changed).
 */
export function sliceEntryRange(
  order: readonly ExplorerEntryRef[],
  anchorKey: string,
  targetKey: string,
): ExplorerEntryRef[] {
  const anchorIndex = order.findIndex((ref) => entryRefKey(ref) === anchorKey);
  const targetIndex = order.findIndex((ref) => entryRefKey(ref) === targetKey);
  if (anchorIndex < 0 || targetIndex < 0) return [];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return order.slice(start, end + 1);
}

// Human: Split refs into the two id lists the explorer keeps selection in.
export function splitEntryRefs(refs: readonly ExplorerEntryRef[]): {
  fileIds: string[];
  folderIds: string[];
} {
  const fileIds: string[] = [];
  const folderIds: string[] = [];
  for (const ref of refs) {
    if (ref.kind === "file") fileIds.push(ref.id);
    else folderIds.push(ref.id);
  }
  return { fileIds, folderIds };
}

/** Human: A box in container-local pixels — stable while the page scrolls under it. */
export type MarqueeBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// Human: Build the drawn box from the drag origin and the pointer, in any direction.
export function marqueeBoxFromPoints(
  origin: { x: number; y: number },
  current: { x: number; y: number },
): MarqueeBox {
  return {
    left: Math.min(origin.x, current.x),
    top: Math.min(origin.y, current.y),
    width: Math.abs(current.x - origin.x),
    height: Math.abs(current.y - origin.y),
  };
}

// Human: True when a tile overlaps the marquee — touching edges alone does not count.
export function marqueeIntersects(box: MarqueeBox, entry: MarqueeBox): boolean {
  return (
    box.left < entry.left + entry.width &&
    box.left + box.width > entry.left &&
    box.top < entry.top + entry.height &&
    box.top + box.height > entry.top
  );
}

/** Human: Below this the gesture is a click, not a drag — keeps stray 1px moves from selecting. */
export const MARQUEE_DRAG_THRESHOLD_PX = 4;

// Human: Has the pointer moved far enough to mean "sweep a selection" rather than "click"?
export function exceedsDragThreshold(
  origin: { x: number; y: number },
  current: { x: number; y: number },
  threshold: number = MARQUEE_DRAG_THRESHOLD_PX,
): boolean {
  return Math.abs(current.x - origin.x) >= threshold || Math.abs(current.y - origin.y) >= threshold;
}
