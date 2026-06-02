// Human: Client-side storage checks for the upload picker — warn without blocking selection.
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

// Human: Assign storage warnings in list order — earlier rows consume remaining for later rows.
// Agent: SIMULATES cumulative pending sizes; WRITES storageWarning per row.
export function applyStorageWarningsInOrder<T extends { fileSize: number }>(
  rows: T[],
  effectiveRemainingBytes: number,
): (T & { storageWarning: string | null })[] {
  let remaining = effectiveRemainingBytes;
  return rows.map((row) => {
    const warning = storageWarningForFile(row.fileSize, remaining);
    if (!warning && Number.isFinite(remaining)) {
      remaining = Math.max(0, remaining - row.fileSize);
    }
    return { ...row, storageWarning: warning };
  });
}
