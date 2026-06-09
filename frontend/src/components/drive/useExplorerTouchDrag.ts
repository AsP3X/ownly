// Human: Touch drag-and-drop for the mobile explorer — long-press a file or folder, drag onto a folder tile.
// Agent: READS pointer events on tiles; WRITES ghost + drop highlight; CALLS move handlers on drop.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { ExplorerDragKind } from "@/lib/explorer-drag";

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
  onMoveFileToFolder?: (fileId: string, folderId: string | null) => void | Promise<void>;
  onMoveFolderToParent?: (
    folderId: string,
    parentId: string | null,
  ) => void | Promise<void>;
  resolveFileFolderId: (fileId: string) => string | null | undefined;
  resolveFolderParentId: (folderId: string) => string | null | undefined;
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
  onMoveFolderToParent,
  resolveFileFolderId,
  resolveFolderParentId,
  onDragSessionActiveChange,
  onTouchScrollLockChange,
}: UseExplorerTouchDragOptions) {
  const [isDesktopViewport, setIsDesktopViewport] = useState(readIsDesktopViewport);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingItemKind, setDraggingItemKind] = useState<ExplorerDragKind | null>(null);
  const [armedItemId, setArmedItemId] = useState<string | null>(null);
  const [armedItemKind, setArmedItemKind] = useState<ExplorerDragKind | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [ghostLabel, setGhostLabel] = useState<string | null>(null);
  const [ghostPosition, setGhostPosition] = useState<GhostPosition | null>(null);
  const [ghostKind, setGhostKind] = useState<ExplorerDragKind>("file");

  const longPressTimerRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const draggingRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const autoScrollFrameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<GhostPosition | null>(null);
  const sessionItemIdRef = useRef<string | null>(null);
  const sessionItemKindRef = useRef<ExplorerDragKind | null>(null);
  const sessionItemNameRef = useRef<string>("");
  const dropTargetFolderIdRef = useRef<string | null>(null);
  const dragAnchorRef = useRef<GhostPosition | null>(null);
  const touchScrollLockedRef = useRef(false);
  const pointerDownAtRef = useRef(0);
  const gestureScrollBlockedRef = useRef(false);
  const gestureScrollHandlerRef = useRef<((event: Event) => void) | null>(null);
  const sessionElementRef = useRef<HTMLElement | null>(null);
  const pendingPointerMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);

  const touchDragEnabled =
    enabled &&
    !isDesktopViewport &&
    (onMoveFileToFolder !== undefined || onMoveFolderToParent !== undefined);

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
      if (!sessionItemIdRef.current) return;
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
    sessionItemIdRef.current = null;
    sessionItemKindRef.current = null;
    sessionItemNameRef.current = "";
    lastPointerRef.current = null;
    dragAnchorRef.current = null;
    pointerDownAtRef.current = 0;
    sessionElementRef.current = null;
    clearPendingPointerTracking();
    unblockGestureScroll();
    setTouchScrollLocked(false);
    setArmedItemId(null);
    setArmedItemKind(null);
    setDraggingItemId(null);
    setDraggingItemKind(null);
    dropTargetFolderIdRef.current = null;
    setDropTargetFolderId(null);
    setGhostLabel(null);
    setGhostPosition(null);
    setGhostKind("file");
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

  const isValidFolderDrop = useCallback(
    (itemId: string, kind: ExplorerDragKind, folderId: string) => {
      if (kind === "folder" && itemId === folderId) {
        return false;
      }
      if (kind === "file") {
        return resolveFileFolderId(itemId) !== folderId;
      }
      return (resolveFolderParentId(itemId) ?? null) !== folderId;
    },
    [resolveFileFolderId, resolveFolderParentId],
  );

  const beginActiveDrag = useCallback(
    (clientX: number, clientY: number) => {
      const itemId = sessionItemIdRef.current;
      const kind = sessionItemKindRef.current;
      if (!itemId || !kind || draggingRef.current) return;

      draggingRef.current = true;
      suppressNextClickRef.current = true;
      setDraggingItemId(itemId);
      setDraggingItemKind(kind);
      setGhostKind(kind);
      setGhostLabel(sessionItemNameRef.current);
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
      const itemId = sessionItemIdRef.current;
      const kind = sessionItemKindRef.current;
      const isValidTarget =
        folderId !== null &&
        itemId !== null &&
        kind !== null &&
        isValidFolderDrop(itemId, kind, folderId);

      const nextTarget = isValidTarget ? folderId : null;
      dropTargetFolderIdRef.current = nextTarget;
      setDropTargetFolderId(nextTarget);
    },
    [isValidFolderDrop],
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

  const armDragSession = useCallback((anchor: GhostPosition) => {
    if (!sessionItemIdRef.current) return;
    armedRef.current = true;
    dragAnchorRef.current = anchor;
    setArmedItemId(sessionItemIdRef.current);
    setArmedItemKind(sessionItemKindRef.current);
    const element = sessionElementRef.current;
    const pointerId = activePointerIdRef.current;
    if (element && pointerId !== null && !element.hasPointerCapture(pointerId)) {
      element.setPointerCapture(pointerId);
    }
  }, []);

  const cancelPendingSessionIfScrolling = useCallback(
    (clientX: number, clientY: number) => {
      if (armedRef.current || draggingRef.current) return false;
      const start = pointerStartRef.current;
      if (!start || !sessionItemIdRef.current) return false;
      const distance = Math.hypot(clientX - start.x, clientY - start.y);
      if (distance <= SCROLL_CANCEL_PX) return false;
      resetSession();
      return true;
    },
    [resetSession],
  );

  const completeDrag = useCallback(() => {
    const itemId = sessionItemIdRef.current;
    const kind = sessionItemKindRef.current;
    const folderId = dropTargetFolderIdRef.current;
    const shouldMove =
      draggingRef.current &&
      itemId !== null &&
      kind !== null &&
      folderId !== null &&
      isValidFolderDrop(itemId, kind, folderId);

    resetSession();

    if (shouldMove && itemId && kind && folderId) {
      if (kind === "file") {
        void onMoveFileToFolder?.(itemId, folderId);
      } else {
        void onMoveFolderToParent?.(itemId, folderId);
      }
    }
  }, [isValidFolderDrop, onMoveFileToFolder, onMoveFolderToParent, resetSession]);

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

  useEffect(() => {
    if (!draggingItemId) return;

    const preventContextMenu = (event: Event) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", preventContextMenu, { capture: true });
    return () => document.removeEventListener("contextmenu", preventContextMenu, { capture: true });
  }, [draggingItemId]);

  useEffect(() => () => resetSession(), [resetSession]);

  const createDragBindings = useCallback(
    (kind: ExplorerDragKind, itemId: string, itemName: string): ExplorerTouchDragBindings => ({
      onPointerDown: (event) => {
        if (!touchDragEnabled || event.button !== 0) return;
        if (!event.isPrimary) return;

        clearLongPressTimer();
        clearPendingPointerTracking();
        activePointerIdRef.current = event.pointerId;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        sessionItemIdRef.current = itemId;
        sessionItemKindRef.current = kind;
        sessionItemNameRef.current = itemName;
        sessionElementRef.current = event.currentTarget;
        suppressNextClickRef.current = false;
        armedRef.current = false;
        draggingRef.current = false;
        setArmedItemId(null);
        setArmedItemKind(null);
        setDraggingItemId(null);
        setDraggingItemKind(null);
        setDropTargetFolderId(null);
        setGhostLabel(null);
        setGhostPosition(null);

        pointerDownAtRef.current = Date.now();
        lastPointerRef.current = { x: event.clientX, y: event.clientY };

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
          if (!sessionItemIdRef.current) return;
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

  const getFileDragBindings = useCallback(
    (fileId: string, fileName: string) => createDragBindings("file", fileId, fileName),
    [createDragBindings],
  );

  const getFolderDragBindings = useCallback(
    (folderId: string, folderName: string) => createDragBindings("folder", folderId, folderName),
    [createDragBindings],
  );

  return {
    touchDragEnabled,
    draggingItemId,
    draggingItemKind,
    armedItemId,
    armedItemKind,
    dropTargetFolderId,
    ghostLabel,
    ghostPosition,
    ghostKind,
    getFileDragBindings,
    getFolderDragBindings,
  };
}
