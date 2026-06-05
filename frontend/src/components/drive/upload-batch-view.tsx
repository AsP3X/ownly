// Human: Shared upload batch progress UI — per-file rows and phase-colored progress bars.
// Agent: READS UploadItemSnapshot[]; RENDERED by UploadTransferPanel when expanded.

import { useEffect, useState } from "react";
import { AlertCircle, Check, Clock, Loader2, X } from "lucide-react";
import {
  getUploadBatchDisplayCounts,
  type UploadItemSnapshot,
  type UploadPhase,
} from "@/lib/upload-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Human: Max height for the scrollable file list inside the expanded transfer panel. */
export const UPLOAD_PANEL_LIST_MAX_HEIGHT = "17.5rem";

/** Human: Above this count, backlog rows collapse to one summary line to avoid list height churn. */
const UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS = 3;

// Human: Phase accent tokens from Pencil Upload Progress Panel (blue / purple / amber / green).
// Agent: MAPS uploading | processing | encrypting | storing to Tailwind text and bar fill classes.
function phaseStyles(phase: UploadPhase) {
  if (phase === "storing") {
    return {
      icon: "text-emerald-600",
      percent: "text-emerald-600",
      bar: "bg-emerald-600",
      meta: "text-emerald-600",
    };
  }
  if (phase === "encrypting") {
    return {
      icon: "text-amber-600",
      percent: "text-amber-600",
      bar: "bg-amber-500",
      meta: "text-amber-600",
    };
  }
  if (phase === "processing") {
    return {
      icon: "text-fuchsia-700",
      percent: "text-fuchsia-700",
      bar: "bg-fuchsia-700",
      meta: "text-fuchsia-700",
    };
  }
  return {
    icon: "text-[#2563EB]",
    percent: "text-[#2563EB]",
    bar: "bg-[#2563EB]",
    meta: "text-[#888888]",
  };
}

// Human: Status line for the active upload bar — unified steps for generic files; media uses ingest bands.
// Agent: READS phase; RETURNS Uploading → Processing → Encrypting → Moving to storage (Nebular blobs).
function getUploadPhaseStatus(item: Pick<UploadItemSnapshot, "phase">): string {
  if (item.phase === "storing") {
    return "Moving to storage";
  }
  if (item.phase === "encrypting") {
    return "Encrypting (AES-256-GCM)";
  }
  if (item.phase === "processing") {
    return "Processing file";
  }
  return "Uploading";
}

// Human: Shimmer track tint and fill for indeterminate post-upload bars.
// Agent: MAPS processing|encrypting|storing to Tailwind classes for UploadProgressBar.
function indeterminateBarStyles(phase: UploadPhase) {
  if (phase === "storing") {
    return { shimmer: "bg-emerald-600", track: "bg-emerald-200/50" };
  }
  if (phase === "encrypting") {
    return { shimmer: "bg-amber-500", track: "bg-amber-200/50" };
  }
  return { shimmer: "bg-fuchsia-700", track: "bg-fuchsia-200/50" };
}

// Human: Thin progress track — 4px bar with phase-colored fill or shimmer when indeterminate.
// Agent: RENDERS one bar at a time from phase; post-upload phases use upload-shimmer when indeterminate.
export function UploadProgressBar({
  value,
  phase,
  indeterminate,
  statusLabel,
  className,
}: {
  value: number;
  phase: UploadPhase;
  indeterminate?: boolean;
  statusLabel?: string;
  className?: string;
}) {
  const styles = phaseStyles(phase);
  const ariaLabel =
    phase === "uploading" ? "Uploading to server" : (statusLabel ?? "Upload in progress");

  const isPostUploadPhase =
    phase === "processing" || phase === "encrypting" || phase === "storing";

  if (indeterminate && isPostUploadPhase) {
    const shimmer = indeterminateBarStyles(phase);

    return (
      <div
        className={cn("relative h-1 w-full overflow-hidden rounded-sm bg-[#E5E7EB]", className)}
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div className={cn("absolute inset-y-0 left-0 w-full", shimmer.track)} />
        <div
          className={cn(
            "absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-sm",
            shimmer.shimmer,
          )}
        />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-sm bg-[#E5E7EB]", className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={cn("h-full rounded-sm transition-[width] duration-150 ease-out", styles.bar)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

// Human: Active upload row — filename, percent, thin bar, and meta line per Pencil item layout.
// Agent: READS UploadItemSnapshot; CALLS onCancel to abort, delete partial server file, and remove row.
export function ActiveUploadRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  const isPostUpload =
    item.phase === "processing" || item.phase === "encrypting" || item.phase === "storing";
  const styles = phaseStyles(item.phase);
  const phaseStatus = getUploadPhaseStatus(item);
  const [phaseElapsedSec, setPhaseElapsedSec] = useState(0);

  useEffect(() => {
    if (!isPostUpload) return;
    const started = Date.now();
    const timerId = window.setInterval(() => {
      setPhaseElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isPostUpload, item.phase]);

  const showIndeterminateLabel =
    isPostUpload && Boolean(item.indeterminate) && item.progress <= 0;
  const percentLabel = showIndeterminateLabel ? "Working…" : `${item.progress}%`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className={cn("size-3 shrink-0 animate-spin", styles.icon)} aria-hidden />
          <p className="min-w-0 truncate text-[13px] font-semibold text-[#1A1A1A]">
            {item.fileName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={cn("text-[13px] font-semibold tabular-nums", styles.percent)}>
            {percentLabel}
          </span>
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-[#888888] hover:text-[#1A1A1A]"
              aria-label={`Cancel upload ${item.fileName}`}
              onClick={() => onCancel(item.id)}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <UploadProgressBar
        value={item.progress}
        phase={item.phase}
        indeterminate={showIndeterminateLabel}
        statusLabel={phaseStatus}
      />
      <p className="truncate text-[11px] leading-tight">
        <span className="text-[#888888]">{formatBytes(item.fileSize)}</span>
        <span className="text-[#888888]"> · </span>
        <span className={styles.meta}>{phaseStatus}</span>
        {isPostUpload ? (
          <>
            <span className="text-[#888888]"> · </span>
            <span className={styles.meta}>{formatElapsed(phaseElapsedSec)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

// Human: Completed file row — green check and muted filename per Pencil completed item.
export function CompletedUploadRow({ item }: { item: UploadItemSnapshot }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
        <p className="min-w-0 truncate text-[13px] text-[#888888]">{item.fileName}</p>
      </div>
      <span className="shrink-0 text-[11px] text-[#888888]">
        {formatBytes(item.fileSize)} · Done!
      </span>
    </div>
  );
}

// Human: Queued file row — waiting state before a worker slot is available.
export function QueuedFileRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <Clock className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
        <p className="min-w-0 truncate text-[13px] text-[#1A1A1A]">{item.fileName}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-[#888888]">
          {formatBytes(item.fileSize)} · Queued
        </span>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-[#888888] hover:text-[#1A1A1A]"
            aria-label={`Cancel queued upload ${item.fileName}`}
            onClick={() => onCancel(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Human: Terminal failed or cancelled upload row — user can dismiss with X to remove from the tray.
// Agent: READS error message; CALLS onRemove to drop row and delete partial server file when present.
export function FailedUploadRow({
  item,
  onRemove,
}: {
  item: UploadItemSnapshot;
  onRemove?: (itemId: string) => void;
}) {
  const isFailed = item.status === "error";

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        {isFailed ? (
          <AlertCircle className="size-3.5 shrink-0 text-red-500" aria-hidden />
        ) : (
          <X className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[#1A1A1A]">{item.fileName}</p>
          {item.error ? (
            <p className="truncate text-[11px] text-red-600" title={item.error}>
              {item.error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-[#888888]">{isFailed ? "Failed" : "Cancelled"}</span>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-[#888888] hover:text-red-600"
            aria-label={`Remove ${item.fileName} from uploads`}
            onClick={() => onRemove(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Human: Overall progress bar for the batch — 6px track per Pencil Overall Progress Bar.
export function UploadOverallProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-sm bg-[#E5E7EB]"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Overall upload progress"
    >
      <div
        className="h-full rounded-sm bg-[#2563EB] transition-[width] duration-300 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// Human: Fixed-height tray summary — stable counts only; per-stage detail stays on in-flight rows.
// Agent: READS UploadBatchDisplayCounts; RENDERS two truncated lines that do not resize the panel.
function UploadBatchSummaryRow({
  processedCount,
  totalCount,
  counts,
}: {
  processedCount: number;
  totalCount: number;
  counts: ReturnType<typeof getUploadBatchDisplayCounts>;
}) {
  const backlogParts: string[] = [];
  if (counts.inFlight > 0) {
    backlogParts.push(`${counts.inFlight} active`);
  }
  if (counts.waiting > 0) {
    backlogParts.push(`${counts.waiting} queued`);
  }
  if (counts.failed + counts.cancelled > 0) {
    backlogParts.push(`${counts.failed + counts.cancelled} failed`);
  }

  return (
    <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-xs text-[#666666]">
      <span className="truncate tabular-nums">
        {processedCount} of {totalCount} completed
      </span>
      <span className="truncate text-right tabular-nums">
        {backlogParts.length > 0 ? backlogParts.join(" · ") : "Preparing…"}
      </span>
    </div>
  );
}

// Human: One-line queue backlog — avoids rendering hundreds of QueuedFileRow tiles during bulk uploads.
// Agent: READS waiting count; RETURNS null when zero.
function UploadQueueBacklogSummary({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 py-1">
      <Clock className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
      <p className="truncate text-[11px] text-[#888888]">
        {count} file{count === 1 ? "" : "s"} waiting in queue
      </p>
    </div>
  );
}

// Human: Collapsed completed summary when the batch is large — keeps scroll height stable.
// Agent: READS done count; RETURNS single line instead of one row per finished file.
function UploadDoneBacklogSummary({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 py-1">
      <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
      <p className="truncate text-[11px] text-[#888888]">
        {count} file{count === 1 ? "" : "s"} completed
      </p>
    </div>
  );
}

// Human: Upload batch body — overall summary, divider, and unified scrollable file list.
// Agent: READS UploadItemSnapshot displayBucket; CALLS onCancel/onRemove; USED by UploadTransferPanel when expanded.
export function UploadBatchProgressView({
  items,
  onCancelItem,
  onRemoveItem,
}: {
  items: UploadItemSnapshot[];
  onCancelItem?: (itemId: string) => void;
  onRemoveItem?: (itemId: string) => void;
}) {
  const counts = getUploadBatchDisplayCounts(items);
  const activeItems = items.filter((item) => item.displayBucket === "in_flight");
  const waitingItems = items.filter((item) => item.displayBucket === "queued");
  const doneItems = items.filter((item) => item.displayBucket === "done");
  const failedItems = items.filter(
    (item) => item.displayBucket === "error" || item.displayBucket === "cancelled",
  );
  const processedCount = counts.done + counts.failed + counts.cancelled;
  const overallPercent =
    items.length === 0 ? 0 : Math.round((processedCount / items.length) * 100);
  const showIndividualWaitingRows =
    waitingItems.length <= UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const showIndividualDoneRows =
    doneItems.length <= UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const listIsEmpty =
    activeItems.length === 0 &&
    waitingItems.length === 0 &&
    doneItems.length === 0 &&
    failedItems.length === 0;

  return (
    <>
      <UploadBatchSummaryRow
        processedCount={processedCount}
        totalCount={items.length}
        counts={counts}
      />
      <UploadOverallProgressBar percent={overallPercent} />

      <div className="h-px w-full shrink-0 bg-[#E5E7EB]" aria-hidden />

      <div
        className="flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain"
        style={{ maxHeight: UPLOAD_PANEL_LIST_MAX_HEIGHT }}
      >
        {listIsEmpty ? (
          <p className="py-6 text-center text-sm text-[#888888]">Preparing next files…</p>
        ) : null}

        {activeItems.map((item) => (
          <ActiveUploadRow key={item.id} item={item} onCancel={onCancelItem} />
        ))}

        {showIndividualWaitingRows
          ? waitingItems.map((item) => (
              <QueuedFileRow key={item.id} item={item} onCancel={onCancelItem} />
            ))
          : null}
        {!showIndividualWaitingRows ? (
          <UploadQueueBacklogSummary count={waitingItems.length} />
        ) : null}

        {showIndividualDoneRows
          ? doneItems.map((item) => <CompletedUploadRow key={item.id} item={item} />)
          : null}
        {!showIndividualDoneRows ? (
          <UploadDoneBacklogSummary count={doneItems.length} />
        ) : null}

        {failedItems.map((item) => (
          <FailedUploadRow key={item.id} item={item} onRemove={onRemoveItem} />
        ))}
      </div>
    </>
  );
}
