// Human: Choose Pencil vertical full-bleed vs letterbox band from loaded image aspect ratio.
// Agent: READS naturalWidth/Height; RETURNS vertical when tall/square, letterbox when wide panorama.

import type { ImageFitMode } from "@/components/drive/image/image-preview-types";

/** Human: Pencil letterbox band targets ~390×220 — wide images above this ratio letterbox on mobile. */
const LETTERBOX_ASPECT_THRESHOLD = 1.25;

export function resolveImageFitMode(naturalWidth: number, naturalHeight: number): ImageFitMode {
  if (naturalWidth <= 0 || naturalHeight <= 0) return "vertical";
  return naturalWidth / naturalHeight > LETTERBOX_ASPECT_THRESHOLD ? "letterbox" : "vertical";
}
