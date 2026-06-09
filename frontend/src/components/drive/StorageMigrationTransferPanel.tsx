// Human: Lower-right progress card for admin legacy storage blob migration batches.
// Agent: SUBSCRIBES storage-migration-manager; STACKS in TransferPanelStack above uploads/downloads.

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, HardDriveDownload, Loader2, X } from "lucide-react";
import {
  cancelStorageMigrationJob,
  dismissStorageMigrationJob,
  subscribeStorageMigrationJob,
  type StorageMigrationJob,
} from "@/lib/storage-migration-manager";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type StorageMigrationTransferPanelProps = {
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
};

// Human: Shimmer bar while a batch request is in flight; solid green when complete.
// Agent: INDETERMINATE when waitingOnBatch && running; WIDTH 100% on complete.
function MigrationProgressBar({
  job,
}: {
  job: StorageMigrationJob;
}) {
  const complete = job.status === "complete";
  const running = job.status === "running";

  if (running && job.waitingOnBatch) {
    return (
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage migration in progress"
      >
        <div className="absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full bg-blue-600" />
      </div>
    );
  }

  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
      role="progressbar"
      aria-valuenow={complete ? 100 : 0}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Storage migration progress"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-150 ease-out",
          complete ? "w-full bg-green-600" : "w-0 bg-blue-600",
        )}
      />
    </div>
  );
}

function statusLine(job: StorageMigrationJob): string {
  if (job.dryRun) {
    return job.status === "running"
      ? `Previewing batch ${job.batchNumber}…`
      : `Preview complete — ${job.migrated} would migrate`;
  }
  if (job.status === "running") {
    return job.waitingOnBatch
      ? `Processing batch ${job.batchNumber}…`
      : `Continuing migration…`;
  }
  if (job.status === "cancelled") {
    return `Stopped after batch ${job.batchNumber}`;
  }
  if (job.status === "error") {
    return "Migration finished with errors";
  }
  return `Migration complete — ${job.migrated} migrated`;
}

// Human: Floating storage migration card — matches DownloadTransferPanel visual language.
// Agent: RENDERS aggregate counts; CANCEL stops between batches; DISMISS when terminal.
export function StorageMigrationTransferPanel({
  minimized,
  onMinimizedChange,
}: StorageMigrationTransferPanelProps) {
  const [job, setJob] = useState<StorageMigrationJob | null>(null);

  useEffect(() => subscribeStorageMigrationJob(setJob), []);

  if (!job) return null;

  const isRunning = job.status === "running";
  const isTerminal = job.status === "complete" || job.status === "error" || job.status === "cancelled";
  const title = job.dryRun ? "Storage migration preview" : "Storage migration";

  return (
    <div
      className="pointer-events-auto w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
      role="region"
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-neutral-900">
          {isRunning ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-blue-600" aria-hidden />
          ) : job.status === "complete" ? (
            <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden />
          ) : (
            <HardDriveDownload className="size-4 shrink-0 text-blue-600" aria-hidden />
          )}
          <span className="truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isRunning ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-semibold text-neutral-600"
              onClick={() => cancelStorageMigrationJob()}
            >
              Stop
            </Button>
          ) : isTerminal ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-neutral-500"
              aria-label="Dismiss storage migration"
              onClick={() => dismissStorageMigrationJob()}
            >
              <X className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-neutral-500"
            aria-label={minimized ? "Expand storage migration panel" : "Minimize storage migration panel"}
            onClick={() => onMinimizedChange(!minimized)}
          >
            {minimized ? (
              <ChevronUp className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>

      {!minimized ? (
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900">{statusLine(job)}</p>
            {isRunning && !job.waitingOnBatch ? (
              <span className="shrink-0 text-xs font-semibold text-blue-700">…</span>
            ) : null}
          </div>

          <MigrationProgressBar job={job} />

          <p className="text-xs text-neutral-600">
            {job.migrated} {job.dryRun ? "would migrate" : "migrated"}
            {" · "}
            {job.skipped} skipped
            {job.failed > 0 ? ` · ${job.failed} failed` : ""}
            {job.batchNumber > 0 ? ` · batch ${job.batchNumber}` : ""}
          </p>

          {job.nodeId ? (
            <p className="text-xs text-neutral-500">Node: {job.nodeId}</p>
          ) : null}
          {job.prefix ? (
            <p className="text-xs text-neutral-500">Prefix: {job.prefix}</p>
          ) : null}

          {job.lastNodeSummaries.length > 0 ? (
            <ul className="max-h-24 list-none space-y-1 overflow-y-auto text-xs text-neutral-500">
              {job.lastNodeSummaries.map((line) => (
                <li key={line} className="truncate">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {job.error ? <p className="text-xs text-red-600">{job.error}</p> : null}
        </div>
      ) : (
        <div className="px-4 py-3">
          <p className="text-xs text-neutral-600">{statusLine(job)}</p>
          <div className="mt-2">
            <MigrationProgressBar job={job} />
          </div>
        </div>
      )}
    </div>
  );
}
