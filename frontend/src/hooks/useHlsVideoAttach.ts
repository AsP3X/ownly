// Human: Attach hls.js (or native HLS) to the active preview <video> element; expose ABR quality levels.
// Agent: RE-RUNS when stream URL or mounted video node changes; FIXES desktop/mobile surface swaps.

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  attachHlsErrorHandler,
  attachVodSeekRecovery,
  createHlsInstance,
  isHlsStreamUrl,
  shouldPreferNativeHlsPlayback,
} from "@/lib/hls-player";

export type HlsQualityLevel = {
  /** Human: hls.js level index. */
  index: number;
  /** Human: Vertical resolution when known (e.g. 720). */
  height: number;
  /** Human: Average bitrate in bps when known. */
  bitrate: number;
  /** Human: UI label — "720p", "1080p", or bitrate fallback. */
  label: string;
};

export type HlsQualityState = {
  levels: HlsQualityLevel[];
  /** Human: Selected level index, or -1 for automatic ABR. */
  selectedLevel: number;
  autoEnabled: boolean;
  /** Human: Currently rendering level index from LEVEL_SWITCHED, or -1 unknown. */
  currentLevel: number;
};

const EMPTY_QUALITY: HlsQualityState = {
  levels: [],
  selectedLevel: -1,
  autoEnabled: true,
  currentLevel: -1,
};

type UseHlsVideoAttachOptions = {
  video: HTMLVideoElement | null;
  streamUrl: string | null;
  open: boolean;
  shareToken?: string;
  sharePassword?: string | null;
  onError: (message: string) => void;
  /** Human: Bump to tear down and re-attach hls.js after a user Retry. */
  attachKey?: number;
};

function formatLevelLabel(height: number, bitrate: number): string {
  if (height > 0) return `${height}p`;
  if (bitrate > 0) {
    const kbps = Math.round(bitrate / 1000);
    return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
  }
  return "Quality";
}

function mapHlsLevels(hls: Hls): HlsQualityLevel[] {
  return hls.levels.map((level, index) => ({
    index,
    height: level.height || 0,
    bitrate: level.bitrate || 0,
    label: formatLevelLabel(level.height || 0, level.bitrate || 0),
  }));
}

// Human: Wire encrypted VOD playback to the current dialog video element; track ABR ladder.
// Agent: LISTENS video + streamUrl + attachKey; DESTROYS hls on cleanup; CALLS onError on fatal failures.
export function useHlsVideoAttach({
  video,
  streamUrl,
  open,
  shareToken,
  sharePassword,
  onError,
  attachKey = 0,
}: UseHlsVideoAttachOptions): {
  quality: HlsQualityState;
  setQualityLevel: (levelIndex: number) => void;
} {
  const hlsRef = useRef<Hls | null>(null);
  const [quality, setQuality] = useState<HlsQualityState>(EMPTY_QUALITY);

  const setQualityLevel = useCallback((levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    if (levelIndex < 0) {
      // Human: Re-enable ABR — hls.js uses -1 for auto level selection.
      // Agent: WRITES currentLevel = -1; SETS autoEnabled true.
      hls.currentLevel = -1;
      setQuality((prev) => ({
        ...prev,
        selectedLevel: -1,
        autoEnabled: true,
      }));
      return;
    }

    if (levelIndex >= hls.levels.length) return;
    hls.currentLevel = levelIndex;
    setQuality((prev) => ({
      ...prev,
      selectedLevel: levelIndex,
      autoEnabled: false,
      currentLevel: levelIndex,
    }));
  }, []);

  useEffect(() => {
    if (!video || !streamUrl || !open) {
      hlsRef.current = null;
      setQuality(EMPTY_QUALITY);
      return;
    }

    let hls: Hls | null = null;
    let disposed = false;
    let detachSeek: (() => void) | undefined;

    const isActive = () => !disposed;

    if (isHlsStreamUrl(streamUrl) && shouldPreferNativeHlsPlayback(video)) {
      video.src = streamUrl;
      // Native HLS (Safari) — quality ladder not exposed via hls.js.
      setQuality(EMPTY_QUALITY);
    } else if (isHlsStreamUrl(streamUrl) && Hls.isSupported()) {
      hls = createHlsInstance((xhr) => {
        xhr.withCredentials = true;
        if (shareToken && sharePassword) {
          xhr.setRequestHeader("X-Share-Password", sharePassword);
        }
      });
      hlsRef.current = hls;
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

      // Human: Populate quality menu when the master playlist levels are known.
      // Agent: ON MANIFEST_PARSED / LEVELS_UPDATED maps hls.levels into quality state.
      const syncLevels = () => {
        if (!hls || disposed) return;
        const instance = hls;
        const levels = mapHlsLevels(instance);
        setQuality((prev) => ({
          levels,
          selectedLevel: prev.autoEnabled ? -1 : prev.selectedLevel,
          autoEnabled: prev.autoEnabled,
          currentLevel: instance.currentLevel,
        }));
      };

      hls.on(Hls.Events.MANIFEST_PARSED, syncLevels);
      hls.on(Hls.Events.LEVELS_UPDATED, syncLevels);
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        if (disposed) return;
        setQuality((prev) => ({
          ...prev,
          currentLevel: data.level,
        }));
      });

      detachSeek = attachVodSeekRecovery(hls, video, isActive);
    } else if (isHlsStreamUrl(streamUrl)) {
      onError("This browser cannot play HLS video.");
    } else {
      video.src = streamUrl;
      setQuality(EMPTY_QUALITY);
    }

    return () => {
      disposed = true;
      detachSeek?.();
      if (hls) hls.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
      setQuality(EMPTY_QUALITY);
    };
  }, [video, streamUrl, open, shareToken, sharePassword, onError, attachKey]);

  return { quality, setQualityLevel };
}
