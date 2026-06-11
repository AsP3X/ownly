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

// Human: Default landscape shell alias — height-first 4:3 card inside the dialog row.
// Agent: Vertical/square sources use orientation shells from video-player-layout.ts instead.
export const videoDialogPlayerShellClass =
  "h-full max-h-[min(1125px,calc(100dvh-2rem))] w-auto min-w-0 max-w-[min(1500px,100%)] shrink-0 aspect-[4/3]" as const;
