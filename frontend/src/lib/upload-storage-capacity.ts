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

/** Human: Which ceiling is currently binding upload headroom. */
export type StorageLimitKind = "quota" | "network" | "none";

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

// Human: Decide whether the account quota or the storage-node network is the tighter limit.
// Agent: COMPARES user remaining vs network_remaining_bytes; USED for warning copy after a quota raise.
export function limitingStorageKind(snapshot: UploadStorageSnapshot): StorageLimitKind {
  const userRemaining = remainingQuotaBytes(snapshot.used_bytes, snapshot.quota_bytes);
  const network =
    snapshot.network_remaining_bytes != null && Number.isFinite(snapshot.network_remaining_bytes)
      ? Math.max(0, snapshot.network_remaining_bytes)
      : Number.POSITIVE_INFINITY;
  if (userRemaining === Number.POSITIVE_INFINITY && network === Number.POSITIVE_INFINITY) {
    return "none";
  }
  // Human: When equal, prefer naming the network — raising account quota alone will not free space.
  if (network <= userRemaining) {
    return "network";
  }
  return "quota";
}

/** Human: Warning copy when a file cannot fit in remaining storage. */
export function storageWarningForFile(
  fileSize: number,
  remainingBytes: number,
  limitKind: StorageLimitKind = "quota",
): string | null {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return null;
  }
  if (!Number.isFinite(remainingBytes) || remainingBytes === Number.POSITIVE_INFINITY) {
    return null;
  }
  if (fileSize <= remainingBytes) {
    return null;
  }
  if (limitKind === "network") {
    return `This file (${formatBytes(fileSize)}) is larger than free space on the storage network (${formatBytes(remainingBytes)}) and cannot be stored. Ask an administrator to free disk space or raise the storage node capacity — increasing your account quota alone is not enough when the network is full.`;
  }
  return `This file (${formatBytes(fileSize)}) is larger than your remaining library storage (${formatBytes(remainingBytes)}) and cannot be stored. Delete files or ask an administrator for a higher account quota.`;
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
  limitKind: StorageLimitKind = "quota",
): UploadCapacitySplit<T> {
  const fitting: T[] = [];
  const blocked: (T & { storageWarning: string })[] = [];
  let remaining = effectiveRemainingBytes;
  let requiredBytes = 0;

  for (const row of rows) {
    const fileSize = sizeOf(row);
    requiredBytes += Number.isFinite(fileSize) ? Math.max(0, fileSize) : 0;
    const warning = storageWarningForFile(fileSize, remaining, limitKind);
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
  limitKind: StorageLimitKind = "quota",
): string {
  const scale = Number.isFinite(remainingBytes)
    ? ` The files left after duplicate checks need ${formatBytes(requiredBytes)} but only ${formatBytes(remainingBytes)} is left.`
    : "";
  if (limitKind === "network") {
    return `${blockedCount} file${blockedCount === 1 ? "" : "s"} do${blockedCount === 1 ? "es" : ""} not fit on the storage network.${scale} Free disk space or raise storage node capacity, then press Upload again for the rest.`;
  }
  return `${blockedCount} file${blockedCount === 1 ? "" : "s"} do${blockedCount === 1 ? "es" : ""} not fit in your remaining library storage.${scale} Press Upload again to send the rest, or remove files and free space first.`;
}
