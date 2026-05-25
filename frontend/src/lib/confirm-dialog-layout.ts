// Human: Size delete confirmation modals from the longest visible label, up to a character cap.
// Agent: READS string lengths; RETURNS inline maxWidth in ch units; EXPORT cap for truncate decisions.

import type { CSSProperties } from "react";

/** Default narrow width (~28rem / 448px) for short filenames and titles. */
const CONFIRM_DIALOG_WIDTH_MIN_CH = 28;

/** Widest the dialog grows before filenames truncate with ellipsis. */
const CONFIRM_DIALOG_WIDTH_MAX_CH = 72;

/** Longest filename (or quoted name) that still expands modal width; beyond this, width is capped. */
export const CONFIRM_DIALOG_WIDTH_GROWTH_CAP_CHARS = 60;

/** Horizontal chrome: padding, trash icon, and absolute close button. */
const CONFIRM_DIALOG_WIDTH_CHROME_CH = 14;

// Human: Map the longest label length to a modal max-width capped at CONFIRM_DIALOG_WIDTH_MAX_CH.
// Agent: RETURNS CSSProperties maxWidth using min(ch, viewport gutter) for DialogContent style prop.
export function confirmDialogWidthStyle(textLengths: Iterable<number>): CSSProperties {
  const longest = Math.max(0, ...textLengths);
  const growChars = Math.min(longest, CONFIRM_DIALOG_WIDTH_GROWTH_CAP_CHARS);
  const widthCh = Math.max(
    CONFIRM_DIALOG_WIDTH_MIN_CH,
    Math.min(CONFIRM_DIALOG_WIDTH_MAX_CH, growChars + CONFIRM_DIALOG_WIDTH_CHROME_CH),
  );

  return {
    maxWidth: `min(${widthCh}ch, calc(100% - 2rem))`,
  };
}

// Human: Decide when list rows should ellipsize instead of expanding the modal further.
// Agent: COMPARES label length to CONFIRM_DIALOG_WIDTH_GROWTH_CAP_CHARS; RETURNS boolean.
export function confirmDialogLabelTruncates(labelLength: number): boolean {
  return labelLength > CONFIRM_DIALOG_WIDTH_GROWTH_CAP_CHARS;
}
