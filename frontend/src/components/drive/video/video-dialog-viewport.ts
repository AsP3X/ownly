// Human: Desktop video dialog sizing — 1.25× Pencil baseline, always inside padded DialogContent.
// Agent: EXPORTS pixel caps + Tailwind literals; player shell dimensions use inline styles (not dynamic class strings).

/** Human: 1.25× of 900px Pencil player height — pixel cap on large monitors. */
export const VIDEO_PLAYER_MAX_HEIGHT_PX = 1125;

/** Human: 1.25× of 1200px Pencil player width — pixel cap on wide monitors. */
export const VIDEO_PLAYER_MAX_WIDTH_PX = 1500;

/** Human: Vertical padding inside desktop DialogContent — matches Excel inset (p-4 × 2). */
export const VIDEO_DIALOG_VIEWPORT_INSET_CSS = "2rem";

/** Human: Square desktop player height cap (900px Pencil baseline). */
export const VIDEO_PLAYER_SQUARE_MAX_HEIGHT_PX = 900;

/** Human: Portrait desktop player max width — 1.25× Pencil 540px column. */
export const VIDEO_PLAYER_PORTRAIT_MAX_WIDTH_PX = 675;

// Human: Tailwind literal — must stay a plain string so @tailwindcss scan emits the rule.
// Agent: Prefer resolveDesktopVideoShellLayout inline styles; kept for safelist / legacy imports.
export const videoDialogDesktopPlayerHeightClass =
  "h-[min(1125px,calc(100dvh-2rem))]" as const;

// Human: Full-viewport desktop dialog wrapper — inset positioning avoids transform clipping.
// Agent: motionlessPopup + these classes; p-4 yields 1rem margin on every side (not fullscreen).
export const videoDialogDesktopContentClass =
  "flex h-[100svh] min-h-0 w-full flex-col gap-0 overflow-hidden border-0 bg-transparent p-4 shadow-none ring-0 supports-[height:100dvh]:h-dvh" as const;

// Human: Desktop row — flex-fills padded dialog; flanking gallery chevrons + centered player column.
// Agent: flex-1 min-h-0; player shell uses inline height (Tailwind h-[min(...)] is not reliably scanned).
export const videoDialogDesktopRowClass =
  "flex min-h-0 w-full max-w-full flex-1 items-stretch justify-center gap-6" as const;

/** @deprecated Use videoDialogDesktopRowClass — kept for imports that expect row height token. */
export const videoDialogRowHeightClass = videoDialogDesktopRowClass;

// Human: Default landscape shell alias — height-first 4:3 card inside the dialog row.
// Agent: Vertical/square sources use resolveDesktopVideoShellLayout instead.
export const videoDialogPlayerShellClass =
  "h-[min(1125px,calc(100dvh-2rem))] w-auto min-w-0 max-w-[min(1500px,100%)] shrink-0 aspect-[4/3]" as const;
