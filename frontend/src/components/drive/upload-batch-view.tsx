// Human: Shared upload batch progress UI — active stack, queue box, and progress bars.
// Agent: READS UploadItemSnapshot[]; RENDERED by UploadTransferPanel (and optional expanded views).

import { useEffect, useState, Children, type ReactNode } from "react";
import { AlertCircle, Clock, Loader2, X } from "lucide-react";
import type { UploadItemSnapshot, UploadPhase } from "@/lib/upload-manager";
import { UPLOAD_MANAGER_MAX_CONCURRENT } from "@/lib/upload-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const VISIBLE_ACTIVE_ROWS = 3;
export const VISIBLE_QUEUED_ROWS = 4;
export const ACTIVE_ROW_HEIGHT = "4.5rem";
export const QUEUE_ROW_HEIGHT = "2.25rem";
export const ACTIVE_STACK_HEIGHT = `calc(${VISIBLE_ACTIVE_ROWS} * ${ACTIVE_ROW_HEIGHT})`;
export const QUEUE_BOX_HEIGHT = `calc(${VISIBLE_QUEUED_ROWS} * ${QUEUE_ROW_HEIGHT})`;

// Human: Separate bars per phase — upload (blue), encode (violet), then storage (emerald) replaces encode.
// Agent: RENDERS one bar at a time from phase; processing uses sliding shimmer when indeterminate.
export function UploadProgressBar({
  value,
  phase,
  indeterminate,
  className,
}: {
  value: number;
  phase: UploadPhase;
  indeterminate?: boolean;
  className?: string;
}) {
  if (phase === "processing" && indeterminate) {
    return (
      <div
        className={cn(
          "relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/80",
          className,
        )}
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Processing video"
      >
        <div className="absolute inset-y-0 left-0 w-full bg-violet-200/60" />
        <div className="absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full bg-violet-600" />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));
  const fillClass =
    phase === "storing"
      ? "bg-emerald-600"
      : phase === "processing"
        ? "bg-violet-600"
        : "bg-blue-600";
  const ariaLabel =
    phase === "storing"
      ? "Moving to storage"
      : phase === "processing"
        ? "Processing video"
        : "Uploading to server";
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/80", className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-150 ease-out", fillClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function activePhaseLabel(phase: UploadPhase, isVideo: boolean) {
  if (phase === "storing") {
    return "Moving to storage";
  }
  if (phase === "processing") {
    return isVideo ? "Processing video" : "Processing";
  }
  return "Uploading";
}

function activePhaseAccent(phase: UploadPhase) {
  if (phase === "storing") {
    return {
      row: "bg-emerald-50/70",
      spinner: "text-emerald-700",
      percent: "text-emerald-800",
      detail: "text-emerald-700",
    };
  }
  if (phase === "processing") {
    return {
      row: "bg-violet-50/70",
      spinner: "text-violet-700",
      percent: "text-violet-800",
      detail: "text-violet-700",
    };
  }
  return {
    row: "bg-blue-50/50",
    spinner: "text-blue-700",
    percent: "text-blue-800",
    detail: "text-blue-700",
  };
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

// Human: One compact in-progress row inside the fixed three-row active stack.
// Agent: READS UploadItemSnapshot; RENDERS filename, phase, thin bar, elapsed timer, cancel control.
export function ActiveUploadRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  const isPostUpload = item.phase === "processing" || item.phase === "storing";
  const isVideo = item.mimeType.startsWith("video/");
  const accent = activePhaseAccent(item.phase);
  const [phaseElapsedSec, setPhaseElapsedSec] = useState(0);

  useEffect(() => {
    if (!isPostUpload) return;
    const started = Date.now();
    const timerId = window.setInterval(() => {
      setPhaseElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isPostUpload, item.phase]);

  const statusLabel = activePhaseLabel(item.phase, isVideo);
  const percentLabel =
    isPostUpload && item.indeterminate ? "Working…" : `${item.progress}%`;
  const elapsedDetail =
    item.phase === "processing" && isVideo && !item.indeterminate
      ? `Encoding ${formatElapsed(phaseElapsedSec)}`
      : formatElapsed(phaseElapsedSec);

  return (
    <div
      className={cn(
        "flex h-[var(--upload-active-row-height)] min-h-[var(--upload-active-row-height)] flex-col justify-center gap-1.5 px-3.5 py-2",
        accent.row,
      )}
      style={{ ["--upload-active-row-height" as string]: ACTIVE_ROW_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Loader2
          className={cn("size-3.5 shrink-0 animate-spin", accent.spinner)}
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
          {item.fileName}
        </p>
        <span
          className={cn("shrink-0 text-xs font-semibold tabular-nums", accent.percent)}
        >
          {percentLabel}
        </span>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-neutral-500"
            aria-label={`Cancel upload ${item.fileName}`}
            onClick={() => onCancel(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <UploadProgressBar
        value={item.progress}
        phase={item.phase}
        indeterminate={item.indeterminate}
      />
      <p className="truncate text-[11px] leading-tight text-neutral-500">
        {formatBytes(item.fileSize)}
        <span className="text-neutral-400"> · </span>
        <span className={accent.detail}>{statusLabel}</span>
        {isPostUpload ? (
          <>
            <span className="text-neutral-400"> · </span>
            {elapsedDetail}
          </>
        ) : null}
      </p>
    </div>
  );
}

export function QueuedFileRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  return (
    <li
      className="flex h-[var(--upload-queue-row-height)] min-h-[var(--upload-queue-row-height)] items-center gap-2.5 px-3"
      style={{ ["--upload-queue-row-height" as string]: QUEUE_ROW_HEIGHT }}
    >
      <Clock className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{item.fileName}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
        {formatBytes(item.fileSize)}
      </span>
      {onCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-neutral-500"
          aria-label={`Cancel queued upload ${item.fileName}`}
          onClick={() => onCancel(item.id)}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </li>
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
    <li
      className="flex h-[var(--upload-queue-row-height)] min-h-[var(--upload-queue-row-height)] items-center gap-2.5 px-3"
      style={{ ["--upload-queue-row-height" as string]: QUEUE_ROW_HEIGHT }}
    >
      {isFailed ? (
        <AlertCircle className="size-3.5 shrink-0 text-red-500" aria-hidden />
      ) : (
        <X className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-neutral-900">{item.fileName}</p>
        {item.error ? (
          <p className="truncate text-[11px] text-red-600" title={item.error}>
            {item.error}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-[11px] text-neutral-500">
        {isFailed ? "Failed" : "Cancelled"}
      </span>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-neutral-500 hover:text-red-600"
          aria-label={`Remove ${item.fileName} from uploads`}
          onClick={() => onRemove(item.id)}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
}

function UploadListBox({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  const hasItems = Children.count(children) > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 bg-[#faf9f8] px-3 py-2">
        <p className="text-xs font-medium text-neutral-600">{title}</p>
      </div>
      <ul
        className="divide-y divide-neutral-100 overflow-y-auto overflow-x-hidden"
        style={{ minHeight: QUEUE_BOX_HEIGHT, maxHeight: QUEUE_BOX_HEIGHT }}
      >
        {hasItems ? (
          children
        ) : (
          <li
            className="flex items-center justify-center px-3 text-sm text-neutral-500"
            style={{ minHeight: QUEUE_BOX_HEIGHT }}
          >
            {emptyLabel}
          </li>
        )}
      </ul>
    </div>
  );
}

// Human: Upload batch body — overall bar, three-row active stack, scrollable queue box.
// Agent: READS UploadItemSnapshot[]; CALLS onCancel per row; USED by UploadTransferPanel when expanded.
export function UploadBatchProgressView({
  items,
  onCancelItem,
  onRemoveItem,
}: {
  items: UploadItemSnapshot[];
  onCancelItem?: (itemId: string) => void;
  onRemoveItem?: (itemId: string) => void;
}) {
  const activeItems = items.filter((item) => item.status === "uploading");
  const waitingItems = items.filter((item) => item.status === "queued");
  const failedItems = items.filter(
    (item) => item.status === "error" || item.status === "cancelled",
  );
  const doneCount = items.filter((item) => item.status === "done").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const cancelledCount = items.filter((item) => item.status === "cancelled").length;
  const processedCount = doneCount + errorCount + cancelledCount;
  const overallPercent =
    items.length === 0 ? 0 : Math.round((processedCount / items.length) * 100);

  return (
    <div className="flex min-w-0 flex-col gap-3 px-4 py-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-xs text-neutral-600">
          <span>
            {processedCount} of {items.length} processed
          </span>
          <span>
            {activeItems.length} active · {waitingItems.length} queued
            {failedItems.length > 0 ? ` · ${failedItems.length} failed` : ""}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={overallPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall upload progress"
        >
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 bg-[#faf9f8] px-3 py-2">
          <p className="text-xs font-medium text-neutral-600">
            In progress · {activeItems.length} of {UPLOAD_MANAGER_MAX_CONCURRENT}
          </p>
        </div>
        <div className="divide-y divide-neutral-100" style={{ minHeight: ACTIVE_STACK_HEIGHT }}>
          {activeItems.length > 0 ? (
            activeItems.map((item) => (
              <ActiveUploadRow
                key={`${item.id}-${item.phase}`}
                item={item}
                onCancel={onCancelItem}
              />
            ))
          ) : (
            <div
              className="flex items-center justify-center px-3 text-sm text-neutral-500"
              style={{ minHeight: ACTIVE_STACK_HEIGHT }}
            >
              Preparing next files…
            </div>
          )}
        </div>
      </div>

      <UploadListBox title={`In queue · ${waitingItems.length}`} emptyLabel="No files waiting">
        {waitingItems.map((item) => (
          <QueuedFileRow key={item.id} item={item} onCancel={onCancelItem} />
        ))}
      </UploadListBox>

      {failedItems.length > 0 ? (
        <UploadListBox title={`Failed · ${failedItems.length}`} emptyLabel="No failed uploads">
          {failedItems.map((item) => (
            <FailedUploadRow key={item.id} item={item} onRemove={onRemoveItem} />
          ))}
        </UploadListBox>
      ) : null}
    </div>
  );
}
