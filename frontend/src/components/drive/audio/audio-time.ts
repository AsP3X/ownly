// Human: Shared time formatting helpers for the drive audio seek bar and player readouts.
// Agent: PURE functions; RETURNS m:ss strings and signed delta labels for hover tooltips.

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatAudioDelta(seconds: number): string {
  const sign = seconds >= 0 ? "+" : "-";
  const absSeconds = Math.abs(Math.round(seconds));
  const m = Math.floor(absSeconds / 60);
  const s = Math.floor(absSeconds % 60);
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}
