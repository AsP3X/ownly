// Human: Inline HLS video card for single-file public shares — Pencil Single File Preview variant.
// Agent: READS stream URL from parent; ATTACHES hls.js with share password xhr setup; RENDERS native controls.

import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { Film, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  resolveInlineVideoAspectClass,
  resolveVideoAspectRatioStyle,
} from "@/components/drive/video/video-player-layout";
import { useVideoNaturalSize } from "@/hooks/useVideoNaturalSize";
import {
  attachHlsErrorHandler,
  attachVodSeekRecovery,
  createHlsInstance,
  isHlsStreamUrl,
  shouldPreferNativeHlsPlayback,
} from "@/lib/hls-player";
import { createSharePasswordXhrSetup } from "@/lib/share-access";
import { cn } from "@/lib/utils";

type PublicShareInlineVideoProps = {
  file: FileItem;
  streamUrl: string | null;
  streamLoading: boolean;
  streamError: string;
  sharePassword: string | null;
  onStreamError?: (message: string) => void;
};

export function PublicShareInlineVideo({
  file,
  streamUrl,
  streamLoading,
  streamError,
  sharePassword,
  onStreamError,
}: PublicShareInlineVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { naturalSize, setVideoRef } = useVideoNaturalSize({
    videoRef,
    fileId: file.id,
    serverWidth: file.video_width,
    serverHeight: file.video_height,
  });
  const inlineAspectClass = resolveInlineVideoAspectClass(
    naturalSize?.orientation ?? null,
  );
  const inlineAspectStyle = naturalSize
    ? resolveVideoAspectRatioStyle(naturalSize.width, naturalSize.height)
    : undefined;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;
    let hls: Hls | null = null;
    let disposed = false;
    let detachSeek: (() => void) | undefined;
    const isActive = () => !disposed;

    if (isHlsStreamUrl(streamUrl) && shouldPreferNativeHlsPlayback(video)) {
      video.src = streamUrl;
    } else if (isHlsStreamUrl(streamUrl) && Hls.isSupported()) {
      hls = createHlsInstance(createSharePasswordXhrSetup(sharePassword));
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      attachHlsErrorHandler(hls, video, isActive, (message) => {
        if (!disposed) onStreamError?.(message);
      });
      detachSeek = attachVodSeekRecovery(hls, video, isActive);
    }

    return () => {
      disposed = true;
      detachSeek?.();
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl, sharePassword, onStreamError]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-black shadow-[0_12px_32px_#00000014]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-white sm:px-5">
        <Film className="size-4 shrink-0 text-[#93C5FD]" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{file.name}</p>
        {file.hls_ready ? (
          <span className="rounded-md bg-[#2563EB] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            Ready
          </span>
        ) : null}
      </div>
      <div
        className={cn("relative bg-black", inlineAspectClass)}
        data-video-orientation={naturalSize?.orientation ?? "landscape"}
        style={inlineAspectStyle}
      >
        <video ref={setVideoRef} className="size-full object-contain" controls playsInline />
        {streamLoading ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-sm text-white">
            <Loader2 className="size-5 animate-spin" />
            Loading stream…
          </div>
        ) : null}
      </div>
      {streamError ? (
        <p className="border-t border-white/10 px-4 py-3 text-sm text-red-300">{streamError}</p>
      ) : null}
    </div>
  );
}
