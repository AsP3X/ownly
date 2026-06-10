// Human: Pencil mobile video player — portrait/landscape via CSS orientation (Safari-safe), not JS layout state.
// Agent: READS videoRef; USES useVideoTransport; video-landscape/portrait variants follow data-video-layout on ancestor.

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
import { VideoSeekBar } from "@/components/drive/video/VideoSeekBar";
import { useVideoTransport } from "@/components/drive/video/useVideoTransport";
import { formatVideoTime } from "@/components/drive/video/video-time";
import { DialogClose } from "@/components/ui/dialog";
import {
  resolveVideoAspectRatioStyle,
  videoMobileLandscapeVideoShellClass,
  videoMobileVerticalVideoShellClass,
} from "@/components/drive/video/video-player-layout";
import { useVideoNaturalSize } from "@/hooks/useVideoNaturalSize";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type VideoPlayerSurfaceMobileProps = {
  file: FileItem;
  videoRef: RefObject<HTMLVideoElement | null>;
  loading?: boolean;
  error?: string;
  positionLabel?: string | null;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

export function VideoPlayerSurfaceMobile({
  file,
  videoRef,
  loading = false,
  error = "",
  positionLabel,
  onDownload,
  onShare,
}: VideoPlayerSurfaceMobileProps) {
  const shellRef = useRef<HTMLDivElement>(null);

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

  const timeLabel = `${formatVideoTime(progress)} / ${formatVideoTime(duration)}`;
  const metaLabel = `${file.name} • ${formatBytes(file.size_bytes)}`;
  const showCenterPlay = !isPlaying && !loading && !error && file.hls_ready;
  const showDownloadAction = Boolean(onDownload);
  const showShareAction = Boolean(onShare);

  // Human: Portrait phone + vertical source — taller column instead of the landscape preview band.
  // Agent: READS useVideoNaturalSize; video-landscape still full-bleeds regardless of source orientation.
  const naturalSize = useVideoNaturalSize(videoRef, file.id);
  const isVerticalVideo = naturalSize?.isVertical ?? false;
  const shellAspectStyle = naturalSize
    ? resolveVideoAspectRatioStyle(naturalSize.width, naturalSize.height)
    : undefined;

  return (
    <div
      ref={shellRef}
      data-video-orientation={isVerticalVideo ? "vertical" : "horizontal"}
      style={isFullscreen ? undefined : shellAspectStyle}
      className={cn(
        "relative w-full shrink-0 touch-manipulation overflow-hidden bg-black",
        // Human: Pencil Mobile Portrait — landscape band or vertical column based on source aspect.
        isVerticalVideo
          ? videoMobileVerticalVideoShellClass
          : videoMobileLandscapeVideoShellClass,
        // Human: Pencil Mobile Landscape — full-bleed overrides when data-video-layout=landscape.
        "video-landscape:mx-0 video-landscape:flex video-landscape:h-full video-landscape:min-h-0 video-landscape:w-full video-landscape:max-h-none video-landscape:max-w-none video-landscape:flex-1 video-landscape:shrink video-landscape:flex-col video-landscape:aspect-auto",
        isImmersive && "fixed inset-0 z-[60] flex min-h-0 flex-1 flex-col",
        isFullscreen && !isImmersive && "max-h-none max-w-none",
        "fullscreen:overflow-visible",
      )}
    >
      <video
        ref={videoRef}
        className="relative z-0 size-full bg-black object-contain video-landscape:min-h-0 video-landscape:flex-1"
        playsInline
        onClick={isFullscreen ? undefined : togglePlay}
        onPointerMove={revealChrome}
        onMouseMove={revealChrome}
      />

      {isFullscreen ? (
        <div
          className="absolute inset-0 z-[25]"
          aria-hidden
          onPointerMove={revealChrome}
          onMouseMove={revealChrome}
          onClick={togglePlay}
        />
      ) : null}

      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden h-[120px] bg-gradient-to-b from-[#000000B3] to-transparent video-landscape:block"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden h-[150px] bg-gradient-to-t from-[#000000B3] to-transparent video-landscape:block"
        aria-hidden
      />

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
          "video-landscape:left-6 video-landscape:top-6 video-landscape:bg-[#000000B3] video-landscape:px-4 video-landscape:py-2",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <p className="min-w-0 truncate text-[11px] font-bold video-landscape:text-xs video-landscape:font-medium">
          {metaLabel}
        </p>
        {positionLabel ? (
          <span className="shrink-0 text-[10px] text-[#E5E7EB]">{positionLabel}</span>
        ) : null}
        {(showDownloadAction || showShareAction) ? (
          <div className="hidden shrink-0 items-center gap-1 border-l border-white/20 pl-2 video-landscape:flex">
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
              "video-landscape:right-6 video-landscape:top-6 video-landscape:bg-[#000000B3]",
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
          "absolute inset-x-4 bottom-4 z-30 transition-opacity duration-200",
          "video-landscape:bottom-6 video-landscape:left-6 video-landscape:right-6",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between border border-[#FFFFFF1A] bg-[#000000B3] backdrop-blur-md",
            "h-12 gap-2 rounded-xl px-4 video-landscape:h-14 video-landscape:gap-4 video-landscape:rounded-2xl",
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
                  className="size-3.5 video-landscape:size-5"
                  fill="currentColor"
                  aria-hidden
                />
              ) : (
                <Play
                  className="size-3.5 video-landscape:size-5"
                  fill="currentColor"
                  aria-hidden
                />
              )}
            </button>
            <span className="shrink-0 text-[11px] tabular-nums text-[#E5E7EB] video-landscape:text-xs video-landscape:text-white">
              {timeLabel}
            </span>
          </div>

          <div className="block video-landscape:hidden">
            <VideoSeekBar
              variant="mobile-portrait"
              progress={progress}
              duration={duration}
              bufferedSegments={bufferedSegments}
              disabled={transportDisabled}
              onSeek={handleSeek}
            />
          </div>
          <div className="hidden min-w-0 flex-1 video-landscape:block">
            <VideoSeekBar
              variant="mobile-landscape"
              progress={progress}
              duration={duration}
              bufferedSegments={bufferedSegments}
              disabled={transportDisabled}
              onSeek={handleSeek}
              className="w-full max-w-none"
            />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleMute}
              disabled={transportDisabled}
              aria-label={muted ? "Unmute" : "Mute"}
              className="hidden text-white disabled:opacity-40 video-landscape:block"
            >
              {muted ? (
                <VolumeX className="size-5" aria-hidden />
              ) : (
                <Volume2 className="size-5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              disabled={transportDisabled}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="text-white disabled:opacity-40"
            >
              {isFullscreen ? (
                <Minimize className="size-3.5 video-landscape:size-5" aria-hidden />
              ) : (
                <Maximize className="size-3.5 video-landscape:size-5" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
