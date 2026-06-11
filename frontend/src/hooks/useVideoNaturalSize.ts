// Human: Read intrinsic video dimensions — server metadata first, then <video> element events.
// Agent: RETURNS merged naturalSize + setVideoRef callback; AVOIDS polling timers on late ref attach.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  readServerVideoNaturalSize,
  toVideoNaturalSize,
  type VideoNaturalSize,
} from "@/components/drive/video/video-player-layout";

export type { VideoNaturalSize };

type VideoNaturalSizeState = {
  fileId: string;
  size: VideoNaturalSize;
};

function readVideoNaturalSize(video: HTMLVideoElement | null): VideoNaturalSize | null {
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  return toVideoNaturalSize(video.videoWidth, video.videoHeight);
}

type UseVideoNaturalSizeOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  fileId: string;
  serverWidth?: number | null;
  serverHeight?: number | null;
  /** Human: Notifies parent when the <video> node mounts or unmounts (HLS attach). */
  onVideoNodeChange?: (node: HTMLVideoElement | null) => void;
};

// Human: Merge server-stored dimensions with live element metadata for orientation-aware shells.
// Agent: CALLS setVideoRef on <video>; PREFERS element size once loadedmetadata provides pixels.
export function useVideoNaturalSize({
  videoRef,
  fileId,
  serverWidth,
  serverHeight,
  onVideoNodeChange,
}: UseVideoNaturalSizeOptions): {
  naturalSize: VideoNaturalSize | null;
  setVideoRef: (node: HTMLVideoElement | null) => void;
} {
  const [elementSize, setElementSize] = useState<VideoNaturalSizeState | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const serverSize = useMemo(
    () => readServerVideoNaturalSize(serverWidth, serverHeight),
    [serverHeight, serverWidth],
  );

  const setVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      onVideoNodeChange?.(node);
      detachRef.current?.();
      detachRef.current = null;
      setElementSize(null);

      if (!node) return;

      const commitSize = (next: VideoNaturalSize) => {
        setElementSize((prev) => {
          if (
            prev?.fileId === fileId &&
            prev.size.width === next.width &&
            prev.size.height === next.height &&
            prev.size.orientation === next.orientation
          ) {
            return prev;
          }
          return { fileId, size: next };
        });
      };

      const sync = () => {
        const next = readVideoNaturalSize(node);
        if (next) commitSize(next);
      };

      node.addEventListener("loadedmetadata", sync);
      node.addEventListener("resize", sync);
      const rafId = requestAnimationFrame(sync);

      detachRef.current = () => {
        cancelAnimationFrame(rafId);
        node.removeEventListener("loadedmetadata", sync);
        node.removeEventListener("resize", sync);
      };
    },
    [fileId, onVideoNodeChange, videoRef],
  );

  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [fileId],
  );

  const elementNatural =
    elementSize?.fileId === fileId ? elementSize.size : null;
  const naturalSize = elementNatural ?? serverSize;

  return { naturalSize, setVideoRef };
}
