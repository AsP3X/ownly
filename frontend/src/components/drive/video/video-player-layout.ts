// Human: Player shell sizing from intrinsic video dimensions — landscape, square, and portrait columns.
// Agent: READS natural width/height; RETURNS Tailwind shell classes and inline aspectRatio style.

import type { CSSProperties } from "react";

/** Human: Layout bucket for player chrome — square is near-1:1, not the landscape preview band. */
export type VideoOrientation = "landscape" | "square" | "portrait";

/** Human: Max relative delta from 1:1 before a source is treated as landscape or portrait. */
export const VIDEO_SQUARE_ASPECT_TOLERANCE = 0.08;

// Human: Classify source aspect — portrait when taller, square near 1:1, else landscape band.
// Agent: UNIT-TESTED; USED before stream metadata when server video_width/height are present.
export function classifyVideoOrientation(width: number, height: number): VideoOrientation {
  if (width <= 0 || height <= 0) return "landscape";
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= VIDEO_SQUARE_ASPECT_TOLERANCE) return "square";
  if (height > width) return "portrait";
  return "landscape";
}

// Human: Build a natural-size record from known pixel dimensions.
// Agent: CALLS classifyVideoOrientation; USED by useVideoNaturalSize server fallback.
export function toVideoNaturalSize(width: number, height: number) {
  return {
    width,
    height,
    orientation: classifyVideoOrientation(width, height),
    isVertical: height > width,
  };
}

export type VideoNaturalSize = ReturnType<typeof toVideoNaturalSize>;

// Human: Read server-stored dimensions from a FileItem when both axes are positive.
// Agent: RETURNS null for missing/zero values; AVOIDS layout shift before HLS metadata loads.
export function readServerVideoNaturalSize(
  videoWidth?: number | null,
  videoHeight?: number | null,
): VideoNaturalSize | null {
  if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) return null;
  return toVideoNaturalSize(videoWidth, videoHeight);
}

// Human: Inline aspect ratio once dimensions are known — keeps letterboxing accurate for any source ratio.
// Agent: RETURNS undefined when dimensions are missing; USED on desktop and mobile player shells.
export function resolveVideoAspectRatioStyle(
  naturalWidth: number,
  naturalHeight: number,
): CSSProperties | undefined {
  if (naturalWidth <= 0 || naturalHeight <= 0) return undefined;
  return { aspectRatio: `${naturalWidth} / ${naturalHeight}` };
}

// Human: Shared desktop shell base — height fills dialog row; width follows aspect (Pencil 1180×885 / 540×960).
// Agent: USED by orientation-specific shells; pair with inline aspectRatio or fallback aspect class.
export const videoDialogDesktopShellHeightClass =
  "h-full max-h-[min(1125px,calc(100dvh-2rem))]" as const;

// Human: Desktop landscape shell — 4:3 stage at row height (Pencil Normal: 1180×885).
// Agent: max-w 1500px cap; width derived from height × aspect when metadata loads.
export const videoDialogLandscapePlayerShellClass =
  `${videoDialogDesktopShellHeightClass} w-auto min-w-0 max-w-[min(1500px,100%)] shrink-0` as const;

// Human: Desktop vertical shell — 9:16 column (Pencil Portrait Vertical: 540×960).
// Agent: max-w 540px; inline aspectRatio refines width once metadata loads.
export const videoDialogVerticalPlayerShellClass =
  `${videoDialogDesktopShellHeightClass} w-auto min-w-0 max-w-[min(540px,100%)] shrink-0` as const;

// Human: Desktop square shell — 1:1 stage centered in the dialog row.
// Agent: height-capped; width follows square aspect via inline style when known.
export const videoDialogSquarePlayerShellClass =
  "h-full max-h-[min(900px,calc(100dvh-2rem))] w-auto min-w-0 max-w-[min(900px,100%)] shrink-0" as const;

// Human: Fallback aspect before stream metadata — avoids conflicting with inline aspectRatio style.
// Agent: RETURNS empty when natural size known; USED by VideoPlayerSurface desktop shell.
export function resolveDesktopVideoFallbackAspectClass(
  orientation: VideoOrientation,
  hasNaturalSize: boolean,
): string {
  if (hasNaturalSize) return "";
  if (orientation === "portrait") return "aspect-[9/16]";
  if (orientation === "square") return "aspect-square";
  return "aspect-[4/3]";
}

// Human: Mobile immersive shell — Pencil MV Mobile Vertical / Portrait Video Landscape (full viewport).
// Agent: FILLS dialog viewport; letterboxing for non-portrait sources handled inside the player surface.
export const videoMobileImmersiveShellClass =
  "relative flex h-full min-h-0 w-full flex-1 flex-col bg-black" as const;

// Human: Landscape source on portrait phone — full view width; height from aspect ratio unless taller than viewport.
// Agent: w-full + max-h-full; object-contain shrinks width only when intrinsic height exceeds the shell.
export const videoMobileLetterboxVideoClass =
  "h-auto w-full max-h-full max-w-full object-contain" as const;

// Human: Full-bleed vertical source on portrait phone — Reels-style edge-to-edge frame.
// Agent: object-cover fills viewport; paired with immersive chrome overlays.
export const videoMobileVerticalFullBleedVideoClass = "size-full object-cover" as const;

// Human: Legacy exports kept for tests — map to immersive shell (gallery footer removed from dialog).
export const videoMobileLandscapeVideoShellClass = videoMobileImmersiveShellClass;
export const videoMobileVerticalVideoShellClass = videoMobileImmersiveShellClass;
export const videoMobileSquareVideoShellClass = videoMobileImmersiveShellClass;

// Human: Pick desktop/mobile shell classes from orientation bucket.
// Agent: RETURNS landscape band by default when orientation is unknown.
export function resolveDesktopVideoShellClass(orientation: VideoOrientation): string {
  if (orientation === "portrait") return videoDialogVerticalPlayerShellClass;
  if (orientation === "square") return videoDialogSquarePlayerShellClass;
  return videoDialogLandscapePlayerShellClass;
}

export function resolveMobileVideoShellClass(orientation: VideoOrientation): string {
  if (orientation === "portrait") return videoMobileVerticalVideoShellClass;
  if (orientation === "square") return videoMobileSquareVideoShellClass;
  return videoMobileLandscapeVideoShellClass;
}

// Human: Public share inline card — landscape 16:9, square 1:1, or vertical 9:16 before metadata.
// Agent: RETURNS Tailwind aspect class; pair with resolveVideoAspectRatioStyle on the wrapper.
export function resolveInlineVideoAspectClass(orientation: VideoOrientation | null): string {
  if (orientation === "portrait") {
    return "aspect-[9/16] max-h-[min(80dvh,720px)] w-full max-w-[min(100%,400px)] mx-auto";
  }
  if (orientation === "square") {
    return "aspect-square max-h-[min(80dvh,720px)] w-full max-w-[min(100%,min(80dvh,720px))] mx-auto";
  }
  return "aspect-video w-full";
}
