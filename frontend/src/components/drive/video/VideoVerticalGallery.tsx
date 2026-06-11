// Human: TikTok-style vertical video feed — drag + snap between prev/current/next on portrait mobile.
// Agent: WRITES track top offset; CALLS goNext/goPrevious after snap animation; WRAPS center player surface.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FileItem } from "@/api/client";
import { VideoGalleryAdjacentPanel } from "@/components/drive/video/VideoGalleryAdjacentPanel";
import { isVideoGallerySwipeZone } from "@/components/drive/video/video-gallery-swipe";
import {
  VIDEO_GALLERY_AXIS_LOCK_PX,
  VIDEO_GALLERY_COMMIT_FALLBACK_MS,
  VIDEO_GALLERY_EDGE_DRAG_RESISTANCE,
  VIDEO_GALLERY_FLICK_VELOCITY_PX_MS,
  VIDEO_GALLERY_SNAP_EASING,
  VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_MAX_PX,
  VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_RATIO,
  videoGallerySnapDurationMs,
} from "@/components/drive/video/video-gallery-scroll";

type TouchSession = {
  startX: number;
  startY: number;
  startTime: number;
  startTrackY: number;
};

type TouchPoint = {
  clientX: number;
  clientY: number;
};

type VideoVerticalGalleryProps = {
  videos: FileItem[];
  currentIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  goPrevious: () => void;
  goNext: () => void;
  activeFileId: string;
  children: ReactNode;
};

// Human: Vertical three-panel carousel (prev / active / next) with TikTok snap physics.
// Agent: LISTENS touch on swipe zone; DEFERS index change until transitionend; RECENTERS on file id change.
export function VideoVerticalGallery({
  videos,
  currentIndex,
  hasPrevious,
  hasNext,
  goPrevious,
  goNext,
  activeFileId,
  children,
}: VideoVerticalGalleryProps) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackPositionRef = useRef(0);
  const touchSessionRef = useRef<TouchSession | null>(null);
  const isVerticalSwipeRef = useRef<boolean | null>(null);
  const pendingCommitRef = useRef<"previous" | "next" | null>(null);
  const commitFallbackTimerRef = useRef<number | null>(null);
  const suppressFileChangeResetRef = useRef(false);

  const [containerHeight, setContainerHeight] = useState(0);

  const previousFile = currentIndex > 0 ? videos[currentIndex - 1] : null;
  const nextFile =
    currentIndex >= 0 && currentIndex < videos.length - 1
      ? videos[currentIndex + 1]
      : null;

  const swipeCommitThresholdPx =
    containerHeight > 0
      ? Math.min(
          containerHeight * VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_RATIO,
          VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_MAX_PX,
        )
      : VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_MAX_PX;

  // Human: Drive carousel offset on the DOM during gestures — top avoids GPU layer quirks on iOS.
  // Agent: WRITES trackRef.style.top; READS trackPositionRef for snap targets and commit logic.
  const applyTrackTransform = useCallback(
    (nextY: number, options?: { animate?: boolean; durationMs?: number }) => {
      const track = trackRef.current;
      if (!track) return;

      const roundedY = Math.round(nextY);
      const previousY = trackPositionRef.current;
      trackPositionRef.current = roundedY;

      track.style.transform = "none";

      if (options?.animate) {
        const duration = options.durationMs ?? videoGallerySnapDurationMs(roundedY - previousY);
        track.style.transition = `top ${duration}ms ${VIDEO_GALLERY_SNAP_EASING}`;
        track.style.willChange = "top";
      } else {
        track.style.transition = "none";
        track.style.willChange = "";
      }

      track.style.top = `${roundedY}px`;
    },
    [],
  );

  const recenterTrack = useCallback(
    (options?: { animate?: boolean; durationMs?: number }) => {
      if (containerHeight <= 0) return;
      applyTrackTransform(-containerHeight, options);
    },
    [applyTrackTransform, containerHeight],
  );

  const clearCommitFallbackTimer = useCallback(() => {
    if (commitFallbackTimerRef.current !== null) {
      window.clearTimeout(commitFallbackTimerRef.current);
      commitFallbackTimerRef.current = null;
    }
  }, []);

  const flushPendingSwipeCommit = useCallback(() => {
    const commit = pendingCommitRef.current;
    if (!commit) return false;

    pendingCommitRef.current = null;
    clearCommitFallbackTimer();

    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
    }

    suppressFileChangeResetRef.current = true;
    if (commit === "next") {
      goNext();
    } else {
      goPrevious();
    }
    return true;
  }, [clearCommitFallbackTimer, goNext, goPrevious]);

  const scheduleCommitFallback = useCallback(() => {
    clearCommitFallbackTimer();
    commitFallbackTimerRef.current = window.setTimeout(() => {
      commitFallbackTimerRef.current = null;
      if (pendingCommitRef.current) {
        flushPendingSwipeCommit();
      }
    }, VIDEO_GALLERY_COMMIT_FALLBACK_MS);
  }, [clearCommitFallbackTimer, flushPendingSwipeCommit]);

  const cancelActiveTrackTransition = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    if (track.style.transition && track.style.transition !== "none") {
      track.style.transition = "none";
      recenterTrack();
    }
  }, [recenterTrack]);

  // Human: Measure swipe viewport height — sync read on mount, then ResizeObserver for rotation.
  // Agent: READS galleryRef.clientHeight; WRITES containerHeight for track panel sizing.
  useLayoutEffect(() => {
    const node = galleryRef.current;
    if (!node) return;

    const syncHeight = () => {
      const height = node.clientHeight;
      if (height > 0) {
        setContainerHeight(height);
      }
    };

    syncHeight();

    const observer = new ResizeObserver(() => {
      syncHeight();
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (containerHeight <= 0) return;

    if (suppressFileChangeResetRef.current) {
      suppressFileChangeResetRef.current = false;
      pendingCommitRef.current = null;
      recenterTrack();
      return;
    }

    pendingCommitRef.current = null;
    recenterTrack();
  }, [activeFileId, containerHeight, recenterTrack]);

  useEffect(() => {
    return () => {
      if (commitFallbackTimerRef.current !== null) {
        window.clearTimeout(commitFallbackTimerRef.current);
      }
    };
  }, []);

  const applyEdgeResistance = useCallback(
    (nextY: number) => {
      if (containerHeight <= 0) return nextY;
      const rest = -containerHeight;
      if (!hasPrevious && nextY > rest) {
        return rest + (nextY - rest) * VIDEO_GALLERY_EDGE_DRAG_RESISTANCE;
      }
      if (!hasNext && nextY < rest) {
        return rest + (nextY - rest) * VIDEO_GALLERY_EDGE_DRAG_RESISTANCE;
      }
      return nextY;
    },
    [containerHeight, hasNext, hasPrevious],
  );

  const finishTouchSession = useCallback(
    (touch: TouchPoint, cancelled: boolean) => {
      const session = touchSessionRef.current;
      touchSessionRef.current = null;
      if (!session || containerHeight <= 0) return;

      const deltaY = touch.clientY - session.startY;
      const elapsed = Date.now() - session.startTime;
      const rest = -containerHeight;
      const velocityY = deltaY / Math.max(elapsed, 1);

      if (isVerticalSwipeRef.current === false || cancelled) {
        recenterTrack({
          animate: true,
          durationMs: videoGallerySnapDurationMs(Math.abs(rest - trackPositionRef.current)),
        });
        isVerticalSwipeRef.current = null;
        return;
      }

      // Human: Swipe up (finger moves up, deltaY negative) reveals next video from below — TikTok feed.
      // Agent: COMMIT next when deltaY < -threshold or fast upward flick.
      const commitNext =
        hasNext &&
        (deltaY < -swipeCommitThresholdPx || velocityY < -VIDEO_GALLERY_FLICK_VELOCITY_PX_MS);
      const commitPrevious =
        hasPrevious &&
        (deltaY > swipeCommitThresholdPx || velocityY > VIDEO_GALLERY_FLICK_VELOCITY_PX_MS);

      if (commitNext) {
        pendingCommitRef.current = "next";
        applyTrackTransform(-2 * containerHeight, {
          animate: true,
          durationMs: videoGallerySnapDurationMs(
            Math.abs(-2 * containerHeight - trackPositionRef.current),
          ),
        });
        scheduleCommitFallback();
      } else if (commitPrevious) {
        pendingCommitRef.current = "previous";
        applyTrackTransform(0, {
          animate: true,
          durationMs: videoGallerySnapDurationMs(Math.abs(trackPositionRef.current)),
        });
        scheduleCommitFallback();
      } else {
        recenterTrack({
          animate: true,
          durationMs: videoGallerySnapDurationMs(Math.abs(rest - trackPositionRef.current)),
        });
      }

      isVerticalSwipeRef.current = null;
    },
    [
      applyTrackTransform,
      containerHeight,
      hasNext,
      hasPrevious,
      recenterTrack,
      scheduleCommitFallback,
      swipeCommitThresholdPx,
    ],
  );

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (containerHeight <= 0) return;
      if (!isVideoGallerySwipeZone(event.target)) return;
      if (event.touches.length >= 2) return;

      const touch = event.touches[0];
      if (!touch) return;

      if (pendingCommitRef.current) {
        flushPendingSwipeCommit();
      } else {
        cancelActiveTrackTransition();
      }

      touchSessionRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        startTrackY: trackPositionRef.current,
      };
      isVerticalSwipeRef.current = null;
      applyTrackTransform(trackPositionRef.current);
    },
    [
      applyTrackTransform,
      cancelActiveTrackTransition,
      containerHeight,
      flushPendingSwipeCommit,
    ],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length >= 2) {
        touchSessionRef.current = null;
        isVerticalSwipeRef.current = null;
        return;
      }

      const session = touchSessionRef.current;
      if (!session || containerHeight <= 0) return;

      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;

      if (isVerticalSwipeRef.current === null) {
        if (
          Math.abs(deltaX) >= VIDEO_GALLERY_AXIS_LOCK_PX ||
          Math.abs(deltaY) >= VIDEO_GALLERY_AXIS_LOCK_PX
        ) {
          isVerticalSwipeRef.current = Math.abs(deltaY) > Math.abs(deltaX);
        }
      }

      if (isVerticalSwipeRef.current !== true) return;

      event.preventDefault();
      applyTrackTransform(applyEdgeResistance(session.startTrackY + deltaY));
    },
    [applyEdgeResistance, applyTrackTransform, containerHeight],
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      finishTouchSession(touch, false);
    },
    [finishTouchSession],
  );

  const handleTouchCancel = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      finishTouchSession(touch, true);
    },
    [finishTouchSession],
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const handleTrackTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "top") return;
      if (!pendingCommitRef.current || containerHeight <= 0) return;

      track.style.willChange = "";
      clearCommitFallbackTimer();
      flushPendingSwipeCommit();
    };

    track.addEventListener("transitionend", handleTrackTransitionEnd);
    return () => track.removeEventListener("transitionend", handleTrackTransitionEnd);
  }, [clearCommitFallbackTimer, containerHeight, flushPendingSwipeCommit]);

  const trackHeightStyle =
    containerHeight > 0 ? { height: containerHeight * 3 } : { height: "300%" as const };

  return (
    <div
      ref={galleryRef}
      className="absolute inset-0 touch-none overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      aria-label="Swipe up or down to browse videos"
    >
      {containerHeight > 0 ? (
        <div
          ref={trackRef}
          className="absolute left-0 w-full flex flex-col"
          style={trackHeightStyle}
        >
          <div style={{ height: containerHeight }} className="w-full shrink-0">
            <VideoGalleryAdjacentPanel
              file={previousFile}
              label={previousFile?.name ?? "Previous video"}
            />
          </div>
          <div
            style={{ height: containerHeight }}
            className="relative w-full shrink-0 overflow-hidden"
          >
            {/* Human: Player shell needs a sized flex parent — fixed-height panel alone collapses flex-1. */}
            {/* Agent: absolute inset-0 flex column; FILLS center gallery slot for VideoPlayerSurfaceMobile. */}
            <div className="absolute inset-0 flex min-h-0 flex-col">{children}</div>
          </div>
          <div style={{ height: containerHeight }} className="w-full shrink-0">
            <VideoGalleryAdjacentPanel
              file={nextFile}
              label={nextFile?.name ?? "Next video"}
            />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex min-h-0 flex-col">{children}</div>
      )}
    </div>
  );
}
