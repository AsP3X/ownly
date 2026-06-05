// Human: Blob purge progress bar shown while a delete job runs in confirmation dialogs.
// Agent: READS DeleteJobStatus fields; RENDERS Progress + deleted/total blob counts.

import type { DeleteJobStatus } from "@/api/client";
import { formatStorageObjectCount } from "@/lib/delete-with-progress";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";

type DeleteJobProgressProps = {
  status: DeleteJobStatus;
};

// Human: Visualize server-side blob deletion progress during large file or bulk deletes.
// Agent: DISPLAYS percent from status.progress; SHOWS deleted_blobs / total_blobs label.
export function DeleteJobProgress({ status }: DeleteJobProgressProps) {
  const blobLabel = `${status.deleted_blobs.toLocaleString()} / ${status.total_blobs.toLocaleString()} storage objects removed`;

  return (
    <div className="space-y-2 border-b border-neutral-100 px-6 py-4">
      <Progress value={status.progress} className="gap-2">
        <ProgressLabel className="text-sm text-neutral-700">
          Removing {formatStorageObjectCount(status.total_blobs)}…
        </ProgressLabel>
        <ProgressValue>{() => `${status.progress}%`}</ProgressValue>
      </Progress>
      <p className="text-xs text-neutral-500">{blobLabel}</p>
      {status.total_files > 1 ? (
        <p className="text-xs text-neutral-500">
          {status.deleted_files.toLocaleString()} / {status.total_files.toLocaleString()} files
          processed
        </p>
      ) : null}
    </div>
  );
}

// Human: Loading placeholder while the server counts blobs for the delete preview.
// Agent: RENDERS neutral text; SHOWN before deletion-preview API returns.
export function DeletePreviewLoading() {
  return (
    <p className="border-b border-neutral-100 px-6 py-4 text-sm text-neutral-500">
      Checking storage objects to remove…
    </p>
  );
}

// Human: Summarize how many storage blobs a delete will purge once preview data is loaded.
// Agent: READS storage_object_count; RETURNS helper line under dialog description.
export function DeletePreviewSummary({
  storageObjectCount,
  fileCount,
  permanentOnly = true,
}: {
  storageObjectCount: number;
  fileCount: number;
  /** Human: When false (drive recycle dialog), clarify blobs are removed only via Permanently. */
  permanentOnly?: boolean;
}) {
  const verb = permanentOnly ? "This will remove" : "Permanently deleting will remove";

  return (
    <p className="border-b border-neutral-100 px-6 py-3 text-sm text-neutral-600">
      {verb} {formatStorageObjectCount(storageObjectCount)}
      {fileCount > 1 ? ` across ${fileCount.toLocaleString()} files` : ""}.
    </p>
  );
}
