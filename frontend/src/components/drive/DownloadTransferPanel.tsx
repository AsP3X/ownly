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
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-edge">
        <div className="absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full bg-brand" />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-edge">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-150 ease-out",
          complete ? "bg-ok" : "bg-brand",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function phaseLabel(job: DownloadJob): string {
  if (job.phase === "processing") {
    if (job.kind === "folder" || job.kind === "bulk") {
      const target = job.kind === "folder" ? "folder" : "files";
      // Human: A file count answers "is it stuck?" far better than a percentage does — a big
      // video can hold one member for a long time while the percent barely moves.
      // Agent: filesTotal is 0 until the server has resolved the entry list; fall back to % then.
      if (job.filesTotal != null && job.filesTotal > 0) {
        const done = Math.min(job.filesDone ?? 0, job.filesTotal);
        const noun = job.filesTotal === 1 ? "file" : "files";
        return `Compressing ${target}… ${done} of ${job.filesTotal} ${noun}`;
      }
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
    <li className="flex items-center gap-2 border-b border-hairline px-4 py-3">
      <Clock className="size-4 shrink-0 text-ink-faint" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {count} download{count === 1 ? "" : "s"} waiting in queue
        </p>
        <p className="text-xs text-ink-muted">Starts when a slot is free</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-ink-muted"
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
// Human: A finished archive that is missing files reads as a plain success otherwise — the user
// would only find out when they opened the zip and something was not there.
export function skippedSummary(job: DownloadJob): string | null {
  const skipped = job.skippedFiles;
  if (!skipped || skipped.length === 0) return null;
  const subject = skipped.length === 1 ? "1 file was" : `${skipped.length} files were`;
  // Human: Name a couple so the warning is actionable, but never dump a hundred names into a
  // tray row — the count carries the rest.
  const named = skipped.slice(0, 2).join(", ");
  const rest = skipped.length - Math.min(2, skipped.length);
  const tail = rest > 0 ? ` and ${rest} more` : "";
  return `${subject} left out — could not be read: ${named}${tail}`;
}

function DownloadJobRow({ job }: { job: DownloadJob }) {
  const isActive = job.status === "downloading";
  const skipped = skippedSummary(job);

  return (
    <li className="flex flex-col gap-2 border-b border-hairline px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {job.status === "complete" ? (
            <CheckCircle2 className="size-4 text-ok" aria-hidden />
          ) : job.status === "error" ? (
            <AlertCircle className="size-4 text-danger" aria-hidden />
          ) : (
            <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-ink">{job.label}</p>
            {isActive ? (
              <span className="shrink-0 text-xs font-semibold tabular-nums text-brand">
                {job.indeterminate ? "…" : `${job.progress}%`}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-ink-muted">
            {isActive ? phaseLabel(job) : formatBytes(job.sizeBytes)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-ink-muted"
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
        <p className="text-xs text-danger">{job.error}</p>
      ) : null}
      {/* Human: Warning, not error — the archive downloaded fine, it is just short. */}
      {skipped ? (
        <p className="flex items-start gap-1.5 text-xs text-warn">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{skipped}</span>
        </p>
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
      className="pointer-events-auto w-full overflow-hidden rounded-xl border border-edge bg-panel shadow-lg"
      role="region"
      aria-label="Downloads"
    >
      <div className="flex items-center justify-between border-b border-hairline bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Download className="size-4 text-brand" aria-hidden />
          Downloads
          {activeCount > 0 ? (
            <span className="rounded-full bg-brand-weak px-2 py-0.5 text-xs font-medium text-brand-hover">
              {activeCount} active
            </span>
          ) : null}
          {queuedCount > 0 ? (
            <span className="rounded-full bg-edge px-2 py-0.5 text-xs font-medium text-ink-muted">
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
