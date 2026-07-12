// Human: EPUB reader layout constants — font sizes, spacing multipliers, and debounce timing.
// Agent: READ by useEpubPreviewController and surface components; VALUES align to pen design.

import type { EpubReaderFontSize, EpubReaderLineSpacing } from "@/lib/epub-reader-preference";

/** Human: Base body font size in px for each preference tier. */
export const EPUB_FONT_SIZE_PX: Record<EpubReaderFontSize, number> = {
  small: 15,
  medium: 17,
  large: 19,
};

/** Human: Line-height multiplier for each spacing preference. */
export const EPUB_LINE_HEIGHT: Record<EpubReaderLineSpacing, number> = {
  compact: 1.45,
  comfortable: 1.65,
  relaxed: 1.85,
};

/** Human: Debounce before persisting preference tweaks from rapid +/- taps. */
export const EPUB_PREFERENCE_SAVE_DEBOUNCE_MS = 200;
