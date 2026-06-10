// Human: Read intrinsic video dimensions from the <video> element for orientation-aware player shells.
// Agent: LISTENS loadedmetadata/resize on videoRef; RESETS on fileId change; RETURNS width/height/isVertical.

import { useEffect, useState, type RefObject } from "react";

export type VideoNaturalSize = {
  width: number;
  height: number;
  isVertical: boolean;
};

function readVideoNaturalSize(video: HTMLVideoElement | null): VideoNaturalSize | null {
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  const width = video.videoWidth;
  const height = video.videoHeight;
  return { width, height, isVertical: height > width };
}

type VideoNaturalSizeState = {
  fileId: string;
  size: VideoNaturalSize;
};

export function useVideoNaturalSize(
  videoRef: RefObject<HTMLVideoElement | null>,
  fileId: string,
): VideoNaturalSize | null {
  const [sizeState, setSizeState] = useState<VideoNaturalSizeState | null>(null);

  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | undefined;
    let retryTimer: number | undefined;

    const commitSize = (next: VideoNaturalSize) => {
      if (disposed) return;
      setSizeState((prev) => {
        if (
          prev?.fileId === fileId &&
          prev.size.width === next.width &&
          prev.size.height === next.height
        ) {
          return prev;
        }
        return { fileId, size: next };
      });
    };

    const attach = (video: HTMLVideoElement) => {
      detach?.();

      const sync = () => {
        const next = readVideoNaturalSize(video);
        if (!next) return;
        commitSize(next);
      };

      video.addEventListener("loadedmetadata", sync);
      video.addEventListener("resize", sync);
      const rafId = requestAnimationFrame(sync);

      detach = () => {
        cancelAnimationFrame(rafId);
        video.removeEventListener("loadedmetadata", sync);
        video.removeEventListener("resize", sync);
      };
    };

    const tryAttach = () => {
      const video = videoRef.current;
      if (!video) return false;
      attach(video);
      return true;
    };

    if (!tryAttach()) {
      // Human: <video> ref can lag one frame behind the player shell on first mount.
      // Agent: RETRIES briefly; STOPS once attach succeeds or effect cleans up.
      retryTimer = window.setInterval(() => {
        if (tryAttach() && retryTimer !== undefined) {
          window.clearInterval(retryTimer);
          retryTimer = undefined;
        }
      }, 32);
    }

    return () => {
      disposed = true;
      detach?.();
      if (retryTimer !== undefined) {
        window.clearInterval(retryTimer);
      }
    };
  }, [videoRef, fileId]);

  return sizeState?.fileId === fileId ? sizeState.size : null;
}
