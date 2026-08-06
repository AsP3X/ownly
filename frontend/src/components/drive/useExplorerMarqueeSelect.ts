// Human: Rubber-band selection — drag across empty space in the explorer to sweep up entries.
// Agent: MOUSE ONLY (touch keeps scrolling); NEVER starts on a tile, so file drag-to-move is untouched.

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  exceedsDragThreshold,
  entryRefKey,
  marqueeBoxFromPoints,
  marqueeIntersects,
  type ExplorerEntryRef,
  type MarqueeBox,
} from "@/lib/explorer-selection";

type CachedEntry = {
  ref: ExplorerEntryRef;
  box: MarqueeBox;
};

type UseExplorerMarqueeSelectOptions = {
  /** Human: Off while loading, on touch layouts, and whenever selection itself is disabled. */
  enabled: boolean;
  /** Human: Element the marquee is drawn inside; also the hit-test scope. */
  containerRef: RefObject<HTMLElement | null>;
  /** Human: Called once per drag before the first selection update, to snapshot what was selected. */
  onMarqueeStart: () => void;
  /**
   * Human: The selection should now be these refs, plus whatever was selected at drag start
   * when `additive`.
   * Agent: CALLED only when the covered set actually changes, not on every pointer move.
   */
  onMarqueeSelect: (refs: ExplorerEntryRef[], additive: boolean) => void;
  /** Human: A plain click on empty space clears the selection, as in any file manager. */
  onClearSelection: () => void;
};

/** Human: Read the entry a DOM node belongs to, if any. */
export function entryRefFromNode(node: Element | null): ExplorerEntryRef | null {
  const entry = node?.closest<HTMLElement>("[data-explorer-entry]");
  if (!entry) return null;
  const fileId = entry.dataset.fileId;
  if (fileId) return { kind: "file", id: fileId };
  const folderId = entry.dataset.folderId;
  if (folderId) return { kind: "folder", id: folderId };
  return null;
}

export function useExplorerMarqueeSelect({
  enabled,
  containerRef,
  onMarqueeStart,
  onMarqueeSelect,
  onClearSelection,
}: UseExplorerMarqueeSelectOptions) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const additiveRef = useRef(false);
  const entriesRef = useRef<CachedEntry[]>([]);
  const coveredKeyRef = useRef("");

  // Human: Container-local coordinates stay put while the pane scrolls under the pointer.
  const toLocalPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef],
  );

  const paintOverlay = useCallback((box: MarqueeBox | null) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!box) {
      overlay.style.display = "none";
      return;
    }
    overlay.style.display = "block";
    overlay.style.transform = `translate(${box.left}px, ${box.top}px)`;
    overlay.style.width = `${box.width}px`;
    overlay.style.height = `${box.height}px`;
  }, []);

  const endDrag = useCallback(() => {
    originRef.current = null;
    draggingRef.current = false;
    entriesRef.current = [];
    coveredKeyRef.current = "";
    paintOverlay(null);
  }, [paintOverlay]);

  /**
   * Human: Snapshot every tile's box once per drag — they cannot move while the pointer is down,
   * so each move only has to compare numbers.
   * Agent: LOCAL coordinates, matching the drag origin, so scrolling mid-drag stays consistent.
   */
  const cacheEntryBoxes = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const nodes = container.querySelectorAll<HTMLElement>("[data-explorer-entry]");
    const cached: CachedEntry[] = [];
    for (const node of nodes) {
      const ref = entryRefFromNode(node);
      if (!ref) continue;
      const rect = node.getBoundingClientRect();
      cached.push({
        ref,
        box: {
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    }
    entriesRef.current = cached;
  }, [containerRef]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Human: Touch and pen keep their existing meaning — scrolling and long-press drag.
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Human: Starting on a tile means "drag this file"; on a control it means "press it".
      if (target.closest("[data-explorer-entry]")) return;
      if (target.closest("button, a, input, select, textarea, label")) return;

      originRef.current = toLocalPoint(event.clientX, event.clientY);
      draggingRef.current = false;
      additiveRef.current = event.shiftKey || event.metaKey || event.ctrlKey;
      coveredKeyRef.current = "";
    },
    [enabled, toLocalPoint],
  );

  // Human: Move/up live on the window so a drag that leaves the pane still finishes cleanly.
  // Agent: BOUND only while a drag origin exists; Escape cancels back to the drag-start selection.
  useEffect(() => {
    if (!enabled) return;

    function handlePointerMove(event: globalThis.PointerEvent) {
      const origin = originRef.current;
      if (!origin) return;
      const current = toLocalPoint(event.clientX, event.clientY);

      if (!draggingRef.current) {
        if (!exceedsDragThreshold(origin, current)) return;
        draggingRef.current = true;
        onMarqueeStart();
        cacheEntryBoxes();
      }

      // Human: Without this the browser starts selecting the page text under the sweep.
      event.preventDefault();
      const box = marqueeBoxFromPoints(origin, current);
      paintOverlay(box);

      const covered = entriesRef.current
        .filter((entry) => marqueeIntersects(box, entry.box))
        .map((entry) => entry.ref);
      const coveredKey = covered.map(entryRefKey).join("|");
      if (coveredKey === coveredKeyRef.current) return;
      coveredKeyRef.current = coveredKey;
      onMarqueeSelect(covered, additiveRef.current);
    }

    function handlePointerUp() {
      if (originRef.current && !draggingRef.current && !additiveRef.current) {
        // Human: A plain click on empty space means "deselect everything".
        onClearSelection();
      }
      endDrag();
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || !draggingRef.current) return;
      onMarqueeSelect([], additiveRef.current);
      endDrag();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    cacheEntryBoxes,
    enabled,
    endDrag,
    onClearSelection,
    onMarqueeSelect,
    onMarqueeStart,
    paintOverlay,
    toLocalPoint,
  ]);

  return { overlayRef, handlePointerDown };
}
