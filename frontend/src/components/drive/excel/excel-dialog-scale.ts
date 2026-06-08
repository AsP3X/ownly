// Human: Pencil Excel Dialog Frame baseline (sgOxg 1200×850) — scale applied to shell + chrome.
// Agent: EXPORTS scale multiplier + scaledPx helper for grid/ribbon layout constants.

// Human: Midpoint between 1.5× and 1× Pencil baselines — readable without dominating the viewport.
// Agent: MULTIPLIED by scaledPx and dimension import/export in dimensions.ts.
export const EXCEL_DIALOG_SCALE = 1.25;

// Human: Viewport inset on every edge — 1rem margin × 2 (top+bottom or left+right).
// Agent: USED in shell width/height calcs and DialogContent max dimensions.
export const EXCEL_DIALOG_VIEWPORT_INSET_CSS = "2rem";

// Human: Desktop Excel shell height — design max 1063px but never taller than viewport minus inset.
// Agent: USED on viewer card; inset matches horizontal shell width for uniform edge margin.
export const EXCEL_DIALOG_SHELL_MAX_HEIGHT_PX = 1063;
export const EXCEL_DESKTOP_MIN_WIDTH_PX = 1024;

// Human: Copilot rail widths — full panel vs collapsed ledge that stays on the right edge.
// Agent: EXPANDED uses Pencil 280×1.25; LEDGE is wide enough for icon + expand affordance.
export const EXCEL_COPILOT_SIDEBAR_WIDTH_BASE = 280;
export const EXCEL_COPILOT_LEDGE_WIDTH_BASE = 28;

// Human: Round Pencil pixel baselines to whole CSS pixels at the active scale.
// Agent: RETURNS number for inline styles and Tailwind arbitrary values.
export function scaledPx(base: number): number {
  return Math.round(base * EXCEL_DIALOG_SCALE);
}
