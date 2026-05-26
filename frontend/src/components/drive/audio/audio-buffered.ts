// Human: Normalized buffered time ranges from the HTMLMediaElement TimeRanges API.
// Agent: READS audio.buffered; RETURNS {start,end}[] for seek bar segment rendering.

export type BufferedSegment = {
  start: number;
  end: number;
};

export function readBufferedSegments(
  buffered: Pick<TimeRanges, "length" | "start" | "end">,
): BufferedSegment[] {
  const segments: BufferedSegment[] = [];
  for (let index = 0; index < buffered.length; index += 1) {
    const start = buffered.start(index);
    const end = buffered.end(index);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    segments.push({ start, end });
  }
  return segments;
}
