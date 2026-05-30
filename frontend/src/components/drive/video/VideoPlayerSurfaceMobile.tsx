// Human: Pencil mobile video player — portrait immersive band + landscape full-bleed with gradient overlays.
// Agent: READS layout + videoRef; USES useVideoTransport with video-native fullscreen; immersive CSS fallback.

import { useRef, type RefObject } from "react";
import {
  Download,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { FileItem } from "@/api/client";
import type { VideoPlayerLayout } from "@/hooks/useVideoPlayerLayout";
import { VideoSeekBar } from "@/components/drive/video/VideoSeekBar";
import { useVideoTransport } from "@/components/drive/video/useVideoTransport";
import { formatVideoTime } from "@/components/drive/video/video-time";
import { DialogClose } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type VideoPlayerSurfaceMobileProps = {
  layout: Extract<VideoPlayerLayout, "mobile-portrait" | "mobile-landscape">;
  file: FileItem;
  videoRef: RefObject<HTMLVideoElement | null>;
  loading?: boolean;
  error?: string;
  positionLabel?: string | null;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

export function VideoPlayerSurfaceMobile({
  layout,
  file,
  videoRef,
  loading = false,
  error = "",
  positionLabel,
  onDownload,
  onShare,
}: VideoPlayerSurfaceMobileProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const isPortraitLayout = layout === "mobile-portrait";

  const {
    isPlaying,
    progress,
    duration,
    bufferedSegments,
    muted,
    isFullscreen,
    isImmersive,
    transportDisabled,
    failed,
    chromeVisible,
    revealChrome,
    togglePlay,
    handleSeek,
    toggleMute,
    toggleFullscreen,
  } = useVideoTransport({
    videoRef,
    file,
    loading,
    error,
    fullscreenTargetRef: shellRef,
    preferVideoElementFullscreen: true,
  });

  // Human: Landscape wireframe OR immersive fallback — full-bleed chrome with volume + wide seek.
  // Agent: isImmersive when native fullscreen API fails (common inside modal on mobile WebKit).
  const useLandscapeChrome = !isPortraitLayout || isImmersive;

  const timeLabel = `${formatVideoTime(progress)} / ${formatVideoTime(duration)}`;
  const metaLabel = `${file.name} • ${formatBytes(file.size_bytes)}`;
  const showCenterPlay = !isPlaying && !loading && !error && file.hls_ready;
  const showDownloadAction = Boolean(onDownload);
  const showShareAction = Boolean(onShare);

  const seekVariant = useLandscapeChrome ? "mobile-landscape" : "mobile-portrait";

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative w-full touch-manipulation",
        isImmersive &&
          "fixed inset-0 z-[60] flex min-h-0 flex-1 flex-col bg-black",
        !isImmersive &&
          useLandscapeChrome &&
          "flex h-full min-h-0 w-full flex-1 flex-col bg-black",
        !isImmersive &&
          !useLandscapeChrome &&
          "mx-auto aspect-[390/220] max-h-[min(220px,42dvh)] min-h-[180px] max-w-[390px] overflow-hidden bg-black",
        isFullscreen && !isImmersive && "max-h-none max-w-none rounded-none",
      )}
      onPointerMove={revealChrome}
    >
      <video
        ref={videoRef}
        className={cn(
          "size-full bg-black object-contain",
          useLandscapeChrome && "min-h-0 flex-1",
        )}
        playsInline
        onClick={togglePlay}
      />

      {useLandscapeChrome ? (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[120px] bg-gradient-to-b from-[#000000B3] to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[150px] bg-gradient-to-t from-[#000000B3] to-transparent"
            aria-hidden
          />
        </>
      ) : null}

      {error ? (
        <p
          className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4 text-center text-sm text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {failed && !error ? (
        <p className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4 text-center text-sm text-red-400">
          {file.hls_encode_error ?? "Video processing failed."}
        </p>
      ) : null}

      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/50 text-sm text-white">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading stream…
        </div>
      ) : null}

      {showCenterPlay ? (
        <button
          type="button"
          onClick={togglePlay}
          disabled={transportDisabled}
          aria-label="Play video"
          className={cn(
            "absolute left-1/2 top-1/2 z-20 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#FFFFFF40] bg-[#FFFFFF20] text-white backdrop-blur-md transition hover:bg-[#FFFFFF30] disabled:opacity-40",
            !chromeVisible && "opacity-0",
          )}
        >
          <Play className="ml-0.5 size-[18px]" fill="currentColor" aria-hidden />
        </button>
      ) : null}

      <div
        className={cn(
          "absolute left-4 top-4 z-30 flex max-w-[calc(100%-5rem)] items-center gap-2 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-3 py-1.5 text-white backdrop-blur-sm transition-opacity duration-200",
          useLandscapeChrome && "left-6 top-6 bg-[#000000B3] px-4 py-2",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <p
          className={cn(
            "min-w-0 truncate font-bold",
            useLandscapeChrome ? "text-xs font-medium" : "text-[11px]",
          )}
        >
          {metaLabel}
        </p>
        {positionLabel ? (
          <span className="shrink-0 text-[10px] text-[#E5E7EB]">{positionLabel}</span>
        ) : null}
        {(showDownloadAction || showShareAction) && useLandscapeChrome ? (
          <div className="flex shrink-0 items-center gap-1 border-l border-white/20 pl-2">
            {showDownloadAction ? (
              <button
                type="button"
                onClick={() => onDownload?.(file)}
                className="rounded p-1 hover:bg-white/10"
                aria-label={`Download ${file.name}`}
              >
                <Download className="size-3.5" aria-hidden />
              </button>
            ) : null}
            {showShareAction ? (
              <button
                type="button"
                onClick={() => onShare?.(file)}
                className="rounded p-1 hover:bg-white/10"
                aria-label={`Share ${file.name}`}
              >
                <Share2 className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <DialogClose
        render={
          <button
            type="button"
            className={cn(
              "absolute right-4 top-4 z-30 flex size-8 items-center justify-center rounded-full border border-[#FFFFFF1A] bg-[#00000099] text-white backdrop-blur-sm transition hover:bg-black/80",
              useLandscapeChrome && "right-6 top-6 bg-[#000000B3]",
              chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-label="Close video preview"
          />
        }
      >
        <X className="size-3.5" aria-hidden />
      </DialogClose>

      <div
        className={cn(
          "absolute z-30 transition-opacity duration-200",
          useLandscapeChrome ? "bottom-6 left-6 right-6" : "inset-x-4 bottom-4",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between border border-[#FFFFFF1A] bg-[#000000B3] backdrop-blur-md",
            useLandscapeChrome
              ? "h-14 gap-4 rounded-2xl px-4"
              : "h-12 gap-2 rounded-xl px-4",
          )}
        >
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={transportDisabled}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="text-white disabled:opacity-40"
            >
              {isPlaying ? (
                <Pause
                  className={useLandscapeChrome ? "size-5" : "size-3.5"}
                  fill="currentColor"
                  aria-hidden
                />
              ) : (
                <Play
                  className={useLandscapeChrome ? "size-5" : "size-3.5"}
                  fill="currentColor"
                  aria-hidden
                />
              )}
            </button>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                useLandscapeChrome ? "text-xs text-white" : "text-[11px] text-[#E5E7EB]",
              )}
            >
              {timeLabel}
            </span>
          </div>

          <VideoSeekBar
            variant={seekVariant}
            progress={progress}
            duration={duration}
            bufferedSegments={bufferedSegments}
            disabled={transportDisabled}
            onSeek={handleSeek}
            className={useLandscapeChrome ? "min-w-0 flex-1" : undefined}
          />

          <div className="flex shrink-0 items-center gap-3">
            {useLandscapeChrome ? (
              <button
                type="button"
                onClick={toggleMute}
                disabled={transportDisabled}
                aria-label={muted ? "Unmute" : "Mute"}
                className="text-white disabled:opacity-40"
              >
                {muted ? (
                  <VolumeX className="size-5" aria-hidden />
                ) : (
                  <Volume2 className="size-5" aria-hidden />
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleFullscreen}
              disabled={transportDisabled}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="text-white disabled:opacity-40"
            >
              {isFullscreen ? (
                <Minimize className={useLandscapeChrome ? "size-5" : "size-3.5"} aria-hidden />
              ) : (
                <Maximize className={useLandscapeChrome ? "size-5" : "size-3.5"} aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
