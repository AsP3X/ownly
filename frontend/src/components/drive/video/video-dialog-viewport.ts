// Human: Desktop video dialog sizing — 1.25× Pencil baseline, always inside padded DialogContent.
// Agent: EXPORTS Tailwind height class; subtracts p-4 (2rem) from 100dvh so the shell never clips.

/** Human: 1.25× of 900px Pencil player height — pixel cap on large monitors. */
export const VIDEO_PLAYER_MAX_HEIGHT_PX = 1125;

/** Human: 1.25× of 1200px Pencil player width — pixel cap on wide monitors. */
export const VIDEO_PLAYER_MAX_WIDTH_PX = 1500;

// Human: Row/card height — min(pixel cap, viewport minus dialog vertical padding).
// Agent: USED by VideoPreviewDialog shell; player card uses videoDialogPlayerShellClass.
export const videoDialogRowHeightClass =
  "h-[min(1125px,calc(100dvh-2rem))]" as const;

// Human: Width-first 4:3 card — height follows width; both axes respect viewport and pixel caps.
// Agent: 100% is flex-row space left after chevrons; calc(100dvh-2rem) matches DialogContent p-4.
export const videoDialogPlayerShellClass =
  "h-auto min-w-0 max-h-[min(1125px,calc(100dvh-2rem))] w-[min(1500px,100%,calc(min(1125px,calc(100dvh-2rem))*4/3))] shrink-0 aspect-[4/3]" as const;
