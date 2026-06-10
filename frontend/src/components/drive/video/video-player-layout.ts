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

// Human: Desktop landscape shell — width-first 4:3 card capped by viewport and pixel limits.
// Agent: DEFAULT before metadata; REPLACED by vertical/square shells from orientation.
export const videoDialogLandscapePlayerShellClass =
  "h-auto min-w-0 max-h-[min(1125px,calc(100dvh-2rem))] w-[min(1500px,100%,calc(min(1125px,calc(100dvh-2rem))*4/3))] shrink-0 aspect-[4/3]" as const;

// Human: Desktop vertical shell — height-first column so portrait sources fill height without side gutters.
// Agent: max-w keeps phone-like proportions; inline aspectRatio refines width once metadata loads.
export const videoDialogVerticalPlayerShellClass =
  "h-[min(1125px,calc(100dvh-2rem))] w-auto min-w-0 max-w-[min(540px,100%)] shrink-0" as const;

// Human: Desktop square shell — 1:1 stage centered in the dialog row.
// Agent: height-capped like portrait; width follows square aspect via inline style when known.
export const videoDialogSquarePlayerShellClass =
  "h-[min(900px,calc(100dvh-2rem))] w-auto min-w-0 max-w-[min(900px,100%)] shrink-0 aspect-square" as const;

// Human: Mobile portrait band for landscape video — Pencil 390×220 preview strip.
// Agent: USED when phone is upright and source is wider than tall; video-landscape overrides still apply.
export const videoMobileLandscapeVideoShellClass =
  "mx-auto aspect-[390/220] min-h-[180px] max-h-[min(220px,42dvh)] max-w-[min(100%,390px)]" as const;

// Human: Mobile portrait column for vertical video — taller stage using available viewport height.
// Agent: max-h reserves space for gallery footer + safe areas; aspect falls back to 9:16 until metadata.
export const videoMobileVerticalVideoShellClass =
  "mx-auto aspect-[9/16] min-h-[240px] max-h-[min(calc(100dvh-10rem),720px)] max-w-[min(100%,min(390px,calc(min(calc(100dvh-10rem),720px)*9/16)))]" as const;

// Human: Mobile portrait square stage — 1:1 box sized to available viewport height.
// Agent: USED for near-square sources on narrow portrait layout; landscape phone still full-bleeds.
export const videoMobileSquareVideoShellClass =
  "mx-auto aspect-square min-h-[240px] max-h-[min(calc(100dvh-10rem),min(100vw-2rem,720px))] max-w-[min(100%,min(390px,calc(100dvh-10rem)))]" as const;

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
