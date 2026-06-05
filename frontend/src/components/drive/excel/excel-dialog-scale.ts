// Human: 1.5× Pencil Excel Dialog Frame baseline (sgOxg 1200×850) — matches PdfPreviewDialog scaling.
// Agent: EXPORTS scale multiplier + scaledPx helper for grid/ribbon layout constants.

export const EXCEL_DIALOG_SCALE = 1.5;

// Human: Round Pencil pixel baselines to whole CSS pixels at 1.5× scale.
// Agent: RETURNS number for inline styles and Tailwind arbitrary values.
export function scaledPx(base: number): number {
  return Math.round(base * EXCEL_DIALOG_SCALE);
}
