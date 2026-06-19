// Human: Attach hls.js (or native HLS) to the active preview <video> element.
// Agent: RE-RUNS when stream URL or mounted video node changes; FIXES desktop/mobile surface swaps.

import { useEffect } from "react";
import Hls from "hls.js";
import {
  attachHlsErrorHandler,
  attachVodSeekRecovery,
  createHlsInstance,
  isHlsStreamUrl,
  shouldPreferNativeHlsPlayback,
} from "@/lib/hls-player";

type UseHlsVideoAttachOptions = {
  video: HTMLVideoElement | null;
  streamUrl: string | null;
  open: boolean;
  shareToken?: string;
  sharePassword?: string | null;
  onError: (message: string) => void;
};

// Human: Wire encrypted VOD playback to the current dialog video element.
// Agent: LISTENS video + streamUrl; DESTROYS hls on cleanup; CALLS onError on fatal failures.
export function useHlsVideoAttach({
  video,
  streamUrl,
  open,
  shareToken,
  sharePassword,
  onError,
}: UseHlsVideoAttachOptions): void {
  useEffect(() => {
    if (!video || !streamUrl || !open) return;

    let hls: Hls | null = null;
    let disposed = false;
    let detachSeek: (() => void) | undefined;

    const isActive = () => !disposed;

    if (isHlsStreamUrl(streamUrl) && shouldPreferNativeHlsPlayback(video)) {
      video.src = streamUrl;
    } else if (isHlsStreamUrl(streamUrl) && Hls.isSupported()) {
      hls = createHlsInstance((xhr) => {
        xhr.withCredentials = true;
        if (shareToken && sharePassword) {
          xhr.setRequestHeader("X-Share-Password", sharePassword);
        }
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      attachHlsErrorHandler(hls, video, isActive, (message) => {
        if (!disposed) onError(message);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          console.warn("[hls]", data.type, data.details, data);
        }
      });
      detachSeek = attachVodSeekRecovery(hls, video, isActive);
    } else if (isHlsStreamUrl(streamUrl)) {
      onError("This browser cannot play HLS video.");
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
  }, [video, streamUrl, open, shareToken, sharePassword, onError]);
}
