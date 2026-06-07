// Human: Shared timing constants for iOS GIF server transcode progress UI.
// Agent: MATCHES backend GIF_PREVIEW_TRANSCODE_TIMEOUT (60s); USED by progress hooks and client abort.

/** Human: Server ffmpeg wall-clock limit — must match `gif_preview.rs`. */
export const GIF_SERVER_TRANSCODE_TIMEOUT_MS = 60_000;

/** Human: Client aborts slightly after the server timeout to allow error responses through. */
export const GIF_SERVER_TRANSCODE_CLIENT_TIMEOUT_MS = GIF_SERVER_TRANSCODE_TIMEOUT_MS + 8_000;

export const TRANSCODE_PROGRESS_START = 6;
export const TRANSCODE_PROGRESS_CAP = 92;
export const TICKET_RESOLVE_PROGRESS_CAP = 14;

// Human: Map elapsed wall time to a monotonic 6–92% estimate for server-side ffmpeg.
// Agent: LINEAR ease over GIF_SERVER_TRANSCODE_TIMEOUT_MS; RETURNS null when inactive.
export function estimateServerTranscodeProgress(
  active: boolean,
  elapsedMs: number,
): number | null {
  if (!active) return null;
  const ratio = Math.min(1, Math.max(0, elapsedMs / GIF_SERVER_TRANSCODE_TIMEOUT_MS));
  return (
    TRANSCODE_PROGRESS_START +
    (TRANSCODE_PROGRESS_CAP - TRANSCODE_PROGRESS_START) * ratio
  );
}

// Human: Short ramp while resolving preview-animation ticket URL (no ffmpeg yet).
// Agent: CAPS at TICKET_RESOLVE_PROGRESS_CAP over ~2.5s.
export function estimateTicketResolveProgress(
  active: boolean,
  elapsedMs: number,
): number | null {
  if (!active) return null;
  const ratio = Math.min(1, Math.max(0, elapsedMs / 2_500));
  return (
    TRANSCODE_PROGRESS_START +
    (TICKET_RESOLVE_PROGRESS_CAP - TRANSCODE_PROGRESS_START) * ratio
  );
}
