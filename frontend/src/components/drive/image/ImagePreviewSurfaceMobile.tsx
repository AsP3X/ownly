// Human: Mobile image lightbox — Pencil MV Mobile Portrait Image Vertical / Letterbox full-bleed overlay.
// Agent: READS ImagePreviewControllerViewModel; SWIPES carousel; PINCH-ZOOM on active slide via useMobileImagePinchZoom.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE,
  resolveMobileViewportFitStyle,
} from "@/components/drive/image/image-preview-layout";
import { AnimatedGifCanvas } from "@/components/drive/image/AnimatedGifCanvas";
import {
  isGifPreviewFile,
  shouldUseGifCanvasPlayback,
} from "@/components/drive/image/image-preview-gif";
import type { ImagePreviewControllerViewModel } from "@/components/drive/image/useImagePreviewController";
import { useMobileImagePinchZoom } from "@/components/drive/image/useMobileImagePinchZoom";
import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Human: Minimum finger travel before a horizontal swipe commits to the next slide. */
const SWIPE_COMMIT_THRESHOLD_RATIO = 0.22;
const SWIPE_COMMIT_THRESHOLD_MAX_PX = 96;
/** Human: Rubber-band factor when dragging past the first or last image. */
const EDGE_DRAG_RESISTANCE = 0.35;
/** Human: Short tap vs drag — below this movement, treat release as a left/right tap zone. */
const TAP_MAX_MOVEMENT_PX = 10;
const TAP_MAX_DURATION_MS = 350;
const GALLERY_SNAP_EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
const GALLERY_SNAP_MIN_MS = 200;
const GALLERY_SNAP_MAX_MS = 360;
/** Human: Fallback when a swipe transition is interrupted before transitionend fires. */
const SWIPE_COMMIT_FALLBACK_MS = GALLERY_SNAP_MAX_MS + 80;
/** Human: Fast horizontal flicks commit even below the distance threshold. */
const FLICK_VELOCITY_PX_MS = 0.35;
/** Human: Delay left/right tap navigation so double-tap-to-zoom can cancel it. */
const TAP_NAV_DELAY_MS = 320;

type ImagePreviewSurfaceMobileProps = {
  vm: ImagePreviewControllerViewModel;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

type TouchSession = {
  startX: number;
  startY: number;
  startTime: number;
  startTrackX: number;
};

type TouchPoint = {
  clientX: number;
  clientY: number;
};

type ContainerSize = {
  width: number;
  height: number;
};

// Human: Track slide viewport size so fit math uses the same box the user sees.
// Agent: READS ResizeObserver contentRect; WRITES width/height for resolveMobileViewportFitStyle.
function useContainerSize(ref: React.RefObject<HTMLElement | null>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      setSize({ width: rect?.width ?? 0, height: rect?.height ?? 0 });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

type MobileViewportFitImageProps = {
  url: string;
  alt: string;
  fileId?: string;
  containerSize: ContainerSize;
  getPreviewDimensions: ImagePreviewControllerViewModel["getPreviewDimensions"];
  getPreviewGifBlob: ImagePreviewControllerViewModel["getPreviewGifBlob"];
  /** Human: GIF frames freeze under async decode on some mobile browsers — use sync for animated sources. */
  isAnimatedGif?: boolean;
};

// Human: Size image to touch viewport edges — width-first, or height-first when width would clip vertically.
// Agent: READS getPreviewDimensions + onLoad natural size; APPLIES resolveMobileViewportFitStyle inline.
function MobileViewportFitImage({
  url,
  alt,
  fileId,
  containerSize,
  getPreviewDimensions,
  getPreviewGifBlob,
  isAnimatedGif = false,
}: MobileViewportFitImageProps) {
  const [loadedNatural, setLoadedNatural] = useState<{ width: number; height: number } | null>(null);
  const cachedNatural = fileId ? getPreviewDimensions(fileId) : null;
  const naturalWidth = cachedNatural?.width ?? loadedNatural?.width ?? 0;
  const naturalHeight = cachedNatural?.height ?? loadedNatural?.height ?? 0;

  const fitStyle = useMemo(
    () =>
      resolveMobileViewportFitStyle(
        naturalWidth,
        naturalHeight,
        containerSize.width,
        containerSize.height,
      ),
    [containerSize.height, containerSize.width, naturalHeight, naturalWidth],
  );

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    setLoadedNatural({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const handleCanvasNaturalSize = useCallback((width: number, height: number) => {
    setLoadedNatural({ width, height });
  }, []);

  const resolvedStyle =
    naturalWidth > 0 && naturalHeight > 0 ? fitStyle : MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE;

  if (isAnimatedGif && shouldUseGifCanvasPlayback()) {
    return (
      <AnimatedGifCanvas
        byteSource={fileId ? getPreviewGifBlob(fileId) : null}
        url={url}
        alt={alt}
        fitStyle={resolvedStyle}
        className="block max-h-full max-w-full"
        onNaturalSize={handleCanvasNaturalSize}
      />
    );
  }

  return (
    <img
      key={isAnimatedGif ? url : undefined}
      src={url}
      alt={alt}
      loading="eager"
      decoding={isAnimatedGif ? "sync" : "async"}
      onLoad={handleImageLoad}
      style={resolvedStyle}
      className="block max-h-full max-w-full"
      draggable={false}
    />
  );
}

// Human: Scale snap duration to the remaining travel distance for a more natural deceleration.
function snapDurationMs(distancePx: number): number {
  return Math.min(GALLERY_SNAP_MAX_MS, Math.max(GALLERY_SNAP_MIN_MS, Math.abs(distancePx) * 0.42));
}

// Human: Viewport-fixed top/bottom scrim — stays visible while the carousel track moves underneath.
// Agent: RENDERS above gallery track (z-20); below top/bottom chrome (z-30); pointer-events-none.
function MobileImageViewportScrim() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[120px] bg-gradient-to-b from-[#000000CC] to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[120px] bg-gradient-to-t from-[#000000CC] to-transparent"
        aria-hidden
      />
    </>
  );
}

type ImageGallerySlideProps = {
  url: string | null;
  alt: string;
  fileId?: string;
  file?: FileItem | null;
  getPreviewDimensions: ImagePreviewControllerViewModel["getPreviewDimensions"];
  getPreviewGifBlob: ImagePreviewControllerViewModel["getPreviewGifBlob"];
  showLoader?: boolean;
  enablePinchZoom?: boolean;
  onZoomActiveChange?: (active: boolean) => void;
  onCancelPendingTap?: () => void;
};

// Human: One carousel panel — width-fit or height-fit so edges touch without cropping.
// Agent: READS url + file dimensions; RENDERS MobileViewportFitImage; optional PINCH-ZOOM on center slide.
function ImageGallerySlide({
  url,
  alt,
  fileId,
  file,
  getPreviewDimensions,
  getPreviewGifBlob,
  showLoader = false,
  enablePinchZoom = false,
  onZoomActiveChange,
  onCancelPendingTap,
}: ImageGallerySlideProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(stageRef);
  const isAnimatedGif = file ? isGifPreviewFile(file) : false;
  const allowPinchZoom = enablePinchZoom && !isAnimatedGif;

  const pinchZoom = useMobileImagePinchZoom({
    resetKey: allowPinchZoom ? (url ?? "empty") : "gallery-slide-no-zoom",
    onCancelPendingTap: allowPinchZoom ? onCancelPendingTap : undefined,
    onZoomActiveChange: allowPinchZoom ? onZoomActiveChange : undefined,
  });

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <div ref={stageRef} className="absolute inset-0 overflow-hidden">
        <div
          ref={pinchZoom.layerRef}
          className={cn(
            "flex size-full items-center justify-center origin-center",
            allowPinchZoom && "touch-none",
          )}
          {...(allowPinchZoom ? pinchZoom.touchHandlers : {})}
        >
          {url ? (
            <MobileViewportFitImage
              url={url}
              alt={alt}
              fileId={fileId}
              containerSize={containerSize}
              getPreviewDimensions={getPreviewDimensions}
              getPreviewGifBlob={getPreviewGifBlob}
              isAnimatedGif={isAnimatedGif}
            />
          ) : showLoader ? (
            <Loader2 className="size-7 animate-spin text-white/50" aria-hidden />
          ) : null}
        </div>
      </div>
    </div>
  );
}

type StaticImageStageProps = {
  displayUrl: string | null;
  file: FileItem | null;
  error: string;
  loading: boolean;
  showInitialLoader: boolean;
  getPreviewDimensions: ImagePreviewControllerViewModel["getPreviewDimensions"];
  getPreviewGifBlob: ImagePreviewControllerViewModel["getPreviewGifBlob"];
  onCancelPendingTap?: () => void;
};

// Human: Single-image layout when the folder has only one image (no carousel track).
function StaticImageStage({
  displayUrl,
  file,
  error,
  loading,
  showInitialLoader,
  getPreviewDimensions,
  getPreviewGifBlob,
  onCancelPendingTap,
}: StaticImageStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(stageRef);

  const isAnimatedGif = file ? isGifPreviewFile(file) : false;

  const pinchZoom = useMobileImagePinchZoom({
    resetKey: isAnimatedGif ? "static-gif-no-zoom" : (displayUrl ?? file?.id ?? "static-empty"),
    onCancelPendingTap: isAnimatedGif ? undefined : onCancelPendingTap,
  });

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <div ref={stageRef} className="absolute inset-0 overflow-hidden">
        <div
          ref={pinchZoom.layerRef}
          className={cn(
            "flex size-full origin-center items-center justify-center",
            !isAnimatedGif && "touch-none",
          )}
          {...(!isAnimatedGif ? pinchZoom.touchHandlers : {})}
        >
          {displayUrl ? (
            <MobileViewportFitImage
              url={displayUrl}
              alt={file?.name ?? "Image preview"}
              fileId={file?.id}
              containerSize={containerSize}
              getPreviewDimensions={getPreviewDimensions}
              getPreviewGifBlob={getPreviewGifBlob}
              isAnimatedGif={isAnimatedGif}
            />
          ) : null}
        </div>
      </div>

      <MobileImageViewportScrim />

      {error ? (
        <p
          className="pointer-events-none absolute inset-x-0 top-1/2 z-25 -translate-y-1/2 px-4 text-center text-sm text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {showInitialLoader ? (
        <div className="absolute inset-0 z-25 flex items-center justify-center bg-black/80">
          <Loader2 className="size-7 animate-spin text-white/80" aria-hidden />
          <span className="sr-only">Loading image…</span>
        </div>
      ) : null}

      {loading && displayUrl ? (
        <div
          className="pointer-events-none absolute right-3 top-3 z-25 flex items-center gap-2 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-3 py-1.5 text-xs text-white"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : null}
    </div>
  );
}

export function ImagePreviewSurfaceMobile({
  vm,
  onDownload,
  onShare,
}: ImagePreviewSurfaceMobileProps) {
  const {
    file,
    displayUrl,
    error,
    loading,
    showInitialLoader,
    hasPrevious,
    hasNext,
    showGalleryNav,
    positionLabel,
    sizeLabel,
    showDownloadAction,
    showShareAction,
    goPrevious,
    goNext,
    adjacentUrls,
    previousFile,
    nextFile,
    getPreviewDimensions,
    getPreviewGifBlob,
  } = vm;

  const galleryRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackPositionRef = useRef(0);
  const touchSessionRef = useRef<TouchSession | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);
  const pendingCommitRef = useRef<"previous" | "next" | null>(null);
  const commitFallbackTimerRef = useRef<number | null>(null);
  // Human: Hold file-change reset until the swipe commit layout pass recenters the track.
  const suppressFileChangeResetRef = useRef(false);
  const centerZoomActiveRef = useRef(false);
  const tapNavTimerRef = useRef<number | null>(null);

  const cancelPendingTapNav = useCallback(() => {
    if (tapNavTimerRef.current !== null) {
      window.clearTimeout(tapNavTimerRef.current);
      tapNavTimerRef.current = null;
    }
  }, []);

  const handleCenterZoomActiveChange = useCallback((active: boolean) => {
    centerZoomActiveRef.current = active;
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingTapNav();
      if (commitFallbackTimerRef.current !== null) {
        window.clearTimeout(commitFallbackTimerRef.current);
        commitFallbackTimerRef.current = null;
      }
    };
  }, [cancelPendingTapNav]);

  const [containerWidth, setContainerWidth] = useState(0);

  const swipeCommitThresholdPx =
    containerWidth > 0
      ? Math.min(containerWidth * SWIPE_COMMIT_THRESHOLD_RATIO, SWIPE_COMMIT_THRESHOLD_MAX_PX)
      : SWIPE_COMMIT_THRESHOLD_MAX_PX;

  // Human: Drive carousel offset on the DOM during gestures — left avoids iOS freezing GIFs under translate3d.
  // Agent: WRITES trackRef.style.left; READS trackPositionRef for snap targets and commit logic.
  const applyTrackTransform = useCallback(
    (nextX: number, options?: { animate?: boolean; durationMs?: number }) => {
      const track = trackRef.current;
      if (!track) return;

      const roundedX = Math.round(nextX);
      const previousX = trackPositionRef.current;
      trackPositionRef.current = roundedX;

      track.style.transform = "none";

      if (options?.animate) {
        const duration = options.durationMs ?? snapDurationMs(roundedX - previousX);
        track.style.transition = `left ${duration}ms ${GALLERY_SNAP_EASING}`;
        track.style.willChange = "left";
      } else {
        track.style.transition = "none";
        track.style.willChange = "";
      }

      track.style.left = `${roundedX}px`;
    },
    [],
  );

  const recenterTrack = useCallback(
    (options?: { animate?: boolean; durationMs?: number }) => {
      if (containerWidth <= 0) return;
      applyTrackTransform(-containerWidth, options);
    },
    [applyTrackTransform, containerWidth],
  );

  const clearCommitFallbackTimer = useCallback(() => {
    if (commitFallbackTimerRef.current !== null) {
      window.clearTimeout(commitFallbackTimerRef.current);
      commitFallbackTimerRef.current = null;
    }
  }, []);

  // Human: Apply a completed swipe when transitionend fires or when the animation is interrupted.
  // Agent: READS pendingCommitRef; CALLS goNext/goPrevious; RECENTERS track via suppressFileChangeResetRef.
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
    centerZoomActiveRef.current = false;
    return true;
  }, [clearCommitFallbackTimer, goNext, goPrevious]);

  const scheduleCommitFallback = useCallback(() => {
    clearCommitFallbackTimer();
    commitFallbackTimerRef.current = window.setTimeout(() => {
      commitFallbackTimerRef.current = null;
      if (pendingCommitRef.current) {
        flushPendingSwipeCommit();
      }
    }, SWIPE_COMMIT_FALLBACK_MS);
  }, [clearCommitFallbackTimer, flushPendingSwipeCommit]);

  const cancelActiveTrackTransition = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    if (track.style.transition && track.style.transition !== "none") {
      track.style.transition = "none";
      recenterTrack();
    }
  }, [recenterTrack]);

  // Human: Measure the swipe viewport so each carousel panel is exactly one screen width.
  useEffect(() => {
    const node = galleryRef.current;
    if (!node || !showGalleryNav) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [showGalleryNav]);

  // Human: Recenter the track when the active file or viewport width changes.
  // Agent: useLayoutEffect RUNS before paint; swipe commits set suppressFileChangeResetRef first.
  useLayoutEffect(() => {
    if (!showGalleryNav || containerWidth <= 0) return;

    centerZoomActiveRef.current = false;

    if (suppressFileChangeResetRef.current) {
      suppressFileChangeResetRef.current = false;
      pendingCommitRef.current = null;
      recenterTrack();
      return;
    }

    pendingCommitRef.current = null;
    recenterTrack();
  }, [file?.id, containerWidth, showGalleryNav, recenterTrack]);

  const applyEdgeResistance = useCallback(
    (nextX: number) => {
      if (containerWidth <= 0) return nextX;
      const rest = -containerWidth;
      if (!hasPrevious && nextX > rest) {
        return rest + (nextX - rest) * EDGE_DRAG_RESISTANCE;
      }
      if (!hasNext && nextX < rest) {
        return rest + (nextX - rest) * EDGE_DRAG_RESISTANCE;
      }
      return nextX;
    },
    [containerWidth, hasNext, hasPrevious],
  );

  const finishTouchSession = useCallback(
    (touch: TouchPoint, cancelled: boolean) => {
      const session = touchSessionRef.current;
      touchSessionRef.current = null;
      if (!session || !showGalleryNav || containerWidth <= 0) return;
      if (centerZoomActiveRef.current) return;

      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;
      const elapsed = Date.now() - session.startTime;
      const rest = -containerWidth;
      const velocityX = deltaX / Math.max(elapsed, 1);

      if (
        !cancelled &&
        Math.abs(deltaX) < TAP_MAX_MOVEMENT_PX &&
        Math.abs(deltaY) < TAP_MAX_MOVEMENT_PX &&
        elapsed < TAP_MAX_DURATION_MS
      ) {
        cancelPendingTapNav();
        tapNavTimerRef.current = window.setTimeout(() => {
          tapNavTimerRef.current = null;
          const rect = galleryRef.current?.getBoundingClientRect();
          if (!rect) return;
          const tapX = touch.clientX - rect.left;
          if (tapX < rect.width / 2) {
            if (hasPrevious) {
              // Human: Defer index change until the slide animation finishes — same as finger swipes.
              // Agent: SETS pendingCommitRef; CALLS flushPendingSwipeCommit on transitionend.
              pendingCommitRef.current = "previous";
              applyTrackTransform(0, {
                animate: true,
                durationMs: snapDurationMs(Math.abs(trackPositionRef.current)),
              });
              scheduleCommitFallback();
              return;
            }
          } else if (hasNext) {
            pendingCommitRef.current = "next";
            applyTrackTransform(-2 * containerWidth, {
              animate: true,
              durationMs: snapDurationMs(Math.abs(-2 * containerWidth - trackPositionRef.current)),
            });
            scheduleCommitFallback();
            return;
          }
          recenterTrack({
            animate: true,
            durationMs: snapDurationMs(Math.abs(rest - trackPositionRef.current)),
          });
        }, TAP_NAV_DELAY_MS);
        isHorizontalSwipeRef.current = null;
        return;
      }

      if (isHorizontalSwipeRef.current === false || cancelled) {
        recenterTrack({
          animate: true,
          durationMs: snapDurationMs(Math.abs(rest - trackPositionRef.current)),
        });
        isHorizontalSwipeRef.current = null;
        return;
      }

      const commitNext =
        hasNext && (deltaX < -swipeCommitThresholdPx || velocityX < -FLICK_VELOCITY_PX_MS);
      const commitPrevious =
        hasPrevious && (deltaX > swipeCommitThresholdPx || velocityX > FLICK_VELOCITY_PX_MS);

      if (commitNext) {
        pendingCommitRef.current = "next";
        applyTrackTransform(-2 * containerWidth, {
          animate: true,
          durationMs: snapDurationMs(Math.abs(-2 * containerWidth - trackPositionRef.current)),
        });
        scheduleCommitFallback();
      } else if (commitPrevious) {
        pendingCommitRef.current = "previous";
        applyTrackTransform(0, {
          animate: true,
          durationMs: snapDurationMs(Math.abs(trackPositionRef.current)),
        });
        scheduleCommitFallback();
      } else {
        recenterTrack({
          animate: true,
          durationMs: snapDurationMs(Math.abs(rest - trackPositionRef.current)),
        });
      }

      isHorizontalSwipeRef.current = null;
    },
    [
      applyTrackTransform,
      cancelPendingTapNav,
      containerWidth,
      hasNext,
      hasPrevious,
      recenterTrack,
      scheduleCommitFallback,
      showGalleryNav,
      swipeCommitThresholdPx,
    ],
  );

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!showGalleryNav || containerWidth <= 0) return;
      if (centerZoomActiveRef.current || event.touches.length >= 2) return;

      const touch = event.touches[0];
      if (!touch) return;

      cancelPendingTapNav();

      // Human: Interrupted swipe animations never fire transitionend — flush the pending index change first.
      // Agent: READS pendingCommitRef; CALLS flushPendingSwipeCommit before starting the next gesture.
      if (pendingCommitRef.current) {
        flushPendingSwipeCommit();
      } else {
        cancelActiveTrackTransition();
      }

      touchSessionRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        startTrackX: trackPositionRef.current,
      };
      isHorizontalSwipeRef.current = null;
      applyTrackTransform(trackPositionRef.current);
    },
    [
      applyTrackTransform,
      cancelActiveTrackTransition,
      cancelPendingTapNav,
      containerWidth,
      flushPendingSwipeCommit,
      showGalleryNav,
    ],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length >= 2) {
        touchSessionRef.current = null;
        isHorizontalSwipeRef.current = null;
        return;
      }

      if (centerZoomActiveRef.current) return;

      const session = touchSessionRef.current;
      if (!session || !showGalleryNav || containerWidth <= 0) return;

      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;

      if (isHorizontalSwipeRef.current === null) {
        if (Math.abs(deltaX) >= 8 || Math.abs(deltaY) >= 8) {
          isHorizontalSwipeRef.current = Math.abs(deltaX) > Math.abs(deltaY);
        }
      }

      if (isHorizontalSwipeRef.current !== true) return;

      event.preventDefault();
      applyTrackTransform(applyEdgeResistance(session.startTrackX + deltaX));
    },
    [applyEdgeResistance, applyTrackTransform, containerWidth, showGalleryNav],
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
    if (!track || !showGalleryNav) return;

    const handleTrackTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "left") return;
      if (!pendingCommitRef.current || containerWidth <= 0) return;

      if (track) {
        track.style.willChange = "";
      }
      clearCommitFallbackTimer();
      flushPendingSwipeCommit();
    };

    track.addEventListener("transitionend", handleTrackTransitionEnd);
    return () => track.removeEventListener("transitionend", handleTrackTransitionEnd);
  }, [clearCommitFallbackTimer, containerWidth, flushPendingSwipeCommit, showGalleryNav]);

  const trackWidthStyle =
    containerWidth > 0 ? { width: containerWidth * 3 } : { width: "300%" as const };

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      {showGalleryNav ? (
        <div
          ref={galleryRef}
          className="absolute inset-0 overflow-hidden touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          aria-label="Swipe left or right to browse images"
        >
          {containerWidth > 0 ? (
            <div
              ref={trackRef}
              className="relative flex h-full"
              style={trackWidthStyle}
            >
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={adjacentUrls.previous}
                  alt={previousFile?.name ?? "Previous image"}
                  fileId={previousFile?.id}
                  file={previousFile}
                  getPreviewDimensions={getPreviewDimensions}
                  getPreviewGifBlob={getPreviewGifBlob}
                  showLoader={hasPrevious && !adjacentUrls.previous}
                />
              </div>
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={displayUrl}
                  alt={file?.name ?? "Image preview"}
                  fileId={file?.id}
                  file={file}
                  getPreviewDimensions={getPreviewDimensions}
                  getPreviewGifBlob={getPreviewGifBlob}
                  showLoader={showInitialLoader}
                  enablePinchZoom
                  onZoomActiveChange={handleCenterZoomActiveChange}
                  onCancelPendingTap={cancelPendingTapNav}
                />
              </div>
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={adjacentUrls.next}
                  alt={nextFile?.name ?? "Next image"}
                  fileId={nextFile?.id}
                  file={nextFile}
                  getPreviewDimensions={getPreviewDimensions}
                  getPreviewGifBlob={getPreviewGifBlob}
                  showLoader={hasNext && !adjacentUrls.next}
                />
              </div>
            </div>
          ) : null}

          <MobileImageViewportScrim />

          {error ? (
            <p
              className="pointer-events-none absolute inset-x-0 top-1/2 z-25 -translate-y-1/2 px-4 text-center text-sm text-red-400"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {loading && displayUrl ? (
            <div
              className="pointer-events-none absolute right-3 top-3 z-25 flex items-center gap-2 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-3 py-1.5 text-xs text-white"
              aria-live="polite"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : null}
        </div>
      ) : (
        <StaticImageStage
          displayUrl={displayUrl}
          file={file}
          error={error}
          loading={loading}
          showInitialLoader={showInitialLoader}
          getPreviewDimensions={getPreviewDimensions}
          getPreviewGifBlob={getPreviewGifBlob}
          onCancelPendingTap={cancelPendingTapNav}
        />
      )}

      {/* Human: Top chrome — position badge + close (Pencil Top Chrome Row). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-14 items-start justify-end px-4 pb-0 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center gap-2">
          {positionLabel ? (
            <span className="inline-flex h-8 items-center rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-2.5 text-[11px] text-[#FFFFFFCC]">
              {positionLabel}
            </span>
          ) : null}

          <DialogClose
            render={
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-full border border-[#FFFFFF1A] bg-[#00000099] text-white transition-colors hover:bg-black/80"
                aria-label="Close image preview"
              />
            }
          >
            <X className="size-4" aria-hidden />
          </DialogClose>
        </div>
      </div>

      {/* Human: Bottom metadata bar — filename, size, download/share (Pencil Translucent Bottom Bar). */}
      {file ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
          <div className="min-w-0 flex-1 pr-4">
            <p className="truncate text-[13px] font-bold text-white">{file.name}</p>
            <p className="text-[11px] text-[#FFFFFF99]">{sizeLabel}</p>
          </div>

          {(showDownloadAction || showShareAction) && (
            <div className="flex shrink-0 items-center gap-5">
              {showDownloadAction ? (
                <button
                  type="button"
                  onClick={() => onDownload?.(file)}
                  className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                  aria-label={`Download ${file.name}`}
                >
                  <Download className="size-[22px]" aria-hidden />
                </button>
              ) : null}

              {showShareAction ? (
                <button
                  type="button"
                  onClick={() => onShare?.(file)}
                  className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                  aria-label={`Share ${file.name}`}
                >
                  <Share2 className="size-[22px]" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
