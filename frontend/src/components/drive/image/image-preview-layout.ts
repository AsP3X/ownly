// Human: Mobile preview sizing — edge contact without cropping top/bottom or sides.
// Agent: READS image + container dimensions; RETURNS inline size for width-fit or height-fit mode.

import type { CSSProperties } from "react";

/** Human: Default before dimensions are known — letterbox inside the flex stage without stretching. */
export const MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE: CSSProperties = {
  width: "auto",
  height: "auto",
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain",
};

// Human: Fit media inside the mobile stage with one stable contain strategy (no width/height mode flip).
// Agent: READS natural + container size; RETURNS max-bounded auto sizing for img, video, and canvas.
export function resolveMobileViewportFitStyle(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): CSSProperties {
  if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE;
  }

  // Human: iOS Safari chrome resize used to flip width-fit vs height-fit and stretch video/canvas axes.
  // Agent: USES object-fit contain + max bounds; PRESERVES aspect ratio for animated MP4/canvas paths.
  return {
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    aspectRatio: `${naturalWidth} / ${naturalHeight}`,
  };
}

// Human: Merge letterbox fit with stable contain rules for animated GIF/WebP video and canvas surfaces.
// Agent: SPREADS fitStyle; FORCES objectFit contain; SETS aspectRatio when natural size is known.
export function withAnimatedPreviewContainFit(
  fitStyle: CSSProperties,
  naturalWidth: number,
  naturalHeight: number,
): CSSProperties {
  return {
    ...fitStyle,
    objectFit: "contain",
    ...(naturalWidth > 0 && naturalHeight > 0
      ? { aspectRatio: `${naturalWidth} / ${naturalHeight}` }
      : {}),
  };
}
