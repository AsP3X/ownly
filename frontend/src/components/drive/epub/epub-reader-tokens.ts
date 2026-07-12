// Human: EPUB reader design tokens — aligned to docs/design/epub-reader.pen variables.
// Agent: READ by EpubPreviewSurface* components; MIRRORS video player overlay pill styles.

/** Human: Reader paper background ($reader-bg). */
export const EPUB_READER_PAPER_BG = "#FAF8F5";

/** Human: Primary reading text on paper ($reader-text). */
export const EPUB_READER_TEXT = "#2C2C2C";

/** Human: Secondary labels such as page indicator ($reader-muted). */
export const EPUB_READER_TEXT_MUTED = "#6B6B6B";

/** Human: Accent controls and active TOC row ($accent-primary). */
export const EPUB_READER_ACCENT = "#2563EB";

/** Human: Serif body stack for chapter content ($font-serif). */
export const EPUB_READER_FONT_SERIF = "Georgia, \"Times New Roman\", serif";

/** Human: UI chrome labels and controls ($font-sans). */
export const EPUB_READER_FONT_SANS = "Inter, system-ui, sans-serif";

/** Human: Dimmed explorer behind desktop reader card (pen Reader Overlay). */
export const EPUB_READER_OVERLAY_SCRIM = "#00000066";

/** Human: Mobile fullscreen scrim behind reader surface. */
export const EPUB_READER_OVERLAY_SCRIM_MOBILE = "#00000088";

/** Human: Translucent control pills ($overlay-dark) — same as video/image preview chips. */
export const EPUB_READER_OVERLAY_PILL_BG = "#00000099";

/** Human: Pill border on dark overlays ($overlay-light). */
export const EPUB_READER_OVERLAY_PILL_BORDER = "#FFFFFF1A";

/** Human: Chapter nav button stroke on desktop overlay. */
export const EPUB_READER_OVERLAY_CONTROL_STROKE = "#FFFFFF33";

// Human: Dialog backdrop — matches VideoPreviewDialog desktop/narrow overlay blur.
// Agent: USED on EpubPreviewDialog overlayClassName.
export const EPUB_READER_DIALOG_OVERLAY_CLASS =
  "bg-[#0A0A10]/80 backdrop-blur-[40px]";

export const EPUB_READER_DIALOG_OVERLAY_CLASS_MOBILE =
  "bg-[#0A0A10]/90 backdrop-blur-[48px]";

// Human: Top meta pill and close control — video player uses bg-black/60 + backdrop-blur-md.
// Agent: PEN uses $overlay-dark (#00000099) with 12px background blur on meta pill.
export const EPUB_READER_META_PILL_CLASS =
  "flex items-center gap-4 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-6 py-3 text-white backdrop-blur-md";

export const EPUB_READER_CLOSE_BUTTON_CLASS =
  "flex size-[4.125rem] items-center justify-center rounded-full border border-[#FFFFFF33] bg-[#00000099] text-white backdrop-blur-md transition hover:bg-black/80";

export const EPUB_READER_CHAPTER_NAV_BUTTON_CLASS =
  "flex size-[5.625rem] items-center justify-center rounded-full border border-[#FFFFFF33] bg-[#FFFFFF1A] text-white backdrop-blur-sm transition hover:bg-white/20";

export const EPUB_READER_BOTTOM_BAR_CLASS =
  "flex h-24 w-full items-center justify-between gap-6 rounded-xl border border-[#FFFFFF1A] bg-[#00000099] px-8 text-white backdrop-blur-md";
