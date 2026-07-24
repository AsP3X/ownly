// Human: Adaptive upload concurrency and chunk sizing from recent success/latency samples.
// Agent: RECORD part outcomes; READ suggested concurrency + chunk size for resumable client.

/** Human: Hard floor/ceiling for parallel part PUTs (aligned with storage pressure). */
export const ADAPTIVE_PART_CONCURRENCY_MIN = 1;
export const ADAPTIVE_PART_CONCURRENCY_MAX = 4;
export const ADAPTIVE_PART_CONCURRENCY_DEFAULT = 2;

/** Human: Concurrent browser file slots (independent of part concurrency). */
export const ADAPTIVE_FILE_CONCURRENCY_MIN = 1;
export const ADAPTIVE_FILE_CONCURRENCY_MAX = 3;
export const ADAPTIVE_FILE_CONCURRENCY_DEFAULT = 2;

/** Human: Chunk bounds must stay within backend MIN/MAX (1–32 MiB). */
export const ADAPTIVE_CHUNK_MIN_BYTES = 4 * 1024 * 1024;
export const ADAPTIVE_CHUNK_MAX_BYTES = 16 * 1024 * 1024;
export const ADAPTIVE_CHUNK_DEFAULT_BYTES = 16 * 1024 * 1024;

type PartSample = {
  ok: boolean;
  durationMs: number;
  bytes: number;
  at: number;
};

const samples: PartSample[] = [];
const SAMPLE_WINDOW = 12;

// Human: Record one part PUT outcome for adaptive tuning.
// Agent: PUSH sample; TRIM to SAMPLE_WINDOW; USED after direct or proxy part completes.
export function recordUploadPartSample(input: {
  ok: boolean;
  durationMs: number;
  bytes: number;
}): void {
  samples.push({
    ok: input.ok,
    durationMs: Math.max(0, input.durationMs),
    bytes: Math.max(0, input.bytes),
    at: Date.now(),
  });
  while (samples.length > SAMPLE_WINDOW) {
    samples.shift();
  }
}

// Human: Suggested parallel part workers from recent error rate and throughput.
// Agent: ERROR rate high → 1; healthy low latency → up to MAX; DEFAULT when few samples.
export function suggestedPartConcurrency(): number {
  if (samples.length < 3) {
    return ADAPTIVE_PART_CONCURRENCY_DEFAULT;
  }
  const recent = samples.slice(-SAMPLE_WINDOW);
  const failures = recent.filter((s) => !s.ok).length;
  const failRate = failures / recent.length;
  if (failRate >= 0.35) {
    return ADAPTIVE_PART_CONCURRENCY_MIN;
  }

  const ok = recent.filter((s) => s.ok && s.durationMs > 0);
  if (ok.length === 0) {
    return ADAPTIVE_PART_CONCURRENCY_DEFAULT;
  }
  const avgMs = ok.reduce((sum, s) => sum + s.durationMs, 0) / ok.length;
  // Human: Fast LAN parts (< 1.5s for ~16 MiB) can use more parallelism.
  if (avgMs < 1_500 && failRate < 0.1) {
    return ADAPTIVE_PART_CONCURRENCY_MAX;
  }
  if (avgMs < 4_000 && failRate < 0.2) {
    return 3;
  }
  return ADAPTIVE_PART_CONCURRENCY_DEFAULT;
}

// Human: Suggested chunk size for new sessions — smaller on flaky networks, larger on fast ones.
// Agent: USED only when creating a session (not mid-upload); RETURNS bytes in backend-safe range.
export function suggestedChunkSizeBytes(): number {
  if (samples.length < 3) {
    return ADAPTIVE_CHUNK_DEFAULT_BYTES;
  }
  const recent = samples.slice(-SAMPLE_WINDOW);
  const failures = recent.filter((s) => !s.ok).length;
  const failRate = failures / recent.length;
  if (failRate >= 0.3) {
    return ADAPTIVE_CHUNK_MIN_BYTES;
  }

  const ok = recent.filter((s) => s.ok && s.durationMs > 0 && s.bytes > 0);
  if (ok.length === 0) {
    return ADAPTIVE_CHUNK_DEFAULT_BYTES;
  }
  const throughput =
    ok.reduce((sum, s) => sum + s.bytes / (s.durationMs / 1000), 0) / ok.length;
  // Human: > 8 MiB/s → full 16 MiB chunks; slow links use 8 or 4 MiB.
  if (throughput > 8 * 1024 * 1024) {
    return ADAPTIVE_CHUNK_MAX_BYTES;
  }
  if (throughput > 2 * 1024 * 1024) {
    return 8 * 1024 * 1024;
  }
  return ADAPTIVE_CHUNK_MIN_BYTES;
}

// Human: Suggested concurrent file uploads for the batch pump.
// Agent: MIRRORS part concurrency pressure — failures lower file slots too.
export function suggestedFileConcurrency(): number {
  if (samples.length < 3) {
    return ADAPTIVE_FILE_CONCURRENCY_DEFAULT;
  }
  const recent = samples.slice(-SAMPLE_WINDOW);
  const failRate = recent.filter((s) => !s.ok).length / recent.length;
  if (failRate >= 0.35) {
    return ADAPTIVE_FILE_CONCURRENCY_MIN;
  }
  const ok = recent.filter((s) => s.ok && s.durationMs > 0);
  if (ok.length === 0) {
    return ADAPTIVE_FILE_CONCURRENCY_DEFAULT;
  }
  const avgMs = ok.reduce((sum, s) => sum + s.durationMs, 0) / ok.length;
  if (avgMs < 1_500 && failRate < 0.1) {
    return ADAPTIVE_FILE_CONCURRENCY_MAX;
  }
  return ADAPTIVE_FILE_CONCURRENCY_DEFAULT;
}

// Human: Estimate remaining seconds from recent successful throughput and remaining bytes.
// Agent: RETURNS null when no good samples; USED by transfer panel ETA line.
export function estimateRemainingSeconds(remainingBytes: number): number | null {
  if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) {
    return 0;
  }
  const ok = samples.filter((s) => s.ok && s.durationMs > 0 && s.bytes > 0).slice(-8);
  if (ok.length < 2) {
    return null;
  }
  const throughput =
    ok.reduce((sum, s) => sum + s.bytes / (s.durationMs / 1000), 0) / ok.length;
  if (throughput <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(remainingBytes / throughput));
}

/** Human: Test helper — clear samples between unit tests. */
export function __resetUploadAdaptiveForTests(): void {
  samples.length = 0;
}
