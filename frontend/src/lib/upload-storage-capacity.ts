// Human: Client-side storage checks for the upload picker — run after duplicate detection, never at selection time.
// Agent: READS dashboard effective_remaining_bytes (user quota ∩ network capacity); WRITES per-file warnings.

import { formatBytes } from "@/lib/utils-app";

/** Human: Dashboard fields used to compute how much can still be uploaded. */
export type UploadStorageSnapshot = {
  used_bytes: number;
  quota_bytes: number;
  network_remaining_bytes?: number | null;
  effective_remaining_bytes?: number | null;
};

// Human: Remaining bytes the user can still upload (from GET /dashboard).
// Agent: PREFERS effective_remaining_bytes; FALLBACK to quota-only when network uncapped.
export function effectiveRemainingFromDashboard(snapshot: UploadStorageSnapshot): number {
  if (
    snapshot.effective_remaining_bytes != null &&
    Number.isFinite(snapshot.effective_remaining_bytes)
  ) {
    return Math.max(0, snapshot.effective_remaining_bytes);
  }
  return remainingQuotaBytes(snapshot.used_bytes, snapshot.quota_bytes);
}

/** Human: Bytes still available under the user's library quota. */
export function remainingQuotaBytes(usedBytes: number, quotaBytes: number): number {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const used = Number.isFinite(usedBytes) ? Math.max(0, usedBytes) : 0;
  return Math.max(0, quotaBytes - used);
}

/** Human: Warning copy when a file cannot fit in remaining storage. */
export function storageWarningForFile(fileSize: number, remainingBytes: number): string | null {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return null;
  }
  if (!Number.isFinite(remainingBytes) || remainingBytes === Number.POSITIVE_INFINITY) {
    return null;
  }
  if (fileSize > remainingBytes) {
    return `This file (${formatBytes(fileSize)}) is larger than your remaining storage (${formatBytes(remainingBytes)}) and cannot be stored.`;
  }
  return null;
}

/** Human: Outcome of the capacity check run on the files that survived duplicate detection. */
export type UploadCapacitySplit<T> = {
  /** Rows that fit in the remaining storage, in selection order. */
  fitting: T[];
  /** Rows that do not fit, each carrying the warning shown on its picker row. */
  blocked: (T & { storageWarning: string })[];
  /** Total bytes the surviving (non-duplicate) selection would consume. */
  requiredBytes: number;
};

// Human: Split the post-duplicate upload set into what fits in remaining storage and what does not.
// Agent: WALKS rows in order consuming remaining; RUN only after hashing + duplicate detection, never at selection time.
export function splitUploadsByCapacity<T>(
  rows: T[],
  effectiveRemainingBytes: number,
  sizeOf: (row: T) => number,
): UploadCapacitySplit<T> {
  const fitting: T[] = [];
  const blocked: (T & { storageWarning: string })[] = [];
  let remaining = effectiveRemainingBytes;
  let requiredBytes = 0;

  for (const row of rows) {
    const fileSize = sizeOf(row);
    requiredBytes += Number.isFinite(fileSize) ? Math.max(0, fileSize) : 0;
    const warning = storageWarningForFile(fileSize, remaining);
    if (warning) {
      blocked.push({ ...row, storageWarning: warning });
      continue;
    }
    if (Number.isFinite(remaining)) {
      remaining = Math.max(0, remaining - fileSize);
    }
    fitting.push(row);
  }

  return { fitting, blocked, requiredBytes };
}

// Human: Notice copy when duplicate-free files still overflow the remaining storage.
// Agent: READS blocked/required/remaining byte counts; USED by the upload picker banner.
export function storageOverflowNotice(
  blockedCount: number,
  requiredBytes: number,
  remainingBytes: number,
): string {
  const scale = Number.isFinite(remainingBytes)
    ? ` The files left after duplicate checks need ${formatBytes(requiredBytes)} but only ${formatBytes(remainingBytes)} is left.`
    : "";
  return `${blockedCount} file${blockedCount === 1 ? "" : "s"} do${blockedCount === 1 ? "es" : ""} not fit in your remaining storage.${scale} Press Upload again to send the rest, or remove files and free space first.`;
}
