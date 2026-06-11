// Human: Pencil mobile video — immersive portrait phone (Reels-style) + full-bleed landscape phone.
// Agent: READS videoRef; USES useVideoTransport; video-portrait / video-landscape variants from ancestor layout.

import { useRef, useState, type ComponentProps, type RefObject } from "react";
import {
  ChevronUp,
  Download,
  EllipsisVertical,
  Info,
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
import {
  VideoPlayerInfoSheet,
  VideoPlayerMoreMenuSheet,
} from "@/components/drive/video/VideoPlayerMobileSheets";
import { VideoSeekBar } from "@/components/drive/video/VideoSeekBar";
import { useVideoTransport } from "@/components/drive/video/useVideoTransport";
import { formatVideoTime } from "@/components/drive/video/video-time";
import {
  resolveMobileVideoShellClass,
  videoMobileLetterboxVideoClass,
  videoMobileVerticalFullBleedVideoClass,
} from "@/components/drive/video/video-player-layout";
import { useVideoNaturalSize } from "@/hooks/useVideoNaturalSize";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { DialogClose } from "@/components/ui/dialog";

type VideoPlayerSurfaceMobileProps = {
  file: FileItem;
  videoRef: RefObject<HTMLVideoElement | null>;
  loading?: boolean;
  error?: string;
  positionLabel?: string | null;
  folderLabel?: string | null;
  showGalleryHint?: boolean;
  onVideoNodeChange?: (node: HTMLVideoElement | null) => void;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

// Human: Floating blur circle used for top chrome buttons (close, more).
// Agent: PRESENTATIONAL; matches Pencil #00000066 + border white/10.
function MobileChromeCircleButton({
  className,
  children,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/55",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Human: Right-side action rail item — icon circle + caption (Save, Share, Info).
// Agent: CALLS optional handler; disabled when action unavailable.
function MobileActionRailItem({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: typeof Download;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex flex-col items-center gap-1 disabled:opacity-40"
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur-sm">
        <Icon className="size-5 text-white" aria-hidden />
      </span>
      <span className="text-[10px] font-medium text-white/80">{label}</span>
    </button>
  );
}

export function VideoPlayerSurfaceMobile({
  file,
  videoRef,
  loading = false,
  error = "",
  positionLabel,
  folderLabel,
  showGalleryHint = false,
  onVideoNodeChange,
  onDownload,
  onShare,
}: VideoPlayerSurfaceMobileProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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
  const durationLabel = duration > 0 ? formatVideoTime(duration) : null;
  const metaDetailParts = [
    formatBytes(file.size_bytes),
    durationLabel,
    folderLabel,
  ].filter(Boolean);
  const metaDetailLine = metaDetailParts.join(" • ");
  const landscapeMetaLabel = `${file.name} • ${formatBytes(file.size_bytes)}`;
  const showCenterPlay = !isPlaying && !loading && !error && file.hls_ready;
  const showDownloadAction = Boolean(onDownload);
  const showShareAction = Boolean(onShare);
  const chromeClass = cn(
    "transition-opacity duration-200",
    chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
  );

  // Human: Source orientation drives letterbox vs full-bleed on portrait phone.
  // Agent: READS useVideoNaturalSize; portrait sources fill viewport; landscape/square band centered.
  const { naturalSize, setVideoRef } = useVideoNaturalSize({
    videoRef,
    fileId: file.id,
    serverWidth: file.video_width,
    serverHeight: file.video_height,
    onVideoNodeChange,
  });
  const orientation = naturalSize?.orientation ?? "landscape";
  const isVerticalSource = orientation === "portrait";
  const isSquareSource = orientation === "square";

  return (
    <div
      ref={shellRef}
      data-video-orientation={orientation}
      className={cn(
        resolveMobileVideoShellClass(orientation),
        "touch-manipulation overflow-hidden",
        "video-landscape:h-full video-landscape:min-h-0 video-landscape:w-full",
        isImmersive && "fixed inset-0 z-[60]",
        "fullscreen:overflow-visible",
      )}
      onFocus={revealChrome}
    >
      {/* Human: Video layer — full bleed on portrait source or landscape phone; letterbox when upright + landscape source. */}
      {/* Agent: data-video-gallery-swipe-zone — gallery navigation only when swipe starts here. */}
      <div
        data-video-gallery-swipe-zone
        className={cn(
          "absolute inset-0 z-0 size-full min-h-0",
          !isVerticalSource &&
            "video-portrait:flex video-portrait:items-center video-portrait:justify-center video-portrait:bg-black",
        )}
      >
        <video
          ref={setVideoRef}
          className={cn(
            "bg-black",
            isVerticalSource
              ? cn(
                  videoMobileVerticalFullBleedVideoClass,
                  "video-landscape:object-contain",
                )
              : isSquareSource
                ? cn(
                    "h-auto w-full max-h-full max-w-full aspect-square object-contain",
                    "video-landscape:size-full video-landscape:max-h-none video-landscape:object-contain",
                  )
                : cn(
                    videoMobileLetterboxVideoClass,
                    "video-landscape:size-full video-landscape:max-h-none video-landscape:object-contain",
                  ),
          )}
          playsInline
          onClick={isFullscreen ? undefined : togglePlay}
          onPointerMove={revealChrome}
          onMouseMove={revealChrome}
        />
      </div>

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
            "absolute left-1/2 top-1/2 z-20 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 disabled:opacity-40",
            !chromeVisible && "opacity-0",
          )}
        >
          <Play className="ml-0.5 size-[18px]" fill="currentColor" aria-hidden />
        </button>
      ) : null}

      {/* Human: Portrait phone — Pencil MV Mobile Vertical / Portrait Video Landscape immersive chrome. */}
      <div className={cn("video-landscape:hidden", chromeClass)}>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[140px] bg-gradient-to-b from-black/70 to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[280px] bg-gradient-to-t from-black/80 to-transparent"
          aria-hidden
        />

        <div className="absolute inset-x-0 top-0 z-30 h-14 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <DialogClose
            render={
              <MobileChromeCircleButton
                className="absolute left-4 top-[max(1.25rem,env(safe-area-inset-top))]"
                aria-label="Close video preview"
              >
                <X className="size-3.5" aria-hidden />
              </MobileChromeCircleButton>
            }
          />
          {positionLabel ? (
            <span className="absolute left-1/2 top-[max(1.35rem,env(safe-area-inset-top))] flex h-6 min-w-14 -translate-x-1/2 items-center justify-center rounded-xl bg-black/40 px-3 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
              {positionLabel}
            </span>
          ) : null}
          <MobileChromeCircleButton
            className="absolute right-4 top-[max(1.25rem,env(safe-area-inset-top))]"
            aria-label="More options"
            aria-haspopup="dialog"
            aria-expanded={moreMenuOpen}
            onClick={() => setMoreMenuOpen(true)}
          >
            <EllipsisVertical className="size-4" aria-hidden />
          </MobileChromeCircleButton>
        </div>

        <div className="absolute bottom-[calc(max(0px,env(safe-area-inset-bottom))+6.5rem)] right-4 z-30 flex flex-col gap-[18px]">
          <MobileActionRailItem
            label="Save"
            icon={Download}
            disabled={!showDownloadAction}
            onClick={showDownloadAction ? () => onDownload?.(file) : undefined}
          />
          <MobileActionRailItem
            label="Share"
            icon={Share2}
            disabled={!showShareAction}
            onClick={showShareAction ? () => onShare?.(file) : undefined}
          />
          <MobileActionRailItem
            label="Info"
            icon={Info}
            onClick={() => setInfoOpen(true)}
          />
        </div>

        {/* Human: Bottom chrome stack — gallery hint, title, transport, edge seek bar (Pencil MV Mobile Vertical). */}
        {/* Agent: flex column at safe-area bottom; hint sits above file info, not floating mid-viewport. */}
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex flex-col pb-[max(0px,env(safe-area-inset-bottom))]"
        >
          {showGalleryHint ? (
            <div
              className="flex flex-col items-center gap-0.5 px-4 pb-2 pt-1 text-white/60"
              aria-hidden
            >
              <ChevronUp className="size-4 shrink-0 text-white/60" strokeWidth={2} />
              <span className="text-[10px] font-medium leading-none text-white/60">
                Swipe up for next
              </span>
            </div>
          ) : null}
          <div className="max-w-[min(294px,calc(100%-5rem))] px-4 pb-1.5 pt-2">
            <p className="truncate text-base font-bold text-white">{file.name}</p>
            {metaDetailLine ? (
              <p className="mt-1.5 truncate text-xs text-[#E5E7EB]">{metaDetailLine}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between px-4 pb-2">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={togglePlay}
                disabled={transportDisabled}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="text-white disabled:opacity-40"
              >
                {isPlaying ? (
                  <Pause className="size-4" fill="currentColor" aria-hidden />
                ) : (
                  <Play className="size-4" fill="currentColor" aria-hidden />
                )}
              </button>
              <span className="text-[11px] tabular-nums text-[#E5E7EB]">{timeLabel}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleMute}
                disabled={transportDisabled}
                aria-label={muted ? "Unmute" : "Mute"}
                className="text-white disabled:opacity-40"
              >
                {muted ? (
                  <VolumeX className="size-4" aria-hidden />
                ) : (
                  <Volume2 className="size-4" aria-hidden />
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
                  <Minimize className="size-4" aria-hidden />
                ) : (
                  <Maximize className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </div>

          <VideoSeekBar
            variant="mobile-edge"
            progress={progress}
            duration={duration}
            bufferedSegments={bufferedSegments}
            disabled={transportDisabled}
            onSeek={handleSeek}
          />
        </div>
      </div>

      {/* Human: Landscape phone — Pencil MV Mobile Landscape Video full-bleed chrome. */}
      <div className={cn("hidden video-landscape:block", chromeClass)}>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[120px] bg-gradient-to-b from-black/70 to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[150px] bg-gradient-to-t from-black/70 to-transparent"
          aria-hidden
        />

        <div className="absolute left-6 top-[max(1.5rem,env(safe-area-inset-top))] z-30 flex max-w-[calc(100%-6rem)] items-center gap-2 rounded-[18px] bg-black/70 px-4 py-2 text-white backdrop-blur-sm">
          <p className="min-w-0 truncate text-xs font-medium">{landscapeMetaLabel}</p>
          {positionLabel ? (
            <span className="shrink-0 text-[10px] text-[#E5E7EB]">{positionLabel}</span>
          ) : null}
          {(showDownloadAction || showShareAction) && (
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
          )}
        </div>

        <DialogClose
          render={
            <MobileChromeCircleButton
              className="absolute right-6 top-[max(1.5rem,env(safe-area-inset-top))] z-30 bg-black/70"
              aria-label="Close video preview"
            >
              <X className="size-3.5" aria-hidden />
            </MobileChromeCircleButton>
          }
        />

        <div className="absolute inset-x-6 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-30">
          <div className="flex h-14 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/70 px-4 backdrop-blur-md">
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                disabled={transportDisabled}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="text-white disabled:opacity-40"
              >
                {isPlaying ? (
                  <Pause className="size-5" fill="currentColor" aria-hidden />
                ) : (
                  <Play className="size-5" fill="currentColor" aria-hidden />
                )}
              </button>
              <span className="shrink-0 text-xs tabular-nums text-white">{timeLabel}</span>
            </div>

            <VideoSeekBar
              variant="mobile-landscape"
              progress={progress}
              duration={duration}
              bufferedSegments={bufferedSegments}
              disabled={transportDisabled}
              onSeek={handleSeek}
              className="min-w-0 flex-1"
            />

            <div className="flex shrink-0 items-center gap-3">
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
              <button
                type="button"
                onClick={toggleFullscreen}
                disabled={transportDisabled}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                className="text-white disabled:opacity-40"
              >
                {isFullscreen ? (
                  <Minimize className="size-5" aria-hidden />
                ) : (
                  <Maximize className="size-5" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <VideoPlayerInfoSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
        file={file}
        folderLabel={folderLabel}
        durationSeconds={duration}
        videoWidth={naturalSize?.width ?? file.video_width}
        videoHeight={naturalSize?.height ?? file.video_height}
      />
      <VideoPlayerMoreMenuSheet
        open={moreMenuOpen}
        onOpenChange={setMoreMenuOpen}
        file={file}
        showDownloadAction={showDownloadAction}
        showShareAction={showShareAction}
        onDownload={onDownload}
        onShare={onShare}
        onShowInfo={() => setInfoOpen(true)}
      />
    </div>
  );
}
