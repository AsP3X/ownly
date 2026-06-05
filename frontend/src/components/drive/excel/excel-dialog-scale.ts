// Human: Pencil Excel Dialog Frame baseline (sgOxg 1200×850) — scale applied to shell + chrome.
// Agent: EXPORTS scale multiplier + scaledPx helper for grid/ribbon layout constants.

// Human: Was 1.5×; reduced by 0.5 to native Pencil pixel baselines (1×).
// Agent: MULTIPLIED by scaledPx and dimension import/export in dimensions.ts.
export const EXCEL_DIALOG_SCALE = 1;

// Human: Round Pencil pixel baselines to whole CSS pixels at the active scale.
// Agent: RETURNS number for inline styles and Tailwind arbitrary values.
export function scaledPx(base: number): number {
  return Math.round(base * EXCEL_DIALOG_SCALE);
}
