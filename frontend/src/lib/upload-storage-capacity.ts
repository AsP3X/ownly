// Human: Client-side storage quota checks for the upload picker — warn without blocking selection.
// Agent: READS dashboard used_bytes + quota_bytes; RETURNS per-file warnings for UploadDialog rows.

import { formatBytes } from "@/lib/utils-app";

/** Human: Bytes still available under the user's library quota before pending uploads. */
export function remainingStorageBytes(usedBytes: number, quotaBytes: number): number {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const used = Number.isFinite(usedBytes) ? Math.max(0, usedBytes) : 0;
  return Math.max(0, quotaBytes - used);
}

/** Human: Warning copy when a single file cannot fit in remaining quota. */
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

// Human: Assign storage warnings in list order — earlier rows consume remaining quota for later rows.
// Agent: SIMULATES cumulative pending sizes atop server used_bytes; WRITES storageWarning per row.
export function applyStorageWarningsInOrder<T extends { fileSize: number }>(
  rows: T[],
  usedBytes: number,
  quotaBytes: number,
): (T & { storageWarning: string | null })[] {
  let remaining = remainingStorageBytes(usedBytes, quotaBytes);
  return rows.map((row) => {
    const warning = storageWarningForFile(row.fileSize, remaining);
    if (!warning && Number.isFinite(remaining)) {
      remaining = Math.max(0, remaining - row.fileSize);
    }
    return { ...row, storageWarning: warning };
  });
}
