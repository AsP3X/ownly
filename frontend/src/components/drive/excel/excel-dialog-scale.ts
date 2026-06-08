// Human: Pencil Excel Dialog Frame baseline (sgOxg 1200×850) — scale applied to shell + chrome.
// Agent: EXPORTS scale multiplier + scaledPx helper for grid/ribbon layout constants.

// Human: Midpoint between 1.5× and 1× Pencil baselines — readable without dominating the viewport.
// Agent: MULTIPLIED by scaledPx and dimension import/export in dimensions.ts.
export const EXCEL_DIALOG_SCALE = 1.25;

// Human: Uniform viewport inset — 1rem on every edge inside the modal overlay.
// Agent: DialogContent uses fixed inset-0 + p-4; shell flex-fills the padded box on all desktops.
export const EXCEL_DIALOG_VIEWPORT_INSET = "1rem";
export const EXCEL_DIALOG_VIEWPORT_INSET_CSS = "2rem";

// Human: Pencil design height cap on very tall monitors (optional aesthetic ceiling).
// Agent: Shell uses flex-1 by default; cap only limits growth above this pixel height.
export const EXCEL_DIALOG_SHELL_MAX_HEIGHT_PX = 1063;
export const EXCEL_DESKTOP_MIN_WIDTH_PX = 1024;

// Human: Full-viewport desktop dialog wrapper — inset positioning avoids transform clipping.
// Agent: motionlessPopup + these classes; p-4 yields 1rem margin on every side.
export const excelDialogContentClass =
  "flex h-[100svh] min-h-0 w-full flex-col gap-0 overflow-hidden border-0 bg-transparent p-4 shadow-none ring-0 supports-[height:100dvh]:h-dvh" as const;

// Human: White Excel card — flex-fills padded dialog area on any desktop viewport size.
// Agent: min-h-0/min-w-0 let grid/ribbon shrink inside the flex column.
export const excelDialogShellClass =
  "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]" as const;

// Human: Copilot rail widths — full panel vs collapsed ledge that stays on the right edge.
// Agent: EXPANDED uses Pencil 280×1.25; LEDGE is wide enough for icon + expand affordance.
export const EXCEL_COPILOT_SIDEBAR_WIDTH_BASE = 280;
export const EXCEL_COPILOT_LEDGE_WIDTH_BASE = 28;

// Human: Round Pencil pixel baselines to whole CSS pixels at the active scale.
// Agent: RETURNS number for inline styles and Tailwind arbitrary values.
export function scaledPx(base: number): number {
  return Math.round(base * EXCEL_DIALOG_SCALE);
}
