// Human: Player shell sizing from intrinsic video dimensions — landscape band vs vertical column.
// Agent: READS natural width/height; RETURNS Tailwind shell classes and inline aspectRatio style.

import type { CSSProperties } from "react";

// Human: Inline aspect ratio once metadata is known — keeps letterboxing accurate for any source ratio.
// Agent: RETURNS undefined when dimensions are missing; USED on desktop and mobile player shells.
export function resolveVideoAspectRatioStyle(
  naturalWidth: number,
  naturalHeight: number,
): CSSProperties | undefined {
  if (naturalWidth <= 0 || naturalHeight <= 0) return undefined;
  return { aspectRatio: `${naturalWidth} / ${naturalHeight}` };
}

// Human: Desktop landscape shell — width-first 4:3 card capped by viewport and pixel limits.
// Agent: DEFAULT before metadata; REPLACED by vertical shell when isVertical is true.
export const videoDialogLandscapePlayerShellClass =
  "h-auto min-w-0 max-h-[min(1125px,calc(100dvh-2rem))] w-[min(1500px,100%,calc(min(1125px,calc(100dvh-2rem))*4/3))] shrink-0 aspect-[4/3]" as const;

// Human: Desktop vertical shell — height-first column so portrait sources fill height without side gutters.
// Agent: max-w keeps phone-like proportions; inline aspectRatio refines width once metadata loads.
export const videoDialogVerticalPlayerShellClass =
  "h-[min(1125px,calc(100dvh-2rem))] w-auto min-w-0 max-w-[min(540px,100%)] shrink-0" as const;

// Human: Mobile portrait band for landscape video — Pencil 390×220 preview strip.
// Agent: USED when phone is upright and source is wider than tall; video-landscape overrides still apply.
export const videoMobileLandscapeVideoShellClass =
  "mx-auto aspect-[390/220] min-h-[180px] max-h-[min(220px,42dvh)] max-w-[min(100%,390px)]" as const;

// Human: Mobile portrait column for vertical video — taller stage using available viewport height.
// Agent: max-h reserves space for gallery footer + safe areas; aspect falls back to 9:16 until metadata.
export const videoMobileVerticalVideoShellClass =
  "mx-auto aspect-[9/16] min-h-[240px] max-h-[min(calc(100dvh-10rem),720px)] max-w-[min(100%,min(390px,calc(min(calc(100dvh-10rem),720px)*9/16)))]" as const;

// Human: Public share inline card — landscape 16:9 vs vertical 9:16 container before metadata.
// Agent: RETURNS Tailwind aspect class; pair with resolveVideoAspectRatioStyle on the wrapper.
export function resolveInlineVideoAspectClass(isVertical: boolean | null): string {
  if (isVertical === true) return "aspect-[9/16] max-h-[min(80dvh,720px)] w-full max-w-[min(100%,400px)] mx-auto";
  return "aspect-video w-full";
}
