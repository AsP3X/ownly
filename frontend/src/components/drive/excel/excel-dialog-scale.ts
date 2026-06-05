// Human: Pencil Excel Dialog Frame baseline (sgOxg 1200×850) — scale applied to shell + chrome.
// Agent: EXPORTS scale multiplier + scaledPx helper for grid/ribbon layout constants.

// Human: Midpoint between 1.5× and 1× Pencil baselines — readable without dominating the viewport.
// Agent: MULTIPLIED by scaledPx and dimension import/export in dimensions.ts.
export const EXCEL_DIALOG_SCALE = 1.25;

// Human: Round Pencil pixel baselines to whole CSS pixels at the active scale.
// Agent: RETURNS number for inline styles and Tailwind arbitrary values.
export function scaledPx(base: number): number {
  return Math.round(base * EXCEL_DIALOG_SCALE);
}
