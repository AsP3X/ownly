// Human: Blob purge progress bar shown while a delete job runs in confirmation dialogs.
// Agent: READS DeleteJobStatus fields; RENDERS determinate bar + deleted/total counts.

import type { DeleteJobStatus } from "@/api/client";
import { formatStorageObjectCount } from "@/lib/delete-with-progress";
import { cn } from "@/lib/utils";

type DeleteJobProgressProps = {
  status: DeleteJobStatus;
};

// Human: Prefer blob progress when the job tracks storage objects; otherwise file counts.
// Agent: READS total_blobs / total_files; RETURNS 0–100 for the visual bar.
function resolveProgressPercent(status: DeleteJobStatus): number {
  if (Number.isFinite(status.progress) && status.progress > 0) {
    return Math.min(100, Math.max(0, Math.round(status.progress)));
  }
  if (status.total_blobs > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((status.deleted_blobs / status.total_blobs) * 100)),
    );
  }
  if (status.total_files > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((status.deleted_files / status.total_files) * 100)),
    );
  }
  return 0;
}

// Human: Visualize server-side blob/file deletion progress during large deletes.
// Agent: DISPLAYS percent + counts; USES explicit bar (not thin theme Progress) for reliable visibility.
export function DeleteJobProgress({ status }: DeleteJobProgressProps) {
  const percent = resolveProgressPercent(status);
  const isStarting =
    status.status === "starting" ||
    status.status === "queued" ||
    (percent === 0 && !status.ready && status.deleted_blobs === 0 && status.deleted_files === 0);
  const useBlobs = status.total_blobs > 0;
  const countLabel = useBlobs
    ? `${status.deleted_blobs.toLocaleString()} / ${status.total_blobs.toLocaleString()} storage objects removed`
    : status.total_files > 0
      ? `${status.deleted_files.toLocaleString()} / ${status.total_files.toLocaleString()} files processed`
      : "Preparing deletion…";
  const heading = useBlobs
    ? `Removing ${formatStorageObjectCount(status.total_blobs)}…`
    : status.total_files > 1
      ? `Deleting ${status.total_files.toLocaleString()} files…`
      : status.total_files === 1
        ? "Deleting file…"
        : "Deleting…";

  return (
    <div
      className="space-y-3 border-b border-neutral-100 bg-neutral-50/80 px-6 py-4"
      role="status"
      aria-live="polite"
      aria-busy={!status.ready}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-neutral-800">{heading}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-700">
          {isStarting && percent === 0 ? "…" : `${percent}%`}
        </p>
      </div>

      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-edge"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={heading}
      >
        <div
          className={cn(
            "h-full rounded-full bg-brand transition-[width] duration-300 ease-out",
            isStarting && percent === 0 && "animate-pulse",
          )}
          style={{ width: isStarting && percent === 0 ? "12%" : `${percent}%` }}
        />
      </div>

      <p className="text-xs text-ink-muted">{countLabel}</p>
      {useBlobs && status.total_files > 1 ? (
        <p className="text-xs text-ink-muted">
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
    <p className="border-b border-neutral-100 px-6 py-4 text-sm text-ink-muted">
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
