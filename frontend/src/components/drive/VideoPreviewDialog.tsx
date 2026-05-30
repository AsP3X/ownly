// Human: HLS video lightbox — desktop Pencil player + mobile portrait/landscape from login-signup.pencil.
// Agent: FETCHES stream URL; ATTACHES hls.js; SWITCHES layout via useVideoPlayerLayout; GALLERY swipe on mobile.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchPublicVideoStreamUrl, fetchVideoStreamUrl, getErrorMessage } from "@/api/client";
import { VideoPlayerSurface } from "@/components/drive/video/VideoPlayerSurface";
import { VideoPlayerSurfaceMobile } from "@/components/drive/video/VideoPlayerSurfaceMobile";
import { useVideoPlayerLayout } from "@/hooks/useVideoPlayerLayout";
import {
  attachHlsErrorHandler,
  attachVodSeekRecovery,
  createHlsInstance,
  isHlsStreamUrl,
} from "@/lib/hls-player";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type VideoPreviewDialogProps = {
  videos: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange?: (file: FileItem) => void;
  /** When set, stream-url and HLS segments use anonymous public share routes. */
  shareToken?: string;
  /** Visitor password for protected public shares — sent as X-Share-Password. */
  sharePassword?: string | null;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

const SWIPE_THRESHOLD_PX = 48;

function getToken(): string | null {
  return localStorage.getItem("mediavault_token");
}

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
  onDownload,
  onShare,
}: VideoPreviewDialogProps) {
  const layout = useVideoPlayerLayout();
  const isMobile = layout !== "desktop";
  const isMobileLandscape = layout === "mobile-landscape";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadingStream, setLoadingStream] = useState(false);
  const swipeStartXRef = useRef<number | null>(null);

  const currentIndex = useMemo(
    () => (file ? videos.findIndex((item) => item.id === file.id) : -1),
    [file, videos],
  );
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < videos.length - 1;
  const positionLabel =
    currentIndex >= 0 && videos.length > 1 ? `${currentIndex + 1} of ${videos.length}` : null;

  useEffect(() => {
    setStreamUrl(null);
    setError("");
  }, [file?.id]);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || !open) return;

    let hls: Hls | null = null;
    let disposed = false;
    let detachSeek: (() => void) | undefined;

    const isActive = () => !disposed;

    if (isHlsStreamUrl(streamUrl) && Hls.isSupported()) {
      hls = createHlsInstance((xhr) => {
        if (shareToken && sharePassword) {
          xhr.setRequestHeader("X-Share-Password", sharePassword);
          return;
        }
        if (shareToken) return;
        const token = getToken();
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      attachHlsErrorHandler(hls, video, isActive, (message) => {
        if (!disposed) setError(message);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          console.warn("[hls]", data.type, data.details, data);
        }
      });
      detachSeek = attachVodSeekRecovery(hls, video, isActive);
    } else if (isHlsStreamUrl(streamUrl) && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
    } else if (isHlsStreamUrl(streamUrl)) {
      setError("This browser cannot play HLS video.");
    } else {
      video.src = streamUrl;
    }

    return () => {
      disposed = true;
      detachSeek?.();
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl, open, shareToken, sharePassword]);

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

  const viewportRef = useRef<HTMLDivElement>(null);

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

  // Human: Mobile gallery — horizontal swipe on the player viewport (no side chevrons on narrow screens).
  // Agent: READS touchstart clientX; on touchend CALLS goPrevious/goNext when delta exceeds threshold.
  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || videos.length <= 1) return;
    swipeStartXRef.current = event.touches[0]?.clientX ?? null;
  }, [isMobile, videos.length]);

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isMobile || videos.length <= 1 || swipeStartXRef.current === null) return;
      const endX = event.changedTouches[0]?.clientX;
      if (endX === undefined) return;
      const delta = endX - swipeStartXRef.current;
      swipeStartXRef.current = null;
      if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
      if (delta > 0) goPrevious();
      else goNext();
    },
    [goNext, goPrevious, isMobile, videos.length],
  );

  const descriptionParts = [
    file?.name ?? "Video preview",
    positionLabel,
    "Encrypted HLS playback.",
    isMobile ? "Swipe left or right to change videos." : null,
  ].filter(Boolean);

  const playerProps = {
    file: file!,
    videoRef,
    loading: loadingStream,
    error,
    onDownload,
    onShare,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col items-center justify-center gap-0 overflow-visible border-0 bg-transparent shadow-none ring-0",
          isMobile
            ? "fixed inset-0 top-0 left-0 h-dvh max-h-dvh w-full max-w-none -translate-x-0 -translate-y-0 rounded-none p-0"
            : "w-full max-w-[calc(100%-1rem)] p-4 sm:max-w-[1440px]",
        )}
        overlayClassName={cn(
          "bg-[#0A0A10]/80 backdrop-blur-2xl",
          isMobile && "bg-[#0A0A10]/90 backdrop-blur-3xl",
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
          tabIndex={-1}
          className={cn(
            "flex w-full outline-none",
            isMobileLandscape
              ? "min-h-0 flex-1 flex-col"
              : isMobile
                ? "flex-1 flex-col items-center justify-center px-0"
                : "items-center justify-center gap-4 sm:gap-6",
          )}
          aria-label="Video player"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Human: Desktop — flanking chevrons per Pencil Ownly Video Player Normal. */}
          {!isMobile && videos.length > 1 ? (
            <button
              type="button"
              disabled={!hasPrevious}
              onClick={goPrevious}
              aria-label="Previous video"
              className="flex size-[3.75rem] shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="size-7" aria-hidden />
            </button>
          ) : null}

          {file && layout === "desktop" ? (
            <VideoPlayerSurface key={file.id} {...playerProps} />
          ) : null}

          {file && layout !== "desktop" ? (
            <VideoPlayerSurfaceMobile
              key={file.id}
              layout={layout}
              positionLabel={positionLabel}
              {...playerProps}
            />
          ) : null}

          {!isMobile && videos.length > 1 ? (
            <button
              type="button"
              disabled={!hasNext}
              onClick={goNext}
              aria-label="Next video"
              className="flex size-[3.75rem] shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="size-7" aria-hidden />
            </button>
          ) : null}
        </div>

        {/* Human: Portrait gallery footer — landscape relies on swipe only (control bar sits at bottom). */}
        {isMobile && !isMobileLandscape && videos.length > 1 ? (
          <div className="flex shrink-0 items-center justify-center gap-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
            <button
              type="button"
              disabled={!hasPrevious}
              onClick={goPrevious}
              aria-label="Previous video"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white disabled:opacity-30"
            >
              Previous
            </button>
            {positionLabel ? (
              <span className="text-xs tabular-nums text-[#E5E7EB]">{positionLabel}</span>
            ) : null}
            <button
              type="button"
              disabled={!hasNext}
              onClick={goNext}
              aria-label="Next video"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white disabled:opacity-30"
            >
              Next
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
