// Human: Mobile image lightbox — Pencil MV Mobile Portrait Image Vertical / Letterbox full-bleed overlay.
// Agent: READS ImagePreviewControllerViewModel; SWIPES carousel; PINCH-ZOOM on active slide via useMobileImagePinchZoom.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { MOBILE_IMAGE_LETTERBOX_STAGE_CLASS, resolveImageFitFromElement, resolveImageFitMode } from "@/components/drive/image/image-preview-layout";
import type { ImageFitMode } from "@/components/drive/image/image-preview-types";
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
  fitMode: ImageFitMode;
  onFitModeChange: (mode: ImageFitMode) => void;
  showLoader?: boolean;
  enablePinchZoom?: boolean;
  onZoomActiveChange?: (active: boolean) => void;
  onCancelPendingTap?: () => void;
};

// Human: One carousel panel — same vertical / letterbox layout as the active slide.
// Agent: READS url; WRITES fitMode via onLoad; optional PINCH-ZOOM when enablePinchZoom on center slide.
function ImageGallerySlide({
  url,
  alt,
  fitMode,
  onFitModeChange,
  showLoader = false,
  enablePinchZoom = false,
  onZoomActiveChange,
  onCancelPendingTap,
}: ImageGallerySlideProps) {
  const isLetterbox = fitMode === "letterbox";

  const pinchZoom = useMobileImagePinchZoom({
    resetKey: enablePinchZoom ? (url ?? "empty") : "gallery-slide-no-zoom",
    onCancelPendingTap: enablePinchZoom ? onCancelPendingTap : undefined,
    onZoomActiveChange: enablePinchZoom ? onZoomActiveChange : undefined,
  });

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      onFitModeChange(resolveImageFitMode(img.naturalWidth, img.naturalHeight));
    },
    [onFitModeChange],
  );

  const handleImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      const fit = resolveImageFitFromElement(node);
      if (fit) onFitModeChange(fit);
    },
    [onFitModeChange],
  );

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      {/* Human: Letterbox uses a centered band; vertical fills the full slide behind the flex host. */}
      {/* Agent: OUTER flex host READS h-full; INNER stage SWITCHES letterbox band vs absolute inset-0. */}
      <div
        className={cn(
          "relative overflow-hidden",
          isLetterbox ? MOBILE_IMAGE_LETTERBOX_STAGE_CLASS : "absolute inset-0",
        )}
      >
        <div
          ref={pinchZoom.layerRef}
          className={cn("size-full origin-center", enablePinchZoom && "touch-none")}
          {...(enablePinchZoom ? pinchZoom.touchHandlers : {})}
        >
          {url ? (
            // Human: Blobs are prefetched in the controller — async decode keeps touch handling responsive.
            // Agent: READS warmed blob URL; RENDERS with eager load but without sync main-thread decode.
            <img
              ref={handleImageRef}
              src={url}
              alt={alt}
              loading="eager"
              decoding="async"
              onLoad={handleImageLoad}
              className={cn("size-full", isLetterbox ? "object-contain" : "object-cover")}
              draggable={false}
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
  imageFit: ImageFitMode;
  onResolveFitFromImage: (img: HTMLImageElement) => void;
  onCancelPendingTap?: () => void;
};

// Human: Single-image layout when the folder has only one image (no carousel track).
function StaticImageStage({
  displayUrl,
  file,
  error,
  loading,
  showInitialLoader,
  imageFit,
  onResolveFitFromImage,
  onCancelPendingTap,
}: StaticImageStageProps) {
  const isLetterbox = imageFit === "letterbox";

  const pinchZoom = useMobileImagePinchZoom({
    resetKey: displayUrl ?? file?.id ?? "static-empty",
    onCancelPendingTap,
  });

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      onResolveFitFromImage(event.currentTarget);
    },
    [onResolveFitFromImage],
  );

  const handleImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node?.complete || node.naturalWidth <= 0) return;
      onResolveFitFromImage(node);
    },
    [onResolveFitFromImage],
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <div
        className={cn(
          "relative overflow-hidden",
          isLetterbox ? MOBILE_IMAGE_LETTERBOX_STAGE_CLASS : "absolute inset-0",
        )}
      >
        <div
          ref={pinchZoom.layerRef}
          className="size-full origin-center touch-none"
          {...pinchZoom.touchHandlers}
        >
          {displayUrl ? (
            <img
              key={displayUrl}
              ref={handleImageRef}
              src={displayUrl}
              alt={file?.name ?? "Image preview"}
              onLoad={handleImageLoad}
              className={cn("size-full", isLetterbox ? "object-contain" : "object-cover")}
              draggable={false}
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
  const [staticFit, setStaticFit] = useState<ImageFitMode>("vertical");
  // Human: Remember letterbox vs vertical per file so swipes do not rescale when a slide becomes center.
  // Agent: WRITES on img load in any carousel panel; READS when file id moves between prev/center/next slots.
  const fitCacheRef = useRef<Map<string, ImageFitMode>>(new Map());
  const [fitRevision, setFitRevision] = useState(0);

  const getFitModeForFile = useCallback(
    (fileId: string | undefined): ImageFitMode => {
      if (!fileId) return "vertical";
      const cached = fitCacheRef.current.get(fileId);
      if (cached) return cached;
      const dimensions = getPreviewDimensions(fileId);
      if (dimensions) {
        return resolveImageFitMode(dimensions.width, dimensions.height);
      }
      return "vertical";
    },
    [fitRevision, getPreviewDimensions],
  );

  const rememberFitModeForFile = useCallback((fileId: string, mode: ImageFitMode) => {
    if (fitCacheRef.current.get(fileId) === mode) return;
    fitCacheRef.current.set(fileId, mode);
    setFitRevision((value) => value + 1);
  }, []);

  const handlePreviousFitModeChange = useCallback(
    (mode: ImageFitMode) => {
      if (!previousFile) return;
      rememberFitModeForFile(previousFile.id, mode);
    },
    [previousFile, rememberFitModeForFile],
  );

  const handleCenterFitModeChange = useCallback(
    (mode: ImageFitMode) => {
      if (!file?.id) return;
      rememberFitModeForFile(file.id, mode);
    },
    [file?.id, rememberFitModeForFile],
  );

  const handleNextFitModeChange = useCallback(
    (mode: ImageFitMode) => {
      if (!nextFile) return;
      rememberFitModeForFile(nextFile.id, mode);
    },
    [nextFile, rememberFitModeForFile],
  );

  // Human: Apply letterbox vs vertical from downscaled metadata before the carousel img decodes.
  // Agent: READS getPreviewDimensions; WRITES fitCacheRef when source dimensions arrive from the controller.
  useEffect(() => {
    for (const item of [file, previousFile, nextFile]) {
      if (!item?.id) continue;
      const dimensions = getPreviewDimensions(item.id);
      if (!dimensions) continue;
      rememberFitModeForFile(item.id, resolveImageFitMode(dimensions.width, dimensions.height));
    }
  }, [file, previousFile, nextFile, getPreviewDimensions, rememberFitModeForFile]);

  const swipeCommitThresholdPx =
    containerWidth > 0
      ? Math.min(containerWidth * SWIPE_COMMIT_THRESHOLD_RATIO, SWIPE_COMMIT_THRESHOLD_MAX_PX)
      : SWIPE_COMMIT_THRESHOLD_MAX_PX;

  // Human: Drive transform on the DOM during gestures — avoids React re-renders every touchmove frame.
  // Agent: WRITES trackRef.style.transform; READS trackPositionRef for snap targets and commit logic.
  const applyTrackTransform = useCallback(
    (nextX: number, options?: { animate?: boolean; durationMs?: number }) => {
      const track = trackRef.current;
      if (!track) return;

      const roundedX = Math.round(nextX);
      const previousX = trackPositionRef.current;
      trackPositionRef.current = roundedX;

      if (options?.animate) {
        const duration = options.durationMs ?? snapDurationMs(roundedX - previousX);
        track.style.transition = `transform ${duration}ms ${GALLERY_SNAP_EASING}`;
        track.style.willChange = "transform";
      } else {
        track.style.transition = "none";
        track.style.willChange = "";
      }

      track.style.transform = `translate3d(${roundedX}px, 0, 0)`;
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

  const resolveStaticFit = useCallback((img: HTMLImageElement) => {
    setStaticFit(resolveImageFitMode(img.naturalWidth, img.naturalHeight));
  }, []);

  useEffect(() => {
    setStaticFit("vertical");
  }, [file?.id]);

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
      if (event.propertyName !== "transform") return;
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
              className="flex h-full [backface-visibility:hidden] [transform:translate3d(0,0,0)]"
              style={trackWidthStyle}
            >
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={adjacentUrls.previous}
                  alt={previousFile?.name ?? "Previous image"}
                  fitMode={getFitModeForFile(previousFile?.id)}
                  onFitModeChange={handlePreviousFitModeChange}
                  showLoader={hasPrevious && !adjacentUrls.previous}
                />
              </div>
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={displayUrl}
                  alt={file?.name ?? "Image preview"}
                  fitMode={getFitModeForFile(file?.id)}
                  onFitModeChange={handleCenterFitModeChange}
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
                  fitMode={getFitModeForFile(nextFile?.id)}
                  onFitModeChange={handleNextFitModeChange}
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
          imageFit={staticFit}
          onResolveFitFromImage={resolveStaticFit}
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
