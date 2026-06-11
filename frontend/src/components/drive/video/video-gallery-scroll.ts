// Human: Shared TikTok-style gallery snap tuning for mobile video vertical scroll.
// Agent: READ by VideoVerticalGallery; MATCHES image carousel easing for consistent UX.

/** Human: Minimum vertical travel before committing to the next/previous video. */
export const VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_RATIO = 0.22;
export const VIDEO_GALLERY_SWIPE_COMMIT_THRESHOLD_MAX_PX = 96;
/** Human: Rubber-band factor when dragging past the first or last video. */
export const VIDEO_GALLERY_EDGE_DRAG_RESISTANCE = 0.35;
/** Human: Fast vertical flicks commit even below the distance threshold. */
export const VIDEO_GALLERY_FLICK_VELOCITY_PX_MS = 0.35;
export const VIDEO_GALLERY_SNAP_EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
export const VIDEO_GALLERY_SNAP_MIN_MS = 200;
export const VIDEO_GALLERY_SNAP_MAX_MS = 360;
export const VIDEO_GALLERY_COMMIT_FALLBACK_MS = VIDEO_GALLERY_SNAP_MAX_MS + 80;
/** Human: Axis lock — finger must move before we treat the gesture as gallery scroll. */
export const VIDEO_GALLERY_AXIS_LOCK_PX = 8;

// Human: Scale snap duration to remaining travel for natural deceleration (TikTok-style).
// Agent: RETURNS ms between SNAP_MIN and SNAP_MAX based on distance.
export function videoGallerySnapDurationMs(distancePx: number): number {
  return Math.min(
    VIDEO_GALLERY_SNAP_MAX_MS,
    Math.max(VIDEO_GALLERY_SNAP_MIN_MS, Math.abs(distancePx) * 0.42),
  );
}
