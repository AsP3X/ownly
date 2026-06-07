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
const LONG_PRESS_MS = 380;
const SCROLL_CANCEL_PX = 12;
const DRAG_START_PX = 6;
const AUTO_SCROLL_EDGE_PX = 72;
const AUTO_SCROLL_MAX_SPEED = 14;

type GhostPosition = { x: number; y: number };

type UseExplorerTouchDragOptions = {
  enabled: boolean;
  scrollElementRef?: RefObject<HTMLElement | null>;
  onMoveFileToFolder?: (fileId: string, folderId: string) => void | Promise<void>;
  resolveFileFolderId: (fileId: string) => string | null | undefined;
  /** Human: Notifies parent when a touch drag ghost is active — used to dismiss the context menu. */
  onDragSessionActiveChange?: (active: boolean) => void;
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
  }, [clearLongPressTimer, onDragSessionActiveChange, stopAutoScrollLoop]);

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

  const armDragSession = useCallback(() => {
    if (!sessionFileIdRef.current) return;
    armedRef.current = true;
    setArmedFileId(sessionFileIdRef.current);
  }, []);

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
        activePointerIdRef.current = event.pointerId;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        sessionFileIdRef.current = fileId;
        sessionFileNameRef.current = fileName;
        suppressNextClickRef.current = false;
        armedRef.current = false;
        draggingRef.current = false;
        setArmedFileId(null);
        setDraggingFileId(null);
        setDropTargetFolderId(null);
        setGhostLabel(null);
        setGhostPosition(null);

        event.currentTarget.setPointerCapture(event.pointerId);

        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null;
          if (activePointerIdRef.current !== event.pointerId) return;
          armDragSession();
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

        const deltaX = event.clientX - start.x;
        const deltaY = event.clientY - start.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (!armedRef.current && !draggingRef.current && distance > SCROLL_CANCEL_PX) {
          clearLongPressTimer();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          resetSession();
          return;
        }

        if (armedRef.current && !draggingRef.current && distance > DRAG_START_PX) {
          beginActiveDrag(event.clientX, event.clientY);
          startAutoScrollLoop();
        }

        if (draggingRef.current) {
          event.preventDefault();
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
      clearLongPressTimer,
      completeDrag,
      resetSession,
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
