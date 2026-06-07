// Human: Mobile image lightbox — Pencil MV Mobile Portrait Image Vertical / Letterbox full-bleed overlay.
// Agent: READS ImagePreviewControllerViewModel; SWIPES horizontal carousel with elastic snap; TAP halves navigate.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { resolveImageFitMode } from "@/components/drive/image/image-preview-layout";
import type { ImageFitMode } from "@/components/drive/image/image-preview-types";
import type { ImagePreviewControllerViewModel } from "@/components/drive/image/useImagePreviewController";
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
const GALLERY_SNAP_TRANSITION_MS = 280;
const GALLERY_SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

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

type ImageGallerySlideProps = {
  url: string | null;
  alt: string;
  fitMode: ImageFitMode;
  onFitModeChange: (mode: ImageFitMode) => void;
  showLoader?: boolean;
};

// Human: One carousel panel — same vertical / letterbox layout as the active slide.
// Agent: READS url; WRITES fitMode via onLoad when this panel's image dimensions are known.
function ImageGallerySlide({
  url,
  alt,
  fitMode,
  onFitModeChange,
  showLoader = false,
}: ImageGallerySlideProps) {
  const isLetterbox = fitMode === "letterbox";

  const handleImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      onFitModeChange(resolveImageFitMode(img.naturalWidth, img.naturalHeight));
    },
    [onFitModeChange],
  );

  return (
    <div
      className={cn(
        "relative flex h-full shrink-0 items-center justify-center bg-black",
        isLetterbox
          ? "aspect-[390/220] w-full max-h-[min(220px,42dvh)] min-h-[180px] max-w-[min(100%,390px)]"
          : "h-full w-full",
      )}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          onLoad={handleImageLoad}
          className={cn("size-full", isLetterbox ? "object-contain" : "object-cover")}
          draggable={false}
        />
      ) : showLoader ? (
        <Loader2 className="size-7 animate-spin text-white/50" aria-hidden />
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-[#000000CC] to-transparent",
          isLetterbox ? "h-14" : "h-[120px]",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#000000CC] to-transparent",
          isLetterbox ? "h-[72px]" : "h-[120px]",
        )}
        aria-hidden
      />
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
  onImageLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
};

// Human: Single-image layout when the folder has only one image (no carousel track).
function StaticImageStage({
  displayUrl,
  file,
  error,
  loading,
  showInitialLoader,
  imageFit,
  onImageLoad,
}: StaticImageStageProps) {
  const isLetterbox = imageFit === "letterbox";

  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center bg-black",
        isLetterbox
          ? "aspect-[390/220] w-full max-h-[min(220px,42dvh)] min-h-[180px] max-w-[min(100%,390px)] shrink-0"
          : "absolute inset-0",
      )}
    >
      {displayUrl ? (
        <img
          key={displayUrl}
          src={displayUrl}
          alt={file?.name ?? "Image preview"}
          onLoad={onImageLoad}
          className={cn("size-full", isLetterbox ? "object-contain" : "object-cover")}
          draggable={false}
        />
      ) : null}

      {error ? (
        <p
          className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4 text-center text-sm text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {showInitialLoader ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
          <Loader2 className="size-7 animate-spin text-white/80" aria-hidden />
          <span className="sr-only">Loading image…</span>
        </div>
      ) : null}

      {loading && displayUrl ? (
        <div
          className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-3 py-1.5 text-xs text-white"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-[#000000CC] to-transparent",
          isLetterbox ? "h-14" : "h-[120px]",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#000000CC] to-transparent",
          isLetterbox ? "h-[72px]" : "h-[120px]",
        )}
        aria-hidden
      />
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
  } = vm;

  const galleryRef = useRef<HTMLDivElement>(null);
  const touchSessionRef = useRef<TouchSession | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);
  const pendingCommitRef = useRef<"previous" | "next" | null>(null);
  // Human: Skip the file-change reset while a swipe commit recenters the track in transitionEnd.
  const suppressFileChangeResetRef = useRef(false);

  const [containerWidth, setContainerWidth] = useState(0);
  const [trackX, setTrackX] = useState(0);
  const [enableTransition, setEnableTransition] = useState(true);
  const [centerFit, setCenterFit] = useState<ImageFitMode>("vertical");
  const [prevFit, setPrevFit] = useState<ImageFitMode>("vertical");
  const [nextFit, setNextFit] = useState<ImageFitMode>("vertical");
  const [staticFit, setStaticFit] = useState<ImageFitMode>("vertical");

  const swipeCommitThresholdPx =
    containerWidth > 0
      ? Math.min(containerWidth * SWIPE_COMMIT_THRESHOLD_RATIO, SWIPE_COMMIT_THRESHOLD_MAX_PX)
      : SWIPE_COMMIT_THRESHOLD_MAX_PX;

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

  // Human: Keep the track centered on the active slide when the file or width changes (tap/keyboard).
  // Agent: SKIPS during swipe commit — transitionEnd flushSync updates slides before recentering trackX.
  useEffect(() => {
    if (!showGalleryNav || containerWidth <= 0 || suppressFileChangeResetRef.current) return;
    pendingCommitRef.current = null;
    setEnableTransition(false);
    setTrackX(-containerWidth);
    setCenterFit("vertical");
    requestAnimationFrame(() => setEnableTransition(true));
  }, [file?.id, containerWidth, showGalleryNav]);

  const handleStaticImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
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

      setEnableTransition(true);

      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;
      const elapsed = Date.now() - session.startTime;
      const rest = -containerWidth;

      if (
        !cancelled &&
        Math.abs(deltaX) < TAP_MAX_MOVEMENT_PX &&
        Math.abs(deltaY) < TAP_MAX_MOVEMENT_PX &&
        elapsed < TAP_MAX_DURATION_MS
      ) {
        const rect = galleryRef.current?.getBoundingClientRect();
        if (rect) {
          const tapX = touch.clientX - rect.left;
          if (tapX < rect.width / 2) {
            if (hasPrevious) goPrevious();
          } else if (hasNext) {
            goNext();
          }
        }
        setTrackX(rest);
        isHorizontalSwipeRef.current = null;
        return;
      }

      if (isHorizontalSwipeRef.current === false || cancelled) {
        setTrackX(rest);
        isHorizontalSwipeRef.current = null;
        return;
      }

      if (deltaX < -swipeCommitThresholdPx && hasNext) {
        pendingCommitRef.current = "next";
        setTrackX(-2 * containerWidth);
      } else if (deltaX > swipeCommitThresholdPx && hasPrevious) {
        pendingCommitRef.current = "previous";
        setTrackX(0);
      } else {
        setTrackX(rest);
      }

      isHorizontalSwipeRef.current = null;
    },
    [
      containerWidth,
      goNext,
      goPrevious,
      hasNext,
      hasPrevious,
      showGalleryNav,
      swipeCommitThresholdPx,
    ],
  );

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!showGalleryNav || containerWidth <= 0) return;
      const touch = event.touches[0];
      if (!touch) return;

      touchSessionRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        startTrackX: trackX,
      };
      isHorizontalSwipeRef.current = null;
      setEnableTransition(false);
    },
    [containerWidth, showGalleryNav, trackX],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
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
      setTrackX(applyEdgeResistance(session.startTrackX + deltaX));
    },
    [applyEdgeResistance, containerWidth, showGalleryNav],
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

  const handleTrackTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "transform") return;

      const commit = pendingCommitRef.current;
      if (!commit || containerWidth <= 0) return;

      pendingCommitRef.current = null;
      suppressFileChangeResetRef.current = true;
      setEnableTransition(false);

      // Human: Apply the new slide URLs before recentering — otherwise trackX jumps back to the old center image.
      // Agent: flushSync CALLS goNext/goPrevious; THEN setTrackX(-containerWidth) with transition disabled.
      flushSync(() => {
        if (commit === "next") {
          goNext();
        } else {
          goPrevious();
        }
      });

      setTrackX(-containerWidth);
      suppressFileChangeResetRef.current = false;
      requestAnimationFrame(() => setEnableTransition(true));
    },
    [containerWidth, goNext, goPrevious],
  );

  const trackStyle: CSSProperties = {
    width: containerWidth > 0 ? containerWidth * 3 : "300%",
    transform: `translate3d(${trackX}px, 0, 0)`,
    transition: enableTransition
      ? `transform ${GALLERY_SNAP_TRANSITION_MS}ms ${GALLERY_SNAP_EASING}`
      : "none",
  };

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
              className="flex h-full will-change-transform"
              style={trackStyle}
              onTransitionEnd={handleTrackTransitionEnd}
            >
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={adjacentUrls.previous}
                  alt="Previous image"
                  fitMode={prevFit}
                  onFitModeChange={setPrevFit}
                  showLoader={hasPrevious && !adjacentUrls.previous}
                />
              </div>
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={displayUrl}
                  alt={file?.name ?? "Image preview"}
                  fitMode={centerFit}
                  onFitModeChange={setCenterFit}
                  showLoader={showInitialLoader}
                />
              </div>
              <div style={{ width: containerWidth }} className="h-full shrink-0">
                <ImageGallerySlide
                  url={adjacentUrls.next}
                  alt="Next image"
                  fitMode={nextFit}
                  onFitModeChange={setNextFit}
                  showLoader={hasNext && !adjacentUrls.next}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4 text-center text-sm text-red-400"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {loading && displayUrl ? (
            <div
              className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-3 py-1.5 text-xs text-white"
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
          onImageLoad={handleStaticImageLoad}
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
