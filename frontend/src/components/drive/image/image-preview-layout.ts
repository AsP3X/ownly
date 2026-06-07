// Human: Mobile preview sizing — width-first edge contact with a vertical overflow guard.
// Agent: EXPORTS img class; w-full upscales to viewport edges unless max-h-full would bind first.

/** Human: Scale to viewport width; shrink only when full width would clip top/bottom. */
export const MOBILE_IMAGE_VIEWPORT_FIT_CLASS = "h-auto max-h-full w-full max-w-full";
