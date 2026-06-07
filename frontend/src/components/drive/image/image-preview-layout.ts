// Human: Choose Pencil vertical full-bleed vs letterbox band from loaded image aspect ratio.
// Agent: READS naturalWidth/Height; RETURNS vertical when tall/square, letterbox when wide panorama.

import type { ImageFitMode } from "@/components/drive/image/image-preview-types";

/** Human: Any landscape image uses the centered letterbox band; portrait/square stays full-bleed vertical. */
export function resolveImageFitMode(naturalWidth: number, naturalHeight: number): ImageFitMode {
  if (naturalWidth <= 0 || naturalHeight <= 0) return "vertical";
  return naturalWidth > naturalHeight ? "letterbox" : "vertical";
}
