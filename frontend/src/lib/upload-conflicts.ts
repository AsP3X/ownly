// Human: Classify pending upload rows for recycle restore, duplicate skip, or normal upload.
// Agent: PURE helpers; READS duplicate + recycle match payloads; RETURNS plan counts + ids.

import type { UploadNameDuplicate, UploadRecycleMatch } from "@/api/client";

export type PendingUploadFile = {
  file: File;
  contentHash?: string;
};

export type UploadConflictPlan = {
  restoreFileIds: string[];
  uploadFiles: File[];
  restoreCount: number;
  uploadCount: number;
  skipDuplicateCount: number;
};

// Human: Find the recycle-bin row that exactly matches one pending upload candidate.
// Agent: MATCHES upload_name + upload_size_bytes against browser File name + size.
export function findRecycleMatchForFile(
  file: File,
  recycleMatches: UploadRecycleMatch[],
): UploadRecycleMatch | undefined {
  return recycleMatches.find(
    (entry) => entry.upload_name === file.name && entry.upload_size_bytes === file.size,
  );
}

// Human: Build restore/upload/skip counts for the conflict dialog primary action label.
// Agent: CALLS buildUploadConflictPlan with skipDuplicates=true and restoreRecycle=true.
export function buildSmartContinueLabel(
  pendingFiles: PendingUploadFile[],
  duplicates: UploadNameDuplicate[],
  recycleMatches: UploadRecycleMatch[],
): string {
  const plan = buildUploadConflictPlan(pendingFiles, duplicates, recycleMatches, {
    skipDuplicates: true,
    restoreRecycle: true,
  });
  const parts: string[] = [];
  if (plan.restoreCount > 0) {
    parts.push(`restore ${plan.restoreCount}`);
  }
  if (plan.uploadCount > 0) {
    parts.push(`upload ${plan.uploadCount}`);
  }
  if (plan.skipDuplicateCount > 0) {
    parts.push(`skip ${plan.skipDuplicateCount}`);
  }
  return parts.length > 0 ? `Continue (${parts.join(" · ")})` : "Continue";
}

// Human: Split a pending batch into recycle restores, skipped duplicates, and uploads.
// Agent: DEDUPES restore ids; SKIPS rows whose content hash already exists when enabled.
export function buildUploadConflictPlan(
  pendingFiles: PendingUploadFile[],
  duplicates: UploadNameDuplicate[],
  recycleMatches: UploadRecycleMatch[],
  options: { skipDuplicates: boolean; restoreRecycle: boolean },
): UploadConflictPlan {
  const duplicateHashes = options.skipDuplicates
    ? new Set(duplicates.map((entry) => entry.upload_content_hash))
    : new Set<string>();

  const restoreFileIds: string[] = [];
  const restoredRecycleIds = new Set<string>();
  let restoreCount = 0;
  let skipDuplicateCount = 0;

  for (const item of pendingFiles) {
    if (item.contentHash && duplicateHashes.has(item.contentHash)) {
      skipDuplicateCount += 1;
      continue;
    }

    const recycleMatch = findRecycleMatchForFile(item.file, recycleMatches);

    if (options.restoreRecycle && recycleMatch?.trashed.can_restore) {
      if (!restoredRecycleIds.has(recycleMatch.trashed.id)) {
        restoreFileIds.push(recycleMatch.trashed.id);
        restoredRecycleIds.add(recycleMatch.trashed.id);
        restoreCount += 1;
      }
      continue;
    }
  }

  const uploadFiles = pendingFiles
    .filter((item) => {
      if (item.contentHash && duplicateHashes.has(item.contentHash)) {
        return false;
      }
      if (!options.restoreRecycle) {
        return true;
      }
      const recycleMatch = findRecycleMatchForFile(item.file, recycleMatches);
      if (recycleMatch?.trashed.can_restore) {
        return false;
      }
      return true;
    })
    .map((item) => item.file);

  return {
    restoreFileIds,
    uploadFiles,
    restoreCount,
    uploadCount: uploadFiles.length,
    skipDuplicateCount,
  };
}
