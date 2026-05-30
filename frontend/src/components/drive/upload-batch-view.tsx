// Human: Shared upload batch progress UI — per-file rows and phase-colored progress bars.
// Agent: READS UploadItemSnapshot[]; RENDERED by UploadTransferPanel when expanded.

import { useEffect, useState } from "react";
import { AlertCircle, Check, Clock, Loader2, X } from "lucide-react";
import type { UploadItemSnapshot, UploadPhase } from "@/lib/upload-manager";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Human: Max height for the scrollable file list inside the expanded transfer panel. */
export const UPLOAD_PANEL_LIST_MAX_HEIGHT = "17.5rem";

// Human: Phase accent tokens from Pencil Upload Progress Panel (blue / purple / green).
// Agent: MAPS upload | processing | storing to Tailwind text and bar fill classes.
function phaseStyles(phase: UploadPhase) {
  if (phase === "storing") {
    return {
      icon: "text-emerald-600",
      percent: "text-emerald-600",
      bar: "bg-emerald-600",
      meta: "text-emerald-600",
      status: "Moving to secure storage",
    };
  }
  if (phase === "processing") {
    return {
      icon: "text-fuchsia-700",
      percent: "text-fuchsia-700",
      bar: "bg-fuchsia-700",
      meta: "text-fuchsia-700",
      status: "Processing encryption",
    };
  }
  return {
    icon: "text-[#2563EB]",
    percent: "text-[#2563EB]",
    bar: "bg-[#2563EB]",
    meta: "text-[#888888]",
    status: "Uploading",
  };
}

// Human: Thin progress track — 4px bar with phase-colored fill or violet shimmer when indeterminate.
// Agent: RENDERS one bar at a time from phase; processing uses upload-shimmer when indeterminate.
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
  const styles = phaseStyles(phase);

  if (phase === "processing" && indeterminate) {
    return (
      <div
        className={cn("relative h-1 w-full overflow-hidden rounded-sm bg-[#E5E7EB]", className)}
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Processing video"
      >
        <div className="absolute inset-y-0 left-0 w-full bg-fuchsia-200/50" />
        <div className="absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-sm bg-fuchsia-700" />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));
  const ariaLabel =
    phase === "storing"
      ? "Moving to storage"
      : phase === "processing"
        ? "Processing video"
        : "Uploading to server";

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
// Agent: READS UploadItemSnapshot; CALLS onCancel; SHOWS phase timer during post-upload work.
export function ActiveUploadRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  const isPostUpload = item.phase === "processing" || item.phase === "storing";
  const isVideo = item.mimeType.startsWith("video/");
  const styles = phaseStyles(item.phase);
  const [phaseElapsedSec, setPhaseElapsedSec] = useState(0);

  useEffect(() => {
    if (!isPostUpload) return;
    const started = Date.now();
    const timerId = window.setInterval(() => {
      setPhaseElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isPostUpload, item.phase]);

  const percentLabel =
    isPostUpload && item.indeterminate ? "Working…" : `${item.progress}%`;
  const elapsedDetail =
    item.phase === "processing" && isVideo && !item.indeterminate
      ? `Encoding ${formatElapsed(phaseElapsedSec)}`
      : formatElapsed(phaseElapsedSec);

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
        indeterminate={item.indeterminate}
      />
      <p className="truncate text-[11px] leading-tight">
        <span className="text-[#888888]">{formatBytes(item.fileSize)}</span>
        <span className="text-[#888888]"> · </span>
        <span className={styles.meta}>{styles.status}</span>
        {isPostUpload ? (
          <>
            <span className="text-[#888888]"> · </span>
            <span className={styles.meta}>{elapsedDetail}</span>
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
        {formatBytes(item.fileSize)} · Completed
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

// Human: Upload batch body — overall summary, divider, and unified scrollable file list.
// Agent: READS UploadItemSnapshot[]; CALLS onCancel/onRemove; USED by UploadTransferPanel when expanded.
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
  const doneItems = items.filter((item) => item.status === "done");
  const failedItems = items.filter(
    (item) => item.status === "error" || item.status === "cancelled",
  );
  const doneCount = doneItems.length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const cancelledCount = items.filter((item) => item.status === "cancelled").length;
  const processedCount = doneCount + errorCount + cancelledCount;
  const overallPercent =
    items.length === 0 ? 0 : Math.round((processedCount / items.length) * 100);

  return (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-[#666666]">
        <span>
          {processedCount} of {items.length} completed
        </span>
        <span>
          {activeItems.length} active · {waitingItems.length} queued
          {failedItems.length > 0 ? ` · ${failedItems.length} failed` : ""}
        </span>
      </div>
      <UploadOverallProgressBar percent={overallPercent} />

      <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />

      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
        style={{ maxHeight: UPLOAD_PANEL_LIST_MAX_HEIGHT }}
      >
        {activeItems.length === 0 && waitingItems.length === 0 && doneItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#888888]">Preparing next files…</p>
        ) : null}

        {activeItems.map((item) => (
          <ActiveUploadRow key={`${item.id}-${item.phase}`} item={item} onCancel={onCancelItem} />
        ))}

        {waitingItems.map((item) => (
          <QueuedFileRow key={item.id} item={item} onCancel={onCancelItem} />
        ))}

        {doneItems.map((item) => (
          <CompletedUploadRow key={item.id} item={item} />
        ))}

        {failedItems.map((item) => (
          <FailedUploadRow key={item.id} item={item} onRemove={onRemoveItem} />
        ))}
      </div>
    </>
  );
}
