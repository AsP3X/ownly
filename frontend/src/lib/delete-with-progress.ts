// Human: Helpers for delete confirmation dialogs — preview thresholds and job polling.
// Agent: READS BulkDeletionPreview/FileDeletionPreview; CALLS fetchDeleteJobStatus until ready.

import {
  fetchDeleteJobStatus,
  startDeleteJob,
  startRecycleBinEmptyDeleteJob,
  type DeleteJobStatus,
} from "@/api/client";

/** Show blob progress UI when more than one file or more than this many storage objects. */
export const DELETE_JOB_BLOB_THRESHOLD = 10;

/** Must match backend `MAX_DELETE_FILES_PER_JOB` for POST /files/delete. */
export const MAX_DELETE_FILES_PER_JOB = 500;

const DELETE_JOB_POLL_MS = 300;

// Human: Split a large id list into API-sized chunks for sequential delete jobs.
// Agent: READS fileIds; RETURNS slices of at most MAX_DELETE_FILES_PER_JOB ids.
function chunkFileIds(fileIds: string[]): string[][] {
  if (fileIds.length <= MAX_DELETE_FILES_PER_JOB) {
    return [fileIds];
  }
  const chunks: string[][] = [];
  for (let offset = 0; offset < fileIds.length; offset += MAX_DELETE_FILES_PER_JOB) {
    chunks.push(fileIds.slice(offset, offset + MAX_DELETE_FILES_PER_JOB));
  }
  return chunks;
}

// Human: Merge in-flight job status into running totals for multi-chunk deletes.
// Agent: READS chunk status + prior totals; RETURNS synthetic DeleteJobStatus for progress UI.
function mergeDeleteJobProgress(
  chunkStatus: DeleteJobStatus,
  totals: { total_files: number; total_blobs: number },
  prior: { deleted_files: number; deleted_blobs: number },
): DeleteJobStatus {
  const deleted_files = prior.deleted_files + chunkStatus.deleted_files;
  const deleted_blobs = prior.deleted_blobs + chunkStatus.deleted_blobs;
  const progress =
    totals.total_blobs > 0
      ? Math.min(
          100,
          Math.round((deleted_blobs / totals.total_blobs) * 100),
        )
      : totals.total_files > 0
        ? Math.min(
            100,
            Math.round((deleted_files / totals.total_files) * 100),
          )
        : chunkStatus.progress;

  return {
    ...chunkStatus,
    total_files: totals.total_files,
    total_blobs: totals.total_blobs,
    deleted_files,
    deleted_blobs,
    progress,
    ready: false,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Human: Decide whether to use the async blob-progress delete job vs a single sync DELETE.
// Agent: RETURNS true when file_count > 1 OR storage_object_count exceeds threshold.
export function shouldUseDeleteJob(preview: {
  file_count: number;
  storage_object_count: number;
}): boolean {
  return (
    preview.file_count > 1 ||
    preview.storage_object_count > DELETE_JOB_BLOB_THRESHOLD
  );
}

// Human: Poll one delete job until ready.
// Agent: LOOPS fetchDeleteJobStatus; INVOKES onProgress; RETURNS final status.
async function pollDeleteJobUntilReady(
  initialStatus: DeleteJobStatus,
  onProgress: (status: DeleteJobStatus) => void,
): Promise<DeleteJobStatus> {
  let status = initialStatus;
  onProgress(status);

  while (!status.ready) {
    await sleep(DELETE_JOB_POLL_MS);
    status = await fetchDeleteJobStatus(status.job_id);
    onProgress(status);
  }

  return status;
}

// Human: Start a delete job and poll until the server marks it ready.
// Agent: CALLS startDeleteJob (chunked when >500 ids); MERGES progress across chunks.
export async function runDeleteJobWithProgress(
  fileIds: string[],
  onProgress: (status: DeleteJobStatus) => void,
  options?: {
    permanent?: boolean;
    previewTotals?: { total_files: number; total_blobs: number };
    startJob?: (
      ids: string[],
      opts?: { permanent?: boolean },
    ) => Promise<DeleteJobStatus>;
  },
): Promise<DeleteJobStatus> {
  const chunks = chunkFileIds(fileIds);
  const startJob = options?.startJob ?? startDeleteJob;
  const totals = options?.previewTotals ?? {
    total_files: fileIds.length,
    total_blobs: 0,
  };

  let priorDeletedFiles = 0;
  let priorDeletedBlobs = 0;
  const allDeletedIds: string[] = [];
  let lastStatus: DeleteJobStatus | null = null;

  for (const chunk of chunks) {
    let status = await startJob(chunk, { permanent: options?.permanent });
    if (chunks.length > 1) {
      status = mergeDeleteJobProgress(status, totals, {
        deleted_files: priorDeletedFiles,
        deleted_blobs: priorDeletedBlobs,
      });
    }

    status = await pollDeleteJobUntilReady(status, (tick) => {
      if (chunks.length > 1) {
        onProgress(
          mergeDeleteJobProgress(tick, totals, {
            deleted_files: priorDeletedFiles,
            deleted_blobs: priorDeletedBlobs,
          }),
        );
      } else {
        onProgress(tick);
      }
    });

    priorDeletedFiles += status.deleted_files;
    priorDeletedBlobs += status.deleted_blobs;
    allDeletedIds.push(...status.deleted_file_ids);
    lastStatus = status;

    if (status.status !== "complete") {
      if (chunks.length > 1) {
        return {
          ...status,
          total_files: totals.total_files,
          total_blobs: totals.total_blobs,
          deleted_files: priorDeletedFiles,
          deleted_blobs: priorDeletedBlobs,
          deleted_file_ids: allDeletedIds,
        };
      }
      return status;
    }
  }

  if (!lastStatus) {
    throw new Error("No delete job was started");
  }

  if (chunks.length > 1) {
    return {
      ...lastStatus,
      ready: true,
      progress: 100,
      status: "complete",
      total_files: totals.total_files,
      total_blobs: totals.total_blobs,
      deleted_files: priorDeletedFiles,
      deleted_blobs: priorDeletedBlobs,
      deleted_file_ids: allDeletedIds,
    };
  }

  return lastStatus;
}

// Human: Empty the recycle bin via one server-side delete job and poll blob progress.
// Agent: CALLS startRecycleBinEmptyDeleteJob; POLLS until ready; USES preview totals for the bar.
export async function runRecycleBinEmptyDeleteJobWithProgress(
  previewTotals: { total_files: number; total_blobs: number },
  onProgress: (status: DeleteJobStatus) => void,
): Promise<DeleteJobStatus> {
  let status = await startRecycleBinEmptyDeleteJob();
  status = {
    ...status,
    total_files: previewTotals.total_files,
    total_blobs: previewTotals.total_blobs,
  };
  return pollDeleteJobUntilReady(status, onProgress);
}

// Human: Format blob counts for delete confirmation copy and progress labels.
// Agent: READS numeric count; RETURNS singular/plural storage object label.
export function formatStorageObjectCount(count: number): string {
  if (count === 1) return "1 storage object";
  return `${count.toLocaleString()} storage objects`;
}
