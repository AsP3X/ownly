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
    const video = videoRef.current;
    if (!video) return;

    const sync = () => {
      const next = readVideoNaturalSize(video);
      if (!next) return;
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

    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("resize", sync);
    sync();

    return () => {
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("resize", sync);
    };
  }, [videoRef, fileId]);

  return sizeState?.fileId === fileId ? sizeState.size : null;
}
