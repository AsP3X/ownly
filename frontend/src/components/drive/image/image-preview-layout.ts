// Human: Choose Pencil vertical full-bleed vs letterbox band from loaded image aspect ratio.
// Agent: READS naturalWidth/Height; RETURNS vertical when tall/square, letterbox when wide panorama.

import type { ImageFitMode } from "@/components/drive/image/image-preview-types";

/** Human: Centered landscape band — outer flex host centers this box vertically and horizontally. */
export const MOBILE_IMAGE_LETTERBOX_STAGE_CLASS =
  "aspect-[390/220] w-full max-h-[min(220px,42dvh)] min-h-[180px] max-w-[min(100%,390px)] shrink-0";

/** Human: Any landscape image uses the centered letterbox band; portrait/square stays full-bleed vertical. */
export function resolveImageFitMode(naturalWidth: number, naturalHeight: number): ImageFitMode {
  if (naturalWidth <= 0 || naturalHeight <= 0) return "vertical";
  return naturalWidth > naturalHeight ? "letterbox" : "vertical";
}

/** Human: Cached decode may skip onLoad — read natural dimensions when the img node is already complete. */
export function resolveImageFitFromElement(img: HTMLImageElement | null): ImageFitMode | null {
  if (!img?.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null;
  return resolveImageFitMode(img.naturalWidth, img.naturalHeight);
}
