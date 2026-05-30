// Human: HLS video lightbox — Pencil Ownly Video Player over blurred backdrop with folder gallery.
// Agent: FETCHES stream URL; ATTACHES hls.js; RENDERS VideoPlayerSurface; NAVIGATES sibling videos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchPublicVideoStreamUrl, fetchVideoStreamUrl, getErrorMessage } from "@/api/client";
import { VideoPlayerSurface } from "@/components/drive/video/VideoPlayerSurface";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadingStream, setLoadingStream] = useState(false);

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

  const descriptionParts = [
    file?.name ?? "Video preview",
    positionLabel,
    "Encrypted HLS playback.",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-1rem)] flex-col items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[1440px]"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
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
          className="flex w-full items-center justify-center gap-4 outline-none sm:gap-6"
          aria-label="Video player"
        >
          {videos.length > 1 ? (
            <button
              type="button"
              disabled={!hasPrevious}
              onClick={goPrevious}
              aria-label="Previous video"
              className={cn(
                "flex size-[3.75rem] shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30",
              )}
            >
              <ChevronLeft className="size-7" aria-hidden />
            </button>
          ) : (
            <div className="hidden w-[3.75rem] shrink-0 sm:block" aria-hidden />
          )}

          {file ? (
            <VideoPlayerSurface
              key={file.id}
              file={file}
              videoRef={videoRef}
              loading={loadingStream}
              error={error}
              onDownload={onDownload}
              onShare={onShare}
            />
          ) : null}

          {videos.length > 1 ? (
            <button
              type="button"
              disabled={!hasNext}
              onClick={goNext}
              aria-label="Next video"
              className={cn(
                "flex size-[3.75rem] shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30",
              )}
            >
              <ChevronRight className="size-7" aria-hidden />
            </button>
          ) : (
            <div className="hidden w-[3.75rem] shrink-0 sm:block" aria-hidden />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
