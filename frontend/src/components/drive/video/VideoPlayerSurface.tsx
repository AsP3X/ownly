// Human: Pencil desktop video player — 1.25× baseline (1500×1125 card), capped by 112.5dvh like Excel dialog.
// Agent: READS videoRef from parent for HLS attach; USES useVideoTransport; hidden below lg breakpoint.

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
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type VideoPlayerSurfaceProps = {
  file: FileItem;
  videoRef: RefObject<HTMLVideoElement | null>;
  loading?: boolean;
  error?: string;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

export function VideoPlayerSurface({
  file,
  videoRef,
  loading = false,
  error = "",
  onDownload,
  onShare,
}: VideoPlayerSurfaceProps) {
  const cardRef = useRef<HTMLDivElement>(null);

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
    fullscreenTargetRef: cardRef,
  });

  const timeLabel = `${formatVideoTime(progress)} / ${formatVideoTime(duration)}`;
  const metaLabel = `${file.name} • ${formatBytes(file.size_bytes)}`;
  const showCenterPlay = !isPlaying && !loading && !error && file.hls_ready;
  const showDownloadAction = Boolean(onDownload);
  const showShareAction = Boolean(onShare);

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative overflow-hidden rounded-2xl bg-black shadow-[0_16px_48px_rgba(0,0,0,0.4)]",
        "fullscreen:overflow-visible",
        isImmersive && "fixed inset-0 z-[60] flex min-h-0 flex-col",
        isFullscreen
          ? "flex max-h-none min-h-0 max-w-none flex-1 flex-col rounded-none"
          : "min-w-0 flex-1 aspect-[4/3] max-h-[min(1125px,112.5dvh)] w-full max-w-[min(1500px,calc(min(1125px,112.5dvh)*4/3))]",
      )}
      onFocus={revealChrome}
    >
      <video
        ref={videoRef}
        className={cn(
          "relative z-0 size-full bg-black object-contain",
          isFullscreen ? "min-h-0 flex-1" : "",
        )}
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

      {error ? (
        <p
          className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center text-sm text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {failed && !error ? (
        <p className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center text-sm text-red-400">
          {file.hls_encode_error ?? "Video processing failed."}
        </p>
      ) : null}

      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/50 text-sm text-white">
          <Loader2 className="size-6 animate-spin" aria-hidden />
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
            "absolute left-1/2 top-1/2 z-20 flex size-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur-sm transition hover:scale-105 hover:bg-black/65 disabled:pointer-events-none disabled:opacity-40",
            !chromeVisible && "opacity-0",
          )}
        >
          <Play className="ml-1 size-12" fill="currentColor" aria-hidden />
        </button>
      ) : null}

      <div
        className={cn(
          "absolute left-6 top-6 z-30 flex max-w-[calc(100%-10rem)] items-center gap-4 rounded-full bg-[#00000099] px-6 py-3 text-white backdrop-blur-md transition-opacity duration-200",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <p className="min-w-0 truncate text-base font-bold">{metaLabel}</p>
        {(showDownloadAction || showShareAction) && (
          <div className="flex shrink-0 items-center gap-2 border-l border-white/20 pl-3">
            {showDownloadAction ? (
              <button
                type="button"
                onClick={() => onDownload?.(file)}
                className="rounded-md p-1 transition hover:bg-white/10"
                aria-label={`Download ${file.name}`}
              >
                <Download className="size-5" aria-hidden />
              </button>
            ) : null}
            {showShareAction ? (
              <button
                type="button"
                onClick={() => onShare?.(file)}
                className="rounded-md p-1 transition hover:bg-white/10"
                aria-label={`Share ${file.name}`}
              >
                <Share2 className="size-5" aria-hidden />
              </button>
            ) : null}
          </div>
        )}
      </div>

      <DialogClose
        render={
          <button
            type="button"
            className={cn(
              "absolute right-6 top-6 z-30 flex size-[4.125rem] items-center justify-center rounded-full border border-white/20 bg-[#00000099] text-white backdrop-blur-md transition hover:bg-black/80",
              chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-label="Close video preview"
          />
        }
      >
        <X className="size-[27px]" aria-hidden />
      </DialogClose>

      <div
        className={cn(
          "absolute inset-x-6 bottom-6 z-30 transition-opacity duration-200",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="mx-auto flex h-24 max-w-[1710px] items-center justify-between gap-6 rounded-xl bg-[#000000CC] px-8 backdrop-blur-md">
          <div className="flex shrink-0 items-center gap-6">
            <button
              type="button"
              onClick={togglePlay}
              disabled={transportDisabled}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="text-white transition hover:text-white/80 disabled:opacity-40"
            >
              {isPlaying ? (
                <Pause className="size-6" fill="currentColor" aria-hidden />
              ) : (
                <Play className="size-6" fill="currentColor" aria-hidden />
              )}
            </button>
            <span className="shrink-0 text-sm tabular-nums text-white">{timeLabel}</span>
          </div>

          <VideoSeekBar
            variant="desktop"
            progress={progress}
            duration={duration}
            bufferedSegments={bufferedSegments}
            disabled={transportDisabled}
            onSeek={handleSeek}
          />

          <div className="flex shrink-0 items-center gap-6">
            <button
              type="button"
              onClick={toggleMute}
              disabled={transportDisabled}
              aria-label={muted ? "Unmute" : "Mute"}
              className="text-white transition hover:text-white/80 disabled:opacity-40"
            >
              {muted ? (
                <VolumeX className="size-6" aria-hidden />
              ) : (
                <Volume2 className="size-6" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              disabled={transportDisabled}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="text-white transition hover:text-white/80 disabled:opacity-40"
            >
              {isFullscreen ? (
                <Minimize className="size-6" aria-hidden />
              ) : (
                <Maximize className="size-6" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
