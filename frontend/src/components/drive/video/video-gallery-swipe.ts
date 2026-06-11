// Human: Gallery swipe only starts on the video layer — chrome and seek bar touches do not skip videos.
// Agent: READS data-video-gallery-swipe-zone on touch target; USED by VideoPreviewDialog touch handlers.

export const VIDEO_GALLERY_SWIPE_ZONE_SELECTOR = "[data-video-gallery-swipe-zone]";

// Human: True when the touch target lies inside the video swipe zone (not controls or seek bar).
// Agent: CALLS Element.closest; RETURNS false for chrome/button hits.
export function isVideoGallerySwipeZone(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(VIDEO_GALLERY_SWIPE_ZONE_SELECTOR) !== null;
}
