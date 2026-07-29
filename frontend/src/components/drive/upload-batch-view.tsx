// Human: Shared upload batch progress UI — consistent status copy, bars, and row chrome.
// Agent: READS UploadItemSnapshot[]; RENDERED by UploadTransferPanel when expanded.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Clock, Loader2, X } from "lucide-react";
import {
  getUploadBatchDisplayCounts,
  getUploadBatchOverallPercent,
  type UploadItemSnapshot,
  type UploadPhase,
} from "@/lib/upload-manager";
import {
  formatUploadDoneSummary,
  formatUploadFilesProgress,
  formatUploadQueueSummary,
  getUploadPercentLabel,
  getUploadPhaseLabel,
  getUploadTerminalStatus,
} from "@/lib/upload-status-copy";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Human: Fixed height for the scrollable file list — prevents the tray from resizing as rows finish. */
export const UPLOAD_PANEL_LIST_HEIGHT = "17.5rem";

/** Human: Reserved height for pinned queue/done summary slots. */
export const UPLOAD_PANEL_TOP_SUMMARY_SLOT_HEIGHT = "1.375rem";

/** Human: Above this count, completed rows collapse to one summary line. */
export const UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS = 3;

// Human: Phase accent tokens — one palette for icon, percent, bar, and status text.
// Agent: MAPS uploading | processing | encrypting | storing to Tailwind classes.
function phaseStyles(phase: UploadPhase) {
  if (phase === "storing") {
    return {
      icon: "text-emerald-600",
      percent: "text-emerald-600",
      bar: "bg-emerald-600",
      status: "text-emerald-700",
      shimmer: "bg-emerald-600",
      track: "bg-emerald-100",
    };
  }
  if (phase === "encrypting") {
    return {
      icon: "text-amber-600",
      percent: "text-amber-600",
      bar: "bg-amber-500",
      status: "text-amber-700",
      shimmer: "bg-amber-500",
      track: "bg-amber-100",
    };
  }
  if (phase === "processing") {
    return {
      icon: "text-fuchsia-700",
      percent: "text-fuchsia-700",
      bar: "bg-fuchsia-700",
      status: "text-fuchsia-800",
      shimmer: "bg-fuchsia-700",
      track: "bg-fuchsia-100",
    };
  }
  return {
    icon: "text-[#2563EB]",
    percent: "text-[#2563EB]",
    bar: "bg-[#2563EB]",
    status: "text-[#2563EB]",
    shimmer: "bg-[#2563EB]",
    track: "bg-[#DBEAFE]",
  };
}

function isPostUploadPhase(phase: UploadPhase): boolean {
  return phase === "processing" || phase === "encrypting" || phase === "storing";
}

// Human: Shared progress track — same height/radius for per-file and overall bars.
// Agent: DETERMINATE width from value with transfer-progress-fill; SHIMMER when indeterminate.
export function UploadProgressBar({
  value,
  phase = "uploading",
  indeterminate,
  statusLabel,
  size = "sm",
  className,
}: {
  value: number;
  phase?: UploadPhase;
  indeterminate?: boolean;
  statusLabel?: string;
  /** sm = per-file (4px), md = overall batch (6px) */
  size?: "sm" | "md";
  className?: string;
}) {
  const styles = phaseStyles(phase);
  const heightClass = size === "md" ? "h-1.5" : "h-1";
  const ariaLabel = statusLabel ?? (phase === "uploading" ? "Uploading" : "Upload in progress");
  const useShimmer = Boolean(indeterminate && isPostUploadPhase(phase));

  if (useShimmer) {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-[#E5E7EB]",
          heightClass,
          className,
        )}
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-full transition-colors duration-300 ease-out",
            styles.track,
          )}
        />
        <div
          className={cn(
            "absolute inset-y-0 w-2/5 animate-[upload-shimmer_1.4s_ease-in-out_infinite] rounded-full",
            styles.shimmer,
          )}
        />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-[#E5E7EB]",
        heightClass,
        className,
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={cn("transfer-progress-fill h-full rounded-full", styles.bar)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// Human: Soft enter only when pipeline phase text changes (Uploading → Converting), not on every tick.
// Agent: TRACKS previous label; APPLIES transfer-status-enter only on discrete label change.
function AnimatedPhaseStatus({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const prevRef = useRef(children);
  const [enter, setEnter] = useState(false);

  useEffect(() => {
    if (prevRef.current === children) return;
    prevRef.current = children;
    setEnter(true);
    const id = window.setTimeout(() => setEnter(false), 240);
    return () => window.clearTimeout(id);
  }, [children]);

  return (
    <span className={cn(enter && "transfer-status-enter", "inline-block", className)}>
      {children}
    </span>
  );
}

// Human: Percent label with a light pop when the integer value advances.
function AnimatedPercentLabel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const prevRef = useRef(label);
  const [tick, setTick] = useState(false);

  useEffect(() => {
    if (prevRef.current === label) return;
    prevRef.current = label;
    if (label === "…") return;
    setTick(true);
    const id = window.setTimeout(() => setTick(false), 280);
    return () => window.clearTimeout(id);
  }, [label]);

  return (
    <span
      className={cn(
        "inline-block tabular-nums will-change-transform",
        tick && "transfer-percent-tick",
        className,
      )}
    >
      {label}
    </span>
  );
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

// Human: Meta fragments under every row — size · status · optional detail (always same separators).
function UploadRowMeta({
  sizeBytes,
  status,
  statusClassName,
  detail,
}: {
  sizeBytes: number;
  status: string;
  statusClassName?: string;
  detail?: string | null;
}) {
  return (
    <p className="truncate text-[11px] leading-tight text-[#888888]">
      <span className="tabular-nums">{formatBytes(sizeBytes)}</span>
      <span aria-hidden> · </span>
      <AnimatedPhaseStatus className={cn(statusClassName ?? "text-[#666666]")}>
        {status}
      </AnimatedPhaseStatus>
      {detail ? (
        <>
          <span aria-hidden> · </span>
          <span className="transition-opacity duration-200">{detail}</span>
        </>
      ) : null}
    </p>
  );
}

// Human: Active upload row — filename, percent, bar, and meta in one consistent layout.
// Agent: READS UploadItemSnapshot; CALLS onCancel to abort and remove row.
export function ActiveUploadRow({
  item,
  onCancel,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
}) {
  const postUpload = isPostUploadPhase(item.phase);
  const styles = phaseStyles(item.phase);
  const phaseStatus = getUploadPhaseLabel(item);
  const percentLabel = getUploadPercentLabel(item);
  const showIndeterminate = postUpload && Boolean(item.indeterminate) && item.progress <= 0;
  const [phaseElapsedSec, setPhaseElapsedSec] = useState(0);

  useEffect(() => {
    if (!postUpload) return;
    const started = Date.now();
    const timerId = window.setInterval(() => {
      setPhaseElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [postUpload, item.phase]);

  const detailParts: string[] = [];
  if (item.paused) detailParts.push("Paused");
  if (postUpload && phaseElapsedSec > 0) detailParts.push(formatElapsed(phaseElapsedSec));
  // Human: Transport is diagnostic only — muted and after status, not competing with phase color.
  if (item.phase === "uploading" && item.partTransport) {
    detailParts.push(item.partTransport === "direct" ? "Direct" : "Via API");
  }

  return (
    <div className="transfer-row-enter flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2
            className={cn(
              "size-3.5 shrink-0 animate-spin transition-colors duration-300",
              styles.icon,
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="min-w-0 truncate text-[13px] font-semibold text-[#1A1A1A]">
              {item.fileName}
            </p>
            {item.relativePath ? (
              <p className="truncate text-[11px] text-[#888888]" title={item.relativePath}>
                {item.relativePath}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <AnimatedPercentLabel
            label={percentLabel}
            className={cn("text-[13px] font-semibold transition-colors duration-300", styles.percent)}
          />
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-[#888888] transition-colors hover:text-[#1A1A1A]"
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
        indeterminate={showIndeterminate}
        statusLabel={phaseStatus}
      />
      <UploadRowMeta
        sizeBytes={item.fileSize}
        status={phaseStatus}
        statusClassName={styles.status}
        detail={detailParts.length > 0 ? detailParts.join(" · ") : null}
      />
    </div>
  );
}

// Human: Completed file row — same meta pattern as active (size · Done).
export function CompletedUploadRow({ item }: { item: UploadItemSnapshot }) {
  return (
    <div className="transfer-row-enter flex items-center justify-between gap-2 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <Check className="size-3.5 shrink-0 text-emerald-500 transition-transform duration-300" aria-hidden />
        <div className="min-w-0">
          <p className="min-w-0 truncate text-[13px] font-medium text-[#1A1A1A]">{item.fileName}</p>
          {item.relativePath ? (
            <p className="truncate text-[11px] text-[#888888]">{item.relativePath}</p>
          ) : null}
          <UploadRowMeta
            sizeBytes={item.fileSize}
            status={getUploadTerminalStatus("done")}
            statusClassName="text-emerald-700"
          />
        </div>
      </div>
    </div>
  );
}

// Human: Queued file row — same icon/name/meta structure as other rows.
export function QueuedFileRow({
  item,
  onCancel,
  onTogglePause,
}: {
  item: UploadItemSnapshot;
  onCancel?: (itemId: string) => void;
  onTogglePause?: (itemId: string, paused: boolean) => void;
}) {
  const status = item.paused ? "Paused" : "Queued";

  return (
    <div className="transfer-row-enter flex items-center justify-between gap-2 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <Clock className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
        <div className="min-w-0">
          <p className="min-w-0 truncate text-[13px] font-medium text-[#1A1A1A]">{item.fileName}</p>
          {item.relativePath ? (
            <p className="truncate text-[11px] text-[#888888]">{item.relativePath}</p>
          ) : null}
          <UploadRowMeta sizeBytes={item.fileSize} status={status} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onTogglePause ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-semibold text-[#666666] transition-colors hover:text-[#1A1A1A]"
            onClick={() => onTogglePause(item.id, !item.paused)}
          >
            {item.paused ? "Resume" : "Pause"}
          </Button>
        ) : null}
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-[#888888] transition-colors hover:text-[#1A1A1A]"
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

// Human: Terminal failed or cancelled row — size · Failed/Cancelled + actions.
export function FailedUploadRow({
  item,
  onRemove,
  onReattachFile,
  onRetry,
}: {
  item: UploadItemSnapshot;
  onRemove?: (itemId: string) => void;
  onReattachFile?: (itemId: string, file: File) => void;
  onRetry?: (itemId: string) => void;
}) {
  const isFailed = item.status === "error";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const status = getUploadTerminalStatus(item.status);

  return (
    <div className="transfer-row-enter flex items-center justify-between gap-2 py-0.5">
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
          ) : (
            <UploadRowMeta
              sizeBytes={item.fileSize}
              status={status}
              statusClassName={isFailed ? "text-red-600" : "text-[#666666]"}
            />
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {item.canRetry && onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs font-semibold transition-colors"
            onClick={() => onRetry(item.id)}
          >
            Retry
          </Button>
        ) : null}
        {item.needsFileReselect && onReattachFile ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              aria-hidden
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) onReattachFile(item.id, picked);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs font-semibold transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </Button>
          </>
        ) : null}
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-[#888888] transition-colors hover:text-red-600"
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

// Human: Overall progress bar for the batch — same chrome as per-file, slightly taller.
export function UploadOverallProgressBar({ percent }: { percent: number }) {
  return (
    <UploadProgressBar
      value={percent}
      phase="uploading"
      size="md"
      statusLabel="Overall upload progress"
    />
  );
}

// Human: Expanded-tray summary — files progress + active/failed counts (shared vocabulary).
function UploadBatchSummaryRow({
  processedCount,
  totalCount,
  counts,
}: {
  processedCount: number;
  totalCount: number;
  counts: ReturnType<typeof getUploadBatchDisplayCounts>;
}) {
  const rightParts: string[] = [];
  if (counts.inFlight > 0) rightParts.push(`${counts.inFlight} active`);
  if (counts.waiting > 0) rightParts.push(`${counts.waiting} queued`);
  if (counts.failed > 0) rightParts.push(`${counts.failed} failed`);
  if (counts.cancelled > 0) rightParts.push(`${counts.cancelled} cancelled`);

  const right = rightParts.length > 0 ? rightParts.join(" · ") : "Preparing…";

  return (
    <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-xs text-[#666666]">
      <span className="truncate font-medium tabular-nums text-[#1A1A1A]">
        {formatUploadFilesProgress(processedCount, totalCount)}
      </span>
      {/* Human: Live counts update without enter animation — avoids flicker on every progress tick. */}
      <span className="truncate text-right tabular-nums">{right}</span>
    </div>
  );
}

// Human: Queue backlog line — fixed slot height when reserved for bulk batches.
export function UploadQueueBacklogSummary({
  count,
  reserveSlot = false,
}: {
  count: number;
  reserveSlot?: boolean;
}) {
  if (count === 0 && !reserveSlot) return null;
  const label = formatUploadQueueSummary(count);

  return (
    <div
      className="flex shrink-0 items-center gap-2"
      style={{ minHeight: UPLOAD_PANEL_TOP_SUMMARY_SLOT_HEIGHT }}
    >
      {count > 0 ? (
        <>
          <Clock className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
          <p className="truncate text-[11px] text-[#888888]">{label}</p>
        </>
      ) : (
        <span className="sr-only">No files waiting in queue</span>
      )}
    </div>
  );
}

// Human: Done backlog line for large batches.
export function UploadDoneBacklogSummary({
  count,
  reserveSlot = false,
}: {
  count: number;
  reserveSlot?: boolean;
}) {
  if (count === 0 && !reserveSlot) return null;
  const label = formatUploadDoneSummary(count);

  return (
    <div
      className="flex shrink-0 items-center gap-2"
      style={{ minHeight: UPLOAD_PANEL_TOP_SUMMARY_SLOT_HEIGHT }}
    >
      {count > 0 ? (
        <>
          <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
          <p className="truncate text-[11px] text-[#888888]">{label}</p>
        </>
      ) : (
        <span className="sr-only">No completed uploads yet</span>
      )}
    </div>
  );
}

// Human: Upload batch body — overall summary, divider, and unified scrollable file list.
export function UploadBatchProgressView({
  items,
  onCancelItem,
  onRemoveItem,
  onReattachFile,
  onReattachFiles,
  onRetryItem,
  onTogglePauseItem,
}: {
  items: UploadItemSnapshot[];
  onCancelItem?: (itemId: string) => void;
  onRemoveItem?: (itemId: string) => void;
  onReattachFile?: (itemId: string, file: File) => void;
  onReattachFiles?: (files: File[]) => void;
  onRetryItem?: (itemId: string) => void;
  onTogglePauseItem?: (itemId: string, paused: boolean) => void;
}) {
  const batchReselectRef = useRef<HTMLInputElement | null>(null);
  const counts = getUploadBatchDisplayCounts(items);
  const activeItems = items.filter((item) => item.displayBucket === "in_flight");
  const waitingItems = items.filter((item) => item.displayBucket === "queued");
  const doneItems = items.filter((item) => item.displayBucket === "done");
  const failedItems = items.filter(
    (item) => item.displayBucket === "error" || item.displayBucket === "cancelled",
  );
  const needsReselectCount = items.filter((item) => item.needsFileReselect).length;
  const processedCount = counts.done + counts.failed + counts.cancelled;
  const overallPercent = getUploadBatchOverallPercent(items);
  const isBulkBatch = items.length > UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const showIndividualDoneRows =
    !isBulkBatch && doneItems.length <= UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const listIsEmpty = activeItems.length === 0 && failedItems.length === 0;

  return (
    <>
      <UploadBatchSummaryRow
        processedCount={processedCount}
        totalCount={items.length}
        counts={counts}
      />
      <UploadOverallProgressBar percent={overallPercent} />

      <UploadQueueBacklogSummary count={waitingItems.length} reserveSlot={isBulkBatch} />
      {isBulkBatch ? (
        <UploadDoneBacklogSummary count={doneItems.length} reserveSlot />
      ) : null}

      {needsReselectCount > 1 && onReattachFiles ? (
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[11px] leading-snug text-amber-900">
            {needsReselectCount} uploads need the original files after reload.
          </p>
          <input
            ref={batchReselectRef}
            type="file"
            multiple
            className="hidden"
            aria-hidden
            onChange={(event) => {
              const picked = event.target.files ? Array.from(event.target.files) : [];
              if (picked.length > 0) onReattachFiles(picked);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs font-semibold"
            onClick={() => batchReselectRef.current?.click()}
          >
            Choose files
          </Button>
        </div>
      ) : null}

      <div className="h-px w-full shrink-0 bg-[#E5E7EB]" aria-hidden />

      <div
        className="flex shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain"
        style={{ height: UPLOAD_PANEL_LIST_HEIGHT }}
      >
        {listIsEmpty ? (
          <p className="flex min-h-[3.25rem] items-center justify-center text-center text-sm text-[#888888]">
            {waitingItems.length > 0 ? "Waiting for the next slot…" : "Preparing next files…"}
          </p>
        ) : null}

        {activeItems.map((item) => (
          <ActiveUploadRow key={item.id} item={item} onCancel={onCancelItem} />
        ))}

        {!isBulkBatch
          ? waitingItems.map((item) => (
              <QueuedFileRow
                key={item.id}
                item={item}
                onCancel={onCancelItem}
                onTogglePause={onTogglePauseItem}
              />
            ))
          : null}

        {showIndividualDoneRows
          ? doneItems.map((item) => <CompletedUploadRow key={item.id} item={item} />)
          : null}

        {failedItems.map((item) => (
          <FailedUploadRow
            key={item.id}
            item={item}
            onRemove={onRemoveItem}
            onReattachFile={onReattachFile}
            onRetry={onRetryItem}
          />
        ))}
      </div>
    </>
  );
}
