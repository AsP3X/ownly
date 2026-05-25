// Human: Non-blocking MEGA-style download tray — floats over drive; does not block browsing.
// Agent: SUBSCRIBES download-manager; RENDERS progress per job; CANCEL/DISMISS per row.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, X } from "lucide-react";
import {
  cancelDownloadJob,
  dismissDownloadJob,
  subscribeDownloadJobs,
  type DownloadJob,
} from "@/lib/download-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Human: Compact progress bar for the floating download tray.
function TransferProgressBar({
  value,
  indeterminate,
  complete,
}: {
  value: number;
  indeterminate?: boolean;
  complete?: boolean;
}) {
  if (indeterminate && !complete) {
    return (
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full bg-blue-600" />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-150 ease-out",
          complete ? "bg-green-600" : "bg-blue-600",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function DownloadJobRow({ job }: { job: DownloadJob }) {
  const isActive = job.status === "downloading";

  return (
    <li className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {job.status === "complete" ? (
            <CheckCircle2 className="size-4 text-green-600" aria-hidden />
          ) : job.status === "error" ? (
            <AlertCircle className="size-4 text-red-500" aria-hidden />
          ) : (
            <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-neutral-900">{job.file.name}</p>
            {isActive ? (
              <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-700">
                {job.indeterminate ? "…" : `${job.progress}%`}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">{formatBytes(job.file.size_bytes)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-neutral-500"
          aria-label={isActive ? `Cancel download ${job.file.name}` : `Dismiss ${job.file.name}`}
          onClick={() => (isActive ? cancelDownloadJob(job.id) : dismissDownloadJob(job.id))}
        >
          <X className="size-4" />
        </Button>
      </div>
      {isActive ? (
        <TransferProgressBar value={job.progress} indeterminate={job.indeterminate} />
      ) : job.status === "complete" ? (
        <TransferProgressBar value={100} complete />
      ) : null}
      {job.status === "error" && job.error ? (
        <p className="text-xs text-red-600">{job.error}</p>
      ) : null}
    </li>
  );
}

// Human: Floating tray shown when at least one download job exists.
export function DownloadTransferPanel() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => subscribeDownloadJobs(setJobs), []);

  if (jobs.length === 0) return null;

  const activeCount = jobs.filter((job) => job.status === "downloading").length;

  return (
    <div
      className="pointer-events-auto fixed bottom-4 right-4 z-50 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
      role="region"
      aria-label="Downloads"
    >
      <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <Download className="size-4 text-blue-600" aria-hidden />
          Downloads
          {activeCount > 0 ? (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
              {activeCount} active
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setMinimized((value) => !value)}
        >
          {minimized ? "Show" : "Minimize"}
        </Button>
      </div>
      {!minimized ? (
        <ul className="max-h-64 overflow-y-auto">
          {jobs.map((job) => (
            <DownloadJobRow key={job.id} job={job} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
