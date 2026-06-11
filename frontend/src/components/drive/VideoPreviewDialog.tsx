// Human: HLS video lightbox — desktop player + mobile CSS orientation layouts (Safari-safe).
// Agent: FETCHES stream URL; ATTACHES hls.js; MOUNTS one surface via useIsDesktopPlayer; GALLERY swipe on narrow.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchPublicVideoStreamUrl, fetchVideoStreamUrl, getErrorMessage } from "@/api/client";
import { VideoPlayerSurface } from "@/components/drive/video/VideoPlayerSurface";
import { VideoPlayerSurfaceMobile } from "@/components/drive/video/VideoPlayerSurfaceMobile";
import { VideoVerticalGallery } from "@/components/drive/video/VideoVerticalGallery";
import { useHlsVideoAttach } from "@/hooks/useHlsVideoAttach";
import { useNarrowVideoLayout } from "@/hooks/useNarrowVideoLayout";
import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { videoDialogRowHeightClass } from "@/components/drive/video/video-dialog-viewport";
import { isVideoGallerySwipeZone } from "@/components/drive/video/video-gallery-swipe";
import { cn } from "@/lib/utils";

export type VideoPreviewDialogProps = {
  videos: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange?: (file: FileItem) => void;
  /** When set, stream-url and HLS segments use anonymous public share routes. */
  shareToken?: string;
  /** Visitor password for protected public shares — sent as X-Share-Password. */
  sharePassword?: string | null;
  /** Folder or library label shown in mobile immersive meta line. */
  folderLabel?: string | null;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

const SWIPE_THRESHOLD_PX = 48;

// Human: Resolve playlist/segment URLs against the site origin for hls.js XHR loads.
// Agent: RETURNS absolute href; CALLS window.location.origin for relative `/api/v1/...` paths.
function resolveStreamUrl(url: string): string {
  if (url.startsWith("http")) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return new URL(path, window.location.origin).href;
}

export function VideoPreviewDialog({
  videos,
  file,
  open,
  onOpenChange,
  onFileChange,
  shareToken,
  sharePassword,
  folderLabel,
  onDownload,
  onShare,
}: VideoPreviewDialogProps) {
  const isDesktop = useIsDesktopPlayer(open);
  const isNarrow = !isDesktop;

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Human: Safari — sync data-video-layout on viewport for video-* variants; default portrait until measured.
  // Agent: WRITES dataset + RETURNS layout; React attribute ensures first paint is portrait band, not full-width.
  const narrowLayout = useNarrowVideoLayout(viewportRef, open && isNarrow);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadingStream, setLoadingStream] = useState(false);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleVideoNodeChange = useCallback((node: HTMLVideoElement | null) => {
    setVideoElement(node);
  }, []);

  const handleHlsError = useCallback((message: string) => {
    setError(message);
  }, []);

  const currentIndex = useMemo(
    () => (file ? videos.findIndex((item) => item.id === file.id) : -1),
    [file, videos],
  );
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < videos.length - 1;
  const positionLabel =
    currentIndex >= 0 && videos.length > 1 ? `${currentIndex + 1} / ${videos.length}` : null;
  const showGalleryHint = isNarrow && videos.length > 1;
  // Human: Portrait phone — TikTok-style vertical gallery scroll between videos.
  // Agent: ENABLED when narrow + portrait layout + gallery; landscape phone keeps instant swipe.
  const useVerticalGalleryScroll =
    isNarrow &&
    narrowLayout === "portrait" &&
    videos.length > 1 &&
    Boolean(onFileChange);

  useEffect(() => {
    setStreamUrl(null);
    setError("");
    setVideoElement(null);
  }, [file?.id]);

  useEffect(() => {
    if (!open) setVideoElement(null);
  }, [open]);

  useEffect(() => {
    if (!open || !file?.id || !file.hls_ready) {
      setStreamUrl(null);
      return;
    }

    let cancelled = false;
    setLoadingStream(true);
    setError("");

    void (shareToken
      ? fetchPublicVideoStreamUrl(shareToken, file.id, sharePassword)
      : fetchVideoStreamUrl(file.id))
      .then((res) => {
        if (cancelled) return;
        if (!res.url) {
          setError(res.hls_encode_error ?? "Video is not ready for playback.");
          setStreamUrl(null);
          return;
        }
        setStreamUrl(resolveStreamUrl(res.url));
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingStream(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file?.id, file?.hls_ready, shareToken, sharePassword]);

  useHlsVideoAttach({
    video: videoElement,
    streamUrl,
    open,
    shareToken,
    sharePassword,
    onError: handleHlsError,
  });

  const goPrevious = useCallback(() => {
    if (!hasPrevious || !onFileChange) return;
    onFileChange(videos[currentIndex - 1]!);
  }, [currentIndex, hasPrevious, onFileChange, videos]);

  const goNext = useCallback(() => {
    if (!hasNext || !onFileChange) return;
    onFileChange(videos[currentIndex + 1]!);
  }, [currentIndex, hasNext, onFileChange, videos]);

  const goPreviousRef = useRef(goPrevious);
  const goNextRef = useRef(goNext);

  useEffect(() => {
    goPreviousRef.current = goPrevious;
    goNextRef.current = goNext;
  }, [goPrevious, goNext]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      viewportRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, file?.id]);

  useEffect(() => {
    if (!open) return;

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        goPreviousRef.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        goNextRef.current();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [open]);

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  };

  // Human: Mobile gallery — vertical swipe on portrait phone, horizontal on landscape phone.
  // Agent: ONLY tracks touches on video layer; chrome/seek bar excluded via isVideoGallerySwipeZone.
  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isNarrow || videos.length <= 1) return;
    if (!isVideoGallerySwipeZone(event.target)) return;
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, [isNarrow, videos.length]);

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isNarrow || videos.length <= 1 || !swipeStartRef.current) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - swipeStartRef.current.x;
      const deltaY = touch.clientY - swipeStartRef.current.y;
      swipeStartRef.current = null;

      const useVertical = narrowLayout === "portrait" && Math.abs(deltaY) >= Math.abs(deltaX);
      const delta = useVertical ? deltaY : deltaX;
      if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
      if (useVertical) {
        if (delta < 0) goNext();
        else goPrevious();
      } else if (delta > 0) {
        goPrevious();
      } else {
        goNext();
      }
    },
    [goNext, goPrevious, isNarrow, narrowLayout, videos.length],
  );

  const descriptionParts = [
    file?.name ?? "Video preview",
    positionLabel,
    "Encrypted HLS playback.",
    isNarrow ? "Swipe up or sideways to change videos." : null,
  ].filter(Boolean);

  const playerProps = {
    file: file!,
    videoRef,
    loading: loadingStream,
    error,
    onVideoNodeChange: handleVideoNodeChange,
    onDownload,
    onShare,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Human: Desktop shell — fixed row height min(1125px, 100dvh − padding) so player + nav always fit. */}
      {/* Agent: NARROW branch stays full-viewport; wide branch mirrors Excel DialogContent padding/overflow. */}
      <DialogContent
        motionlessPopup={isNarrow}
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-0 bg-transparent shadow-none ring-0",
          isNarrow
            ? "h-[100svh] max-h-[100svh] w-full min-h-0 rounded-none p-0 supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh"
            : "w-full max-w-[calc(100%-1rem)] items-center justify-center p-4 sm:max-w-[108rem]",
        )}
        overlayClassName={cn(
          "bg-[#0A0A10]/80 backdrop-blur-[40px]",
          isNarrow && "bg-[#0A0A10]/90 backdrop-blur-[48px]",
        )}
        showCloseButton={false}
        onKeyDown={handleContentKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Video preview"}</DialogTitle>
          <DialogDescription>{descriptionParts.join(" · ")}</DialogDescription>
        </DialogHeader>

        <div
          ref={viewportRef}
          data-video-layout={isNarrow ? narrowLayout : undefined}
          tabIndex={-1}
          className={cn(
            "flex w-full min-h-0 outline-none",
            isNarrow
              ? cn(
                  "min-h-0 flex-1 flex-col",
                  useVerticalGalleryScroll && "relative",
                )
              : cn(
                  videoDialogRowHeightClass,
                  "max-w-full shrink-0 items-stretch justify-center gap-6",
                ),
          )}
          aria-label="Video player"
          onTouchStart={useVerticalGalleryScroll ? undefined : handleTouchStart}
          onTouchEnd={useVerticalGalleryScroll ? undefined : handleTouchEnd}
        >
          {/* Human: Desktop — flanking chevrons per Pencil Ownly Video Player Normal. */}
          {isDesktop && videos.length > 1 ? (
            <button
              type="button"
              disabled={!hasPrevious}
              onClick={goPrevious}
              aria-label="Previous video"
              className="flex size-[5.625rem] shrink-0 items-center justify-center self-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="size-10" aria-hidden />
            </button>
          ) : null}

          {file && isDesktop ? (
            <div className="flex h-full min-h-0 flex-1 justify-center">
              <VideoPlayerSurface key={file.id} {...playerProps} />
            </div>
          ) : null}

          {file && isNarrow ? (
            useVerticalGalleryScroll ? (
              <VideoVerticalGallery
                videos={videos}
                currentIndex={currentIndex}
                hasPrevious={hasPrevious}
                hasNext={hasNext}
                goPrevious={goPrevious}
                goNext={goNext}
                activeFileId={file.id}
              >
                <VideoPlayerSurfaceMobile
                  key={file.id}
                  positionLabel={positionLabel}
                  folderLabel={folderLabel}
                  showGalleryHint={showGalleryHint}
                  {...playerProps}
                />
              </VideoVerticalGallery>
            ) : (
              <VideoPlayerSurfaceMobile
                key={file.id}
                positionLabel={positionLabel}
                folderLabel={folderLabel}
                showGalleryHint={showGalleryHint}
                {...playerProps}
              />
            )
          ) : null}

          {isDesktop && videos.length > 1 ? (
            <button
              type="button"
              disabled={!hasNext}
              onClick={goNext}
              aria-label="Next video"
              className="flex size-[5.625rem] shrink-0 items-center justify-center self-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="size-10" aria-hidden />
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
