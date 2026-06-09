// Human: Filename display helpers for explorer grid tiles — one line with visible extension.
// Agent: SPLITS base + extension; USED by ExplorerGridFileName in grid tiles.

/** Human: Split a filename into truncatable base and a suffix that must stay visible (.xlsx, etc.). */
export function splitFilenameExtension(filename: string): { base: string; extension: string } {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf(".");
  // Human: Leading-dot names (.gitignore) and trailing dots have no separate extension segment.
  // Agent: RETURNS whole string as base when extension cannot be identified safely.
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return { base: trimmed, extension: "" };
  }
  return {
    base: trimmed.slice(0, lastDot),
    extension: trimmed.slice(lastDot),
  };
}
