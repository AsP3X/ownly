// Human: Non-blocking MEGA-style download tray — floats over drive; does not block browsing.
// Agent: SUBSCRIBES download-manager; RENDERS pending summary + active + complete rows; CANCEL/DISMISS per row.

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Download, Loader2, X } from "lucide-react";
import {
  cancelDownloadJob,
  dismissDownloadJob,
  subscribeDownloadJobs,
  type DownloadJob,
} from "@/lib/download-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type DownloadTransferPanelProps = {
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
};

// Human: Compact progress bar for the floating download tray.
// Agent: INDETERMINATE shimmer only when export byte progress unknown; otherwise width from percent.
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

function phaseLabel(job: DownloadJob): string {
  if (job.phase === "processing") {
    if (job.kind === "folder" || job.kind === "bulk") {
      const target = job.kind === "folder" ? "folder" : "files";
      return job.progress > 0
        ? `Compressing ${target}… ${job.progress}%`
        : `Compressing ${target}…`;
    }
    return job.progress > 0 ? `Preparing file… ${job.progress}%` : "Preparing file…";
  }
  if (job.phase === "saving") return "Saving…";
  return "Downloading…";
}

// Human: Single queue row — all pending downloads collapse here so the list stays scannable.
// Agent: RENDERS only when count > 0; CANCEL removes every queued job (active ones keep running).
function QueuedDownloadsSummary({
  count,
  onCancelAll,
}: {
  count: number;
  onCancelAll: () => void;
}) {
  return (
    <li className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
      <Clock className="size-4 shrink-0 text-neutral-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">
          {count} download{count === 1 ? "" : "s"} waiting in queue
        </p>
        <p className="text-xs text-neutral-500">Starts when a slot is free</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-neutral-500"
        aria-label={`Cancel ${count} queued download${count === 1 ? "" : "s"}`}
        onClick={onCancelAll}
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}

// Human: Active or finished download row — queued jobs never render here (use QueuedDownloadsSummary).
// Agent: RENDERS progress for downloading; complete bar / error text for terminal states.
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
            <p className="truncate text-sm font-medium text-neutral-900">{job.label}</p>
            {isActive ? (
              <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-700">
                {job.indeterminate ? "…" : `${job.progress}%`}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">
            {isActive ? phaseLabel(job) : formatBytes(job.sizeBytes)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-neutral-500"
          aria-label={isActive ? `Cancel download ${job.label}` : `Dismiss ${job.label}`}
          onClick={() =>
            isActive ? cancelDownloadJob(job.id) : dismissDownloadJob(job.id)
          }
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

// Human: Floating download card — rendered inside TransferPanelStack (no fixed positioning here).
// Agent: ORDER pending summary → active rows → finished rows; HIDES pending summary when queue empty.
export function DownloadTransferPanel({
  minimized,
  onMinimizedChange,
}: DownloadTransferPanelProps) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);

  useEffect(() => subscribeDownloadJobs(setJobs), []);

  const { activeJobs, finishedJobs, queuedJobs, activeCount, queuedCount } = useMemo(() => {
    const active = jobs.filter((job) => job.status === "downloading");
    const finished = jobs.filter(
      (job) => job.status === "complete" || job.status === "error",
    );
    const queued = jobs.filter((job) => job.status === "queued");
    return {
      activeJobs: active,
      finishedJobs: finished,
      queuedJobs: queued,
      activeCount: active.length,
      queuedCount: queued.length,
    };
  }, [jobs]);

  if (jobs.length === 0) return null;

  return (
    <div
      className="pointer-events-auto w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
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
          {queuedCount > 0 ? (
            <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
              {queuedCount} queued
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onMinimizedChange(!minimized)}
        >
          {minimized ? "Show" : "Minimize"}
        </Button>
      </div>
      {!minimized ? (
        <ul className="max-h-64 overflow-y-auto">
          {/* Human: Pending first as one row, then live progress, then finished at the bottom. */}
          {queuedCount > 0 ? (
            <QueuedDownloadsSummary
              count={queuedCount}
              onCancelAll={() => {
                for (const job of queuedJobs) {
                  cancelDownloadJob(job.id);
                }
              }}
            />
          ) : null}
          {activeJobs.map((job) => (
            <DownloadJobRow key={job.id} job={job} />
          ))}
          {finishedJobs.map((job) => (
            <DownloadJobRow key={job.id} job={job} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
