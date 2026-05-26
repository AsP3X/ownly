// Human: Helpers for delete confirmation dialogs — preview thresholds and job polling.
// Agent: READS BulkDeletionPreview/FileDeletionPreview; CALLS fetchDeleteJobStatus until ready.

import {
  fetchDeleteJobStatus,
  startDeleteJob,
  type DeleteJobStatus,
} from "@/api/client";

/** Show blob progress UI when more than one file or more than this many storage objects. */
export const DELETE_JOB_BLOB_THRESHOLD = 10;

const DELETE_JOB_POLL_MS = 300;

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

// Human: Start a delete job and poll until the server marks it ready.
// Agent: CALLS startDeleteJob; LOOPS fetchDeleteJobStatus; INVOKES onProgress each tick.
export async function runDeleteJobWithProgress(
  fileIds: string[],
  onProgress: (status: DeleteJobStatus) => void,
  options?: { permanent?: boolean },
): Promise<DeleteJobStatus> {
  let status = await startDeleteJob(fileIds, options);
  onProgress(status);

  while (!status.ready) {
    await sleep(DELETE_JOB_POLL_MS);
    status = await fetchDeleteJobStatus(status.job_id);
    onProgress(status);
  }

  return status;
}

// Human: Format blob counts for delete confirmation copy and progress labels.
// Agent: READS numeric count; RETURNS singular/plural storage object label.
export function formatStorageObjectCount(count: number): string {
  if (count === 1) return "1 storage object";
  return `${count.toLocaleString()} storage objects`;
}
