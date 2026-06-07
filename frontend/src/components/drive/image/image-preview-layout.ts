// Human: Mobile preview sizing — edge contact without cropping top/bottom or sides.
// Agent: READS image + container dimensions; RETURNS inline size for width-fit or height-fit mode.

import type { CSSProperties } from "react";

/** Human: Default before dimensions are known — prefer width contact once metadata arrives. */
export const MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE: CSSProperties = {
  width: "100%",
  height: "auto",
  maxHeight: "100%",
};

// Human: Pick width-fit (touch left/right) or height-fit (touch top/bottom) from aspect ratio vs viewport.
// Agent: READS naturalWidth/Height + containerWidth/Height; RETURNS CSSProperties for centered flex img.
export function resolveMobileViewportFitStyle(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): CSSProperties {
  if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return MOBILE_IMAGE_VIEWPORT_FIT_FALLBACK_STYLE;
  }

  const heightIfFullWidth = naturalHeight * (containerWidth / naturalWidth);
  if (heightIfFullWidth <= containerHeight) {
    // Human: Scaling to viewport width keeps the full image visible — touch left and right edges.
    // Agent: UPSCALES small images to w-full; centers vertically when shorter than the viewport.
    return { width: "100%", height: "auto", maxHeight: "100%" };
  }

  // Human: Full width would clip vertically — fit height instead so top and bottom touch the viewport.
  // Agent: USES h-full + w-auto; MAY pillarbox horizontally; NEVER crops top/bottom.
  return { height: "100%", width: "auto", maxWidth: "100%" };
}
