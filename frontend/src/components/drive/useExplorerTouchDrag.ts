// Human: Touch drag-and-drop for the mobile explorer — long-press a file, drag onto a folder tile.
// Agent: READS pointer events on file tiles; WRITES ghost + drop highlight; CALLS onMoveFileToFolder on drop.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const DESKTOP_MIN_WIDTH_PX = 1024;
const LONG_PRESS_MS = 400;
/** Human: Finger movement before long-press arms — treat as list scroll, not drag. */
const SCROLL_CANCEL_PX = 12;
const DRAG_START_PX = 8;
const AUTO_SCROLL_EDGE_PX = 72;
const AUTO_SCROLL_MAX_SPEED = 18;

type GhostPosition = { x: number; y: number };

type UseExplorerTouchDragOptions = {
  enabled: boolean;
  scrollElementRef?: RefObject<HTMLElement | null>;
  onMoveFileToFolder?: (fileId: string, folderId: string) => void | Promise<void>;
  resolveFileFolderId: (fileId: string) => string | null | undefined;
  /** Human: Notifies parent when a touch drag ghost is active — used to dismiss the context menu. */
  onDragSessionActiveChange?: (active: boolean) => void;
  /** Human: Locks the explorer scroll pane while long-press drag is armed or moving. */
  onTouchScrollLockChange?: (locked: boolean) => void;
};

export type ExplorerTouchDragBindings = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Human: Call from onClick — returns true when the tap should not open a preview. */
  consumeSuppressedClick: () => boolean;
};

function readIsDesktopViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches;
}

// Human: Walk the hit stack for a folder tile — ignores the floating drag ghost.
// Agent: READS data-folder-id from closest ancestor; RETURNS folder id or null.
function findFolderDropTarget(clientX: number, clientY: number): string | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const element of stack) {
    if (element.closest("[data-explorer-touch-drag-ghost]")) continue;
    // Human: Skip open context menu popups so folder tiles underneath stay droppable.
    // Agent: READS data-slot=context-menu-content; CONTINUES when menu layer is in hit stack.
    if (element.closest('[data-slot="context-menu-content"]')) continue;
    const folderNode = element.closest<HTMLElement>("[data-folder-id]");
    if (folderNode?.dataset.folderId) {
      return folderNode.dataset.folderId;
    }
  }
  return null;
}

// Human: Nudge the explorer scroll root when the ghost nears the top or bottom edge.
// Agent: READS scrollElementRef + pointer Y; WRITES scrollTop on the scroll container.
function autoScrollNearEdges(
  clientY: number,
  scrollRoot: HTMLElement | null,
): void {
  if (!scrollRoot) return;
  const rect = scrollRoot.getBoundingClientRect();
  const distanceFromTop = clientY - rect.top;
  const distanceFromBottom = rect.bottom - clientY;

  if (distanceFromTop < AUTO_SCROLL_EDGE_PX) {
    const intensity = 1 - Math.max(0, distanceFromTop) / AUTO_SCROLL_EDGE_PX;
    scrollRoot.scrollTop -= Math.ceil(AUTO_SCROLL_MAX_SPEED * intensity);
  } else if (distanceFromBottom < AUTO_SCROLL_EDGE_PX) {
    const intensity = 1 - Math.max(0, distanceFromBottom) / AUTO_SCROLL_EDGE_PX;
    scrollRoot.scrollTop += Math.ceil(AUTO_SCROLL_MAX_SPEED * intensity);
  }
}

export function useExplorerTouchDrag({
  enabled,
  scrollElementRef,
  onMoveFileToFolder,
  resolveFileFolderId,
  onDragSessionActiveChange,
  onTouchScrollLockChange,
}: UseExplorerTouchDragOptions) {
  const [isDesktopViewport, setIsDesktopViewport] = useState(readIsDesktopViewport);
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [armedFileId, setArmedFileId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [ghostLabel, setGhostLabel] = useState<string | null>(null);
  const [ghostPosition, setGhostPosition] = useState<GhostPosition | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const draggingRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const autoScrollFrameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<GhostPosition | null>(null);
  const sessionFileIdRef = useRef<string | null>(null);
  const sessionFileNameRef = useRef<string>("");
  const dropTargetFolderIdRef = useRef<string | null>(null);
  const dragAnchorRef = useRef<GhostPosition | null>(null);
  const touchScrollLockedRef = useRef(false);
  const pointerDownAtRef = useRef(0);
  const gestureScrollBlockedRef = useRef(false);
  const gestureScrollHandlerRef = useRef<((event: Event) => void) | null>(null);
  const sessionElementRef = useRef<HTMLElement | null>(null);
  const pendingPointerMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);

  const touchDragEnabled =
    enabled && !isDesktopViewport && onMoveFileToFolder !== undefined;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const stopAutoScrollLoop = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const setTouchScrollLocked = useCallback(
    (locked: boolean) => {
      if (touchScrollLockedRef.current === locked) return;
      touchScrollLockedRef.current = locked;
      onTouchScrollLockChange?.(locked);
    },
    [onTouchScrollLockChange],
  );

  // Human: Block native list scrolling for the active touch session — registered synchronously on pointerdown.
  // Agent: LISTENS document touchmove capture passive:false; REMOVED in resetSession.
  const blockGestureScroll = useCallback(() => {
    if (gestureScrollBlockedRef.current) return;
    gestureScrollBlockedRef.current = true;

    const preventGestureScroll = (event: Event) => {
      if (!sessionFileIdRef.current) return;
      if (event instanceof TouchEvent) {
        if (event.touches.length !== 1) return;
        event.preventDefault();
        return;
      }
      if (event instanceof PointerEvent && activePointerIdRef.current !== null) {
        if (event.pointerId !== activePointerIdRef.current) return;
        event.preventDefault();
      }
    };

    document.addEventListener("touchmove", preventGestureScroll, { capture: true, passive: false });
    document.addEventListener("pointermove", preventGestureScroll, { capture: true });
    // Human: Store handler on ref so unblock removes the same function reference.
    // Agent: WRITES closure to gestureScrollHandlerRef for teardown in unblockGestureScroll.
    gestureScrollHandlerRef.current = preventGestureScroll;
  }, []);

  const unblockGestureScroll = useCallback(() => {
    const handler = gestureScrollHandlerRef.current;
    if (!handler) return;
    document.removeEventListener("touchmove", handler, { capture: true });
    document.removeEventListener("pointermove", handler, { capture: true });
    gestureScrollHandlerRef.current = null;
    gestureScrollBlockedRef.current = false;
  }, []);

  // Human: Stop tracking finger movement once the user scrolls or the session ends.
  // Agent: REMOVES document pointermove listener registered during pending long-press.
  const clearPendingPointerTracking = useCallback(() => {
    const handler = pendingPointerMoveHandlerRef.current;
    if (!handler) return;
    document.removeEventListener("pointermove", handler, { capture: true });
    pendingPointerMoveHandlerRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    const wasDragging = draggingRef.current;
    clearLongPressTimer();
    stopAutoScrollLoop();
    activePointerIdRef.current = null;
    pointerStartRef.current = null;
    armedRef.current = false;
    draggingRef.current = false;
    sessionFileIdRef.current = null;
    sessionFileNameRef.current = "";
    lastPointerRef.current = null;
    dragAnchorRef.current = null;
    pointerDownAtRef.current = 0;
    sessionElementRef.current = null;
    clearPendingPointerTracking();
    unblockGestureScroll();
    setTouchScrollLocked(false);
    setArmedFileId(null);
    setDraggingFileId(null);
    dropTargetFolderIdRef.current = null;
    setDropTargetFolderId(null);
    setGhostLabel(null);
    setGhostPosition(null);
    document.body.style.removeProperty("touch-action");
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("-webkit-user-select");
    if (wasDragging) {
      onDragSessionActiveChange?.(false);
    }
  }, [
    clearLongPressTimer,
    onDragSessionActiveChange,
    setTouchScrollLocked,
    clearPendingPointerTracking,
    stopAutoScrollLoop,
    unblockGestureScroll,
  ]);

  const beginActiveDrag = useCallback(
    (clientX: number, clientY: number) => {
      const fileId = sessionFileIdRef.current;
      if (!fileId || draggingRef.current) return;

      draggingRef.current = true;
      suppressNextClickRef.current = true;
      setDraggingFileId(fileId);
      setGhostLabel(sessionFileNameRef.current);
      const position = { x: clientX, y: clientY };
      lastPointerRef.current = position;
      setGhostPosition(position);
      document.body.style.touchAction = "none";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      onDragSessionActiveChange?.(true);
    },
    [onDragSessionActiveChange],
  );

  const updateDragAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!draggingRef.current) return;

      const position = { x: clientX, y: clientY };
      lastPointerRef.current = position;
      setGhostPosition(position);

      const folderId = findFolderDropTarget(clientX, clientY);
      const fileId = sessionFileIdRef.current;
      const fileFolderId = fileId ? resolveFileFolderId(fileId) : null;
      const isValidTarget =
        folderId !== null && fileId !== null && fileFolderId !== folderId;

      const nextTarget = isValidTarget ? folderId : null;
      dropTargetFolderIdRef.current = nextTarget;
      setDropTargetFolderId(nextTarget);
    },
    [resolveFileFolderId],
  );

  const startAutoScrollLoop = useCallback(() => {
    stopAutoScrollLoop();

    const tick = () => {
      if (!draggingRef.current) return;
      const pointer = lastPointerRef.current;
      if (pointer) {
        autoScrollNearEdges(pointer.y, scrollElementRef?.current ?? null);
        updateDragAt(pointer.x, pointer.y);
      }
      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
  }, [scrollElementRef, stopAutoScrollLoop, updateDragAt]);

  const armDragSession = useCallback(
    (anchor: GhostPosition) => {
      if (!sessionFileIdRef.current) return;
      armedRef.current = true;
      dragAnchorRef.current = anchor;
      setArmedFileId(sessionFileIdRef.current);
      const element = sessionElementRef.current;
      const pointerId = activePointerIdRef.current;
      if (element && pointerId !== null && !element.hasPointerCapture(pointerId)) {
        element.setPointerCapture(pointerId);
      }
    },
    [],
  );

  // Human: Abort a pending long-press when the finger moves like a scroll gesture.
  // Agent: READS pointer delta from pointerStartRef; CALLS resetSession when > SCROLL_CANCEL_PX.
  const cancelPendingSessionIfScrolling = useCallback(
    (clientX: number, clientY: number) => {
      if (armedRef.current || draggingRef.current) return false;
      const start = pointerStartRef.current;
      if (!start || !sessionFileIdRef.current) return false;
      const distance = Math.hypot(clientX - start.x, clientY - start.y);
      if (distance <= SCROLL_CANCEL_PX) return false;
      resetSession();
      return true;
    },
    [resetSession],
  );

  const completeDrag = useCallback(() => {
    const fileId = sessionFileIdRef.current;
    const folderId = dropTargetFolderIdRef.current;
    const shouldMove =
      draggingRef.current &&
      fileId !== null &&
      folderId !== null &&
      resolveFileFolderId(fileId) !== folderId;

    resetSession();

    if (shouldMove && fileId && folderId) {
      void onMoveFileToFolder?.(fileId, folderId);
    }
  }, [onMoveFileToFolder, resetSession, resolveFileFolderId]);

  // Human: Track lg breakpoint so touch drag stays off on desktop (HTML5 drag handles that path).
  // Agent: LISTENS matchMedia change; WRITES isDesktopViewport; RESETS drag when crossing to desktop.
  useEffect(() => {
    const desktopMq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`);
    const apply = () => {
      const isDesktop = desktopMq.matches;
      setIsDesktopViewport(isDesktop);
      if (isDesktop) {
        resetSession();
      }
    };
    desktopMq.addEventListener("change", apply);
    apply();
    return () => desktopMq.removeEventListener("change", apply);
  }, [resetSession]);

  // Human: Block long-press context menu while the touch drag ghost is on screen.
  // Agent: LISTENS contextmenu capture; preventDefault only while draggingFileId is set.
  useEffect(() => {
    if (!draggingFileId) return;

    const preventContextMenu = (event: Event) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", preventContextMenu, { capture: true });
    return () => document.removeEventListener("contextmenu", preventContextMenu, { capture: true });
  }, [draggingFileId]);

  // Human: Clear any in-flight drag when the explorer unmounts.
  // Agent: CALLS resetSession on unmount only — live pointer handlers gate on touchDragEnabled.
  useEffect(() => () => resetSession(), [resetSession]);

  const getFileDragBindings = useCallback(
    (fileId: string, fileName: string): ExplorerTouchDragBindings => ({
      onPointerDown: (event) => {
        if (!touchDragEnabled || event.button !== 0) return;
        if (!event.isPrimary) return;

        clearLongPressTimer();
        clearPendingPointerTracking();
        activePointerIdRef.current = event.pointerId;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        sessionFileIdRef.current = fileId;
        sessionFileNameRef.current = fileName;
        sessionElementRef.current = event.currentTarget;
        suppressNextClickRef.current = false;
        armedRef.current = false;
        draggingRef.current = false;
        setArmedFileId(null);
        setDraggingFileId(null);
        setDropTargetFolderId(null);
        setGhostLabel(null);
        setGhostPosition(null);

        pointerDownAtRef.current = Date.now();
        lastPointerRef.current = { x: event.clientX, y: event.clientY };

        // Human: Track movement at document level — finger can leave the tile while scrolling.
        // Agent: LISTENS pointermove capture; CALLS cancelPendingSessionIfScrolling before drag arms.
        const onPendingPointerMove = (moveEvent: PointerEvent) => {
          if (activePointerIdRef.current !== moveEvent.pointerId) return;
          lastPointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
          cancelPendingSessionIfScrolling(moveEvent.clientX, moveEvent.clientY);
        };
        pendingPointerMoveHandlerRef.current = onPendingPointerMove;
        document.addEventListener("pointermove", onPendingPointerMove, { capture: true });

        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null;
          if (activePointerIdRef.current !== event.pointerId) return;
          if (!sessionFileIdRef.current) return;
          const anchor = lastPointerRef.current ?? {
            x: event.clientX,
            y: event.clientY,
          };
          clearPendingPointerTracking();
          armDragSession(anchor);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event) => {
        if (!touchDragEnabled) {
          if (activePointerIdRef.current === event.pointerId) {
            resetSession();
          }
          return;
        }
        if (activePointerIdRef.current !== event.pointerId) return;

        const start = pointerStartRef.current;
        if (!start) return;

        lastPointerRef.current = { x: event.clientX, y: event.clientY };

        if (cancelPendingSessionIfScrolling(event.clientX, event.clientY)) {
          return;
        }

        if (armedRef.current || draggingRef.current) {
          event.preventDefault();
        }

        const distanceFromStart = Math.hypot(
          event.clientX - start.x,
          event.clientY - start.y,
        );

        const anchor = dragAnchorRef.current;
        const distanceFromAnchor = anchor
          ? Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y)
          : distanceFromStart;

        if (armedRef.current && !draggingRef.current && distanceFromAnchor > DRAG_START_PX) {
          clearPendingPointerTracking();
          blockGestureScroll();
          setTouchScrollLocked(true);
          beginActiveDrag(event.clientX, event.clientY);
          startAutoScrollLoop();
        }

        if (draggingRef.current) {
          updateDragAt(event.clientX, event.clientY);
        }
      },
      onPointerUp: (event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (draggingRef.current) {
          completeDrag();
          return;
        }

        if (armedRef.current) {
          suppressNextClickRef.current = true;
        }

        resetSession();
      },
      onPointerCancel: (event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        resetSession();
      },
      consumeSuppressedClick: () => {
        if (!suppressNextClickRef.current) return false;
        suppressNextClickRef.current = false;
        return true;
      },
    }),
    [
      armDragSession,
      beginActiveDrag,
      blockGestureScroll,
      cancelPendingSessionIfScrolling,
      clearLongPressTimer,
      clearPendingPointerTracking,
      completeDrag,
      resetSession,
      setTouchScrollLocked,
      startAutoScrollLoop,
      touchDragEnabled,
      updateDragAt,
    ],
  );

  return {
    touchDragEnabled,
    draggingFileId,
    armedFileId,
    dropTargetFolderId,
    ghostLabel,
    ghostPosition,
    getFileDragBindings,
  };
}
