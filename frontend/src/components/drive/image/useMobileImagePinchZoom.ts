// Human: Pinch-to-zoom and pan for the mobile image lightbox — standard two-finger zoom with drag when magnified.
// Agent: WRITES transform on layerRef; READS touch events; RETURNS isZoomedRef for carousel swipe gating.

import { useCallback, useLayoutEffect, useRef, type TouchEvent as ReactTouchEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MAX_MS = 320;
const ZOOM_SNAP_MS = 250;
const ZOOM_SNAP_EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

type PinchZoomState = {
  scale: number;
  x: number;
  y: number;
};

type TouchLike = {
  clientX: number;
  clientY: number;
};

type PinchSession = {
  distance: number;
  scale: number;
  x: number;
  y: number;
  focalX: number;
  focalY: number;
};

type PanSession = {
  startX: number;
  startY: number;
  translateX: number;
  translateY: number;
};

type UseMobileImagePinchZoomOptions = {
  /** Human: Reset zoom when the active image changes (file id or blob URL). */
  resetKey: string | undefined;
  /** Human: Parent can cancel a pending tap-to-navigate when a double-tap zoom fires. */
  onCancelPendingTap?: () => void;
  /** Human: Notify parent when zoom/pan is active so gallery swipes stay disabled. */
  onZoomActiveChange?: (active: boolean) => void;
};

function touchDistance(first: TouchLike, second: TouchLike): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function readContainerMetrics(container: HTMLElement | null) {
  if (!container) {
    return { width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  const rect = container.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
  };
}

export function useMobileImagePinchZoom({
  resetKey,
  onCancelPendingTap,
  onZoomActiveChange,
}: UseMobileImagePinchZoomOptions) {
  const layerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<PinchZoomState>({ scale: 1, x: 0, y: 0 });
  const isZoomedRef = useRef(false);
  const gestureRef = useRef<"none" | "pinch" | "pan">("none");
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const lastTapTimeRef = useRef(0);

  const notifyZoomActive = useCallback(
    (state: PinchZoomState) => {
      const active =
        state.scale > MIN_SCALE + 0.02 ||
        Math.abs(state.x) > 0.5 ||
        Math.abs(state.y) > 0.5;
      if (active === isZoomedRef.current) return;
      isZoomedRef.current = active;
      onZoomActiveChange?.(active);
    },
    [onZoomActiveChange],
  );

  const clampPan = useCallback((scale: number, x: number, y: number): PinchZoomState => {
    const container = layerRef.current?.parentElement ?? null;
    const { width, height } = readContainerMetrics(container);
    if (width <= 0 || height <= 0) {
      return { scale, x, y };
    }

    const maxX = (width * (scale - 1)) / 2;
    const maxY = (height * (scale - 1)) / 2;
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, []);

  const applyTransform = useCallback(
    (nextState: PinchZoomState, options?: { animate?: boolean }) => {
      const layer = layerRef.current;
      if (!layer) return;

      const state = clampPan(nextState.scale, nextState.x, nextState.y);
      stateRef.current = state;

      if (options?.animate) {
        layer.style.transition = `transform ${ZOOM_SNAP_MS}ms ${ZOOM_SNAP_EASING}`;
      } else {
        layer.style.transition = "none";
      }

      layer.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
      notifyZoomActive(state);
    },
    [clampPan, notifyZoomActive],
  );

  const resetZoom = useCallback(
    (animate = true) => {
      pinchSessionRef.current = null;
      panSessionRef.current = null;
      gestureRef.current = "none";
      applyTransform({ scale: MIN_SCALE, x: 0, y: 0 }, { animate });
    },
    [applyTransform],
  );

  useLayoutEffect(() => {
    applyTransform({ scale: MIN_SCALE, x: 0, y: 0 }, { animate: false });
  }, [resetKey, applyTransform]);

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const container = layerRef.current?.parentElement ?? null;
      const { centerX, centerY } = readContainerMetrics(container);

      if (event.touches.length >= 2) {
        const first = event.touches[0];
        const second = event.touches[1];
        if (!first || !second) return;

        gestureRef.current = "pinch";
        panSessionRef.current = null;
        pinchSessionRef.current = {
          distance: touchDistance(first, second),
          scale: stateRef.current.scale,
          x: stateRef.current.x,
          y: stateRef.current.y,
          focalX: (first.clientX + second.clientX) / 2 - centerX,
          focalY: (first.clientY + second.clientY) / 2 - centerY,
        };
        event.stopPropagation();
        return;
      }

      if (event.touches.length === 1 && isZoomedRef.current) {
        const touch = event.touches[0];
        if (!touch) return;

        gestureRef.current = "pan";
        pinchSessionRef.current = null;
        panSessionRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          translateX: stateRef.current.x,
          translateY: stateRef.current.y,
        };
        event.stopPropagation();
      }
    },
    [],
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (gestureRef.current === "pinch" && event.touches.length >= 2 && pinchSessionRef.current) {
        const first = event.touches[0];
        const second = event.touches[1];
        if (!first || !second) return;

        event.preventDefault();
        event.stopPropagation();

        const session = pinchSessionRef.current;
        const distance = touchDistance(first, second);
        const ratio = distance / session.distance;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, session.scale * ratio));
        const scaleRatio = nextScale / session.scale;
        const nextX = session.focalX - (session.focalX - session.x) * scaleRatio;
        const nextY = session.focalY - (session.focalY - session.y) * scaleRatio;
        applyTransform({ scale: nextScale, x: nextX, y: nextY });
        return;
      }

      if (gestureRef.current === "pan" && event.touches.length === 1 && panSessionRef.current) {
        const touch = event.touches[0];
        if (!touch) return;

        event.preventDefault();
        event.stopPropagation();

        const session = panSessionRef.current;
        applyTransform({
          scale: stateRef.current.scale,
          x: session.translateX + (touch.clientX - session.startX),
          y: session.translateY + (touch.clientY - session.startY),
        });
      }
    },
    [applyTransform],
  );

  const handleTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (gestureRef.current === "pinch" && event.touches.length < 2) {
        pinchSessionRef.current = null;
        if (stateRef.current.scale <= MIN_SCALE + 0.05) {
          resetZoom(true);
        } else {
          applyTransform(stateRef.current, { animate: true });
        }

        if (event.touches.length === 1 && isZoomedRef.current) {
          const touch = event.touches[0];
          if (touch) {
            gestureRef.current = "pan";
            panSessionRef.current = {
              startX: touch.clientX,
              startY: touch.clientY,
              translateX: stateRef.current.x,
              translateY: stateRef.current.y,
            };
          }
        } else {
          gestureRef.current = "none";
        }

        event.stopPropagation();
        return;
      }

      if (gestureRef.current === "pan" && event.touches.length === 0) {
        panSessionRef.current = null;
        gestureRef.current = "none";

        if (stateRef.current.scale <= MIN_SCALE + 0.05) {
          resetZoom(true);
        } else {
          applyTransform(stateRef.current, { animate: true });
        }

        event.stopPropagation();
        return;
      }

      if (event.touches.length > 0 || gestureRef.current !== "none") return;

      const now = Date.now();
      if (now - lastTapTimeRef.current <= DOUBLE_TAP_MAX_MS) {
        lastTapTimeRef.current = 0;
        onCancelPendingTap?.();
        event.stopPropagation();

        if (isZoomedRef.current) {
          resetZoom(true);
        } else {
          applyTransform({ scale: DOUBLE_TAP_SCALE, x: 0, y: 0 }, { animate: true });
        }
        return;
      }

      lastTapTimeRef.current = now;
    },
    [applyTransform, onCancelPendingTap, resetZoom],
  );

  const handleTouchCancel = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (gestureRef.current === "none") return;
      pinchSessionRef.current = null;
      panSessionRef.current = null;
      gestureRef.current = "none";
      applyTransform(stateRef.current, { animate: true });
      event.stopPropagation();
    },
    [applyTransform],
  );

  return {
    layerRef,
    isZoomedRef,
    resetZoom,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
    },
  };
}
