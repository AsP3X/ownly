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

// Human: Compute display pixel size that fits the container while preserving aspect ratio.
// Agent: READS natural + container dimensions; RETURNS rounded width/height in CSS pixels.
export function resolveMobileViewportFitPixels(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): { width: number; height: number } | null {
  if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }

  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

// Human: Fit media inside the mobile stage with one stable contain strategy (no width/height mode flip).
// Agent: READS natural + container size; RETURNS max-bounded auto sizing for static images.
export function resolveMobileViewportFitStyle(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): CSSProperties {
  if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE;
  }

  return {
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  };
}

// Human: Fixed pixel box for animated MP4/canvas — prevents iOS layout reflow during playback.
// Agent: CALLS resolveMobileViewportFitPixels; SETS explicit width/height + objectFit contain.
export function resolveStableAnimatedPreviewStyle(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): CSSProperties {
  const pixels = resolveMobileViewportFitPixels(
    naturalWidth,
    naturalHeight,
    containerWidth,
    containerHeight,
  );
  if (!pixels) {
    return MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE;
  }

  return {
    width: pixels.width,
    height: pixels.height,
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    flexShrink: 0,
  };
}

// Human: Merge letterbox fit with stable contain rules for animated GIF/WebP video and canvas surfaces.
// Agent: SPREADS fitStyle; FORCES objectFit contain on every animated preview surface.
export function withAnimatedPreviewContainFit(
  fitStyle: CSSProperties,
  naturalWidth: number,
  naturalHeight: number,
): CSSProperties {
  return {
    ...fitStyle,
    objectFit: "contain",
    flexShrink: 0,
    ...(naturalWidth > 0 && naturalHeight > 0
      ? { aspectRatio: `${naturalWidth} / ${naturalHeight}` }
      : {}),
  };
}
