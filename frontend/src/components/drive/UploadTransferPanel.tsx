// Human: Floating upload tray — shows batch progress in the lower-right while the drive stays usable.
// Agent: SUBSCRIBES upload-manager; RENDERS UploadBatchProgressView; DISMISS when batch complete.

import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Upload, X } from "lucide-react";
import { useUploadBatch } from "@/hooks/useUploadBatch";
import {
  UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS,
  UploadBatchProgressView,
  UploadOverallProgressBar,
  UploadQueueBacklogSummary,
  UploadSegmentedProgressBar,
} from "@/components/drive/upload-batch-view";
import {
  cancelAllUploadItems,
  cancelUploadItem,
  dismissUploadBatch,
  getUploadBatchDisplayCounts,
  getUploadBatchOverallPercent,
  reattachUploadFile,
  removeUploadBatchItem,
  retryFailedUploadItems,
  retryUploadItem,
  setUploadBatchPaused,
  setUploadItemPaused,
} from "@/lib/upload-manager";
import { estimateRemainingSeconds } from "@/lib/upload-adaptive";
import {
  formatUploadBatchStatusLine,
  formatUploadFilesProgress,
} from "@/lib/upload-status-copy";
import { toastError, toastSuccess } from "@/lib/toast";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type UploadTransferPanelProps = {
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
};

// Human: Compact status line under the title — shared wording with expanded body summary.
// Agent: CALLS formatUploadBatchStatusLine; COLORS amber when paused/partial, emerald when clean complete.
function UploadHeaderStatusLine({
  counts,
  isComplete,
  isPaused,
  etaLabel,
  remainingBytes,
}: {
  counts: ReturnType<typeof getUploadBatchDisplayCounts>;
  isComplete: boolean;
  isPaused?: boolean;
  etaLabel?: string | null;
  remainingBytes?: number;
}) {
  const text = formatUploadBatchStatusLine({
    counts,
    isComplete,
    isPaused,
    etaLabel,
    remainingBytesLabel:
      remainingBytes != null && remainingBytes > 0
        ? `${formatBytes(remainingBytes)} left`
        : null,
  });
  if (!text) return null;

  const tone = isComplete
    ? counts.failed > 0 || counts.cancelled > 0
      ? "text-warn"
      : "text-ok"
    : isPaused
      ? "text-warn"
      : "text-ink-muted";

  // Human: Do not remount/animate on every ETA or remaining-bytes tick — only color transitions.
  // Agent: truncate keeps this one line; growing ETA + remaining-bytes copy used to wrap and
  //        push the whole bottom-anchored tray up by a line.
  return (
    <p
      className={cn(
        "truncate text-xs font-medium tabular-nums transition-colors duration-300",
        tone,
      )}
    >
      {text}
    </p>
  );
}

// Human: Non-blocking upload progress card — stacks above downloads in TransferPanelStack.
// Agent: READS UploadBatchSnapshot; TOGGLES minimized header-only mode; CALLS dismissUploadBatch.
export function UploadTransferPanel({ minimized, onMinimizedChange }: UploadTransferPanelProps) {
  const batch = useUploadBatch();

  if (!batch) return null;

  const counts = getUploadBatchDisplayCounts(batch.items);
  const isComplete = batch.status === "complete";
  const totalCount = counts.total;
  const processedCount = counts.done + counts.failed + counts.cancelled;
  // Human: Overall % tracks full upload + conversion progress across every file in the batch.
  const overallPercent = isComplete
    ? 100
    : getUploadBatchOverallPercent(batch.items);
  // Human: Share of the batch that is fully banked — drives the solid segment of the overall bar.
  // Agent: Counts only terminal-done files so the green portion can never regress.
  const donePercent = totalCount > 0 ? Math.round((counts.done / totalCount) * 100) : 0;
  const hasPending = counts.inFlight > 0 || counts.waiting > 0;
  const pendingItems = batch.items.filter(
    (item) => item.status === "uploading" || item.status === "queued",
  );
  const pendingAreOnlyRebuilds =
    pendingItems.length > 0 && pendingItems.every((item) => item.isReprocess);
  const canRetryFailed = batch.items.some((item) => item.canRetry);
  const isBulkBatch = totalCount > UPLOAD_PANEL_MAX_INDIVIDUAL_BACKLOG_ROWS;
  const isPaused = Boolean(batch.paused);
  const remainingBytes = batch.items
    .filter((item) => item.status === "queued" || item.status === "uploading")
    .reduce((sum, item) => {
      if (item.status === "queued") return sum + item.fileSize;
      const doneRatio = Math.min(100, Math.max(0, item.progress)) / 100;
      return sum + Math.max(0, Math.round(item.fileSize * (1 - doneRatio)));
    }, 0);
  const etaSeconds = !isComplete ? estimateRemainingSeconds(remainingBytes) : null;
  const etaLabel =
    etaSeconds == null
      ? null
      : etaSeconds < 60
        ? `~${etaSeconds}s left`
        : `~${Math.ceil(etaSeconds / 60)}m left`;

  const showExpandedLive = !minimized && !isComplete;
  const showExpandedComplete = !minimized && isComplete;
  const showMinimizedLive = minimized && !isComplete;
  const showMinimizedComplete = minimized && isComplete;

  return (
    <div
      className={cn(
        "transfer-panel-enter pointer-events-auto flex w-full flex-col overflow-hidden rounded-xl border border-edge bg-panel transition-shadow duration-300",
        minimized ? "shadow-[0_8px_16px_rgba(0,0,0,0.08)]" : "shadow-[0_12px_24px_rgba(0,0,0,0.1)]",
      )}
      role="region"
      aria-label="Uploads"
    >
      {/* Human: Two-row header — title/actions never share a row with status labels. */}
      <div
        className={cn(
          "grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-5 pt-4 transition-[padding,border-color] duration-300",
          !minimized ? "border-b border-edge pb-3" : "border-b border-transparent pb-1",
        )}
      >
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <Upload
            className={cn(
              "size-4 shrink-0 text-brand transition-transform duration-300",
              !isComplete && hasPending && "animate-pulse",
            )}
            aria-hidden
          />
          <span className="truncate text-sm font-bold text-ink">Uploads</span>
        </div>

        <div className="col-start-2 row-start-1 flex h-7 shrink-0 items-center justify-end gap-0.5 self-start">
          {canRetryFailed && !minimized ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-semibold text-brand transition-colors hover:text-brand-hover"
              onClick={() => retryFailedUploadItems()}
            >
              Retry failed
            </Button>
          ) : null}
          {!isComplete && !minimized && hasPending ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
              onClick={() => setUploadBatchPaused(!isPaused)}
            >
              {isPaused ? "Resume" : "Pause"}
            </Button>
          ) : null}
          {!isComplete && !minimized ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2 text-xs font-semibold text-ink-muted transition-all hover:text-ink",
                hasPending ? "visible opacity-100" : "invisible pointer-events-none opacity-0",
              )}
              tabIndex={hasPending ? 0 : -1}
              aria-hidden={!hasPending}
              onClick={() => cancelAllUploadItems()}
            >
              {pendingAreOnlyRebuilds ? "Cancel rebuilds" : "Cancel all"}
            </Button>
          ) : null}
          {isComplete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-ink-faint transition-colors hover:text-ink"
              aria-label="Dismiss uploads"
              onClick={() => dismissUploadBatch()}
            >
              <X className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-ink-faint transition-colors hover:text-ink"
              aria-label={minimized ? "Expand uploads panel" : "Minimize uploads panel"}
              onClick={() => onMinimizedChange(!minimized)}
            >
              {minimized ? (
                <ChevronUp className="size-4 transition-transform duration-300" aria-hidden />
              ) : (
                <ChevronDown className="size-4 transition-transform duration-300" aria-hidden />
              )}
            </Button>
          )}
        </div>

        <div className="col-span-2 min-h-[1.125rem] min-w-0">
          <UploadHeaderStatusLine
            counts={counts}
            isComplete={isComplete}
            isPaused={isPaused}
            etaLabel={etaLabel}
            remainingBytes={remainingBytes}
          />
        </div>
      </div>

      {/* Human: Minimized live body — grid rows animate open/closed with the expanded sections. */}
      <div
        className={cn(
          "transfer-panel-body",
          showMinimizedLive ? "transfer-panel-body-open" : "transfer-panel-body-closed",
        )}
        aria-hidden={!showMinimizedLive}
      >
        <div className="transfer-panel-body-inner">
          <div className="flex min-h-[6.75rem] flex-col gap-2.5 px-4 pb-4 pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-ink transition-opacity duration-200">
                {formatUploadFilesProgress(processedCount, totalCount)}
              </p>
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-brand transition-[color,transform] duration-300">
                {overallPercent}%
              </span>
            </div>
            <UploadOverallProgressBar percent={overallPercent} />
            <UploadQueueBacklogSummary count={counts.waiting} reserveSlot={isBulkBatch} />
            <p
              className={cn(
                "min-h-[1rem] text-xs text-warn transition-opacity duration-300",
                counts.failed > 0 || counts.cancelled > 0 ? "opacity-100" : "opacity-0",
              )}
              aria-hidden={counts.failed === 0 && counts.cancelled === 0}
            >
              {formatUploadBatchStatusLine({
                counts: { ...counts, inFlight: 0, waiting: 0 },
                isComplete: true,
              })}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "transfer-panel-body",
          showMinimizedComplete ? "transfer-panel-body-open" : "transfer-panel-body-closed",
        )}
        aria-hidden={!showMinimizedComplete}
      >
        <div className="transfer-panel-body-inner">
          <div className="flex items-center justify-between gap-2 px-4 pb-4 pt-3">
            <p className="text-[13px] font-semibold text-ink">
              {formatUploadBatchStatusLine({ counts, isComplete: true })}
            </p>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-ink-muted transition hover:bg-surface"
              onClick={() => dismissUploadBatch()}
            >
              Done
            </button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "transfer-panel-body",
          showExpandedLive ? "transfer-panel-body-open" : "transfer-panel-body-closed",
        )}
        aria-hidden={!showExpandedLive}
      >
        <div className="transfer-panel-body-inner">
          <div className="flex min-h-0 shrink-0 flex-col gap-3 px-4 pb-4 pt-3">
            {/* Human: Single source of batch truth — hero percent plus one segmented bar. */}
            {/* Agent: REPLACES the former duplicate "X of Y files" + "N active · N queued" row. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-end justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="text-2xl font-semibold leading-none tabular-nums text-ink">
                    {overallPercent}
                  </span>
                  <span className="text-sm font-medium leading-none text-ink-faint">%</span>
                </div>
                <p className="truncate text-[11px] tabular-nums text-ink-muted">
                  <span className="font-semibold text-ink">{counts.done}</span> of {totalCount} done
                </p>
              </div>
              <UploadSegmentedProgressBar
                donePercent={donePercent}
                overallPercent={overallPercent}
                isPaused={isPaused}
              />
            </div>

            <div className="h-px w-full shrink-0 bg-hairline" aria-hidden />

            <UploadBatchProgressView
              items={batch.items}
              onCancelItem={cancelUploadItem}
              onRemoveItem={removeUploadBatchItem}
              onRetryItem={(itemId) => {
                retryUploadItem(itemId);
              }}
              onTogglePauseItem={(itemId, paused) => setUploadItemPaused(itemId, paused)}
              onReattachFile={(itemId, file) => {
                if (!reattachUploadFile(itemId, file)) {
                  toastError(
                    "Choose the same file (matching name and size) to continue the upload.",
                  );
                  return;
                }
                toastSuccess("File reattached — upload will resume.");
              }}
              onReattachFiles={(files) => {
                let matched = 0;
                const needing = batch.items.filter((item) => item.needsFileReselect);
                for (const item of needing) {
                  const match = files.find(
                    (file) => file.name === item.fileName && file.size === item.fileSize,
                  );
                  if (match && reattachUploadFile(item.id, match)) {
                    matched += 1;
                  }
                }
                if (matched === 0) {
                  toastError(
                    "No matching files found. Re-select files with the same name and size.",
                  );
                } else {
                  toastSuccess(
                    matched === needing.length
                      ? `Reattached ${matched} file${matched === 1 ? "" : "s"} — uploads will resume.`
                      : `Reattached ${matched} of ${needing.length} files. Re-pick the rest if needed.`,
                  );
                }
              }}
            />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "transfer-panel-body",
          showExpandedComplete ? "transfer-panel-body-open" : "transfer-panel-body-closed",
        )}
        aria-hidden={!showExpandedComplete}
      >
        <div className="transfer-panel-body-inner">
          <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
            <div
              className={cn(
                "transfer-row-enter flex items-center gap-2 rounded-lg px-3 py-2 transition-colors duration-300",
                counts.failed > 0 || counts.cancelled > 0
                  ? "bg-warn-weak text-warn"
                  : "bg-ok-weak text-ok",
              )}
            >
              {counts.failed > 0 || counts.cancelled > 0 ? (
                <AlertCircle className="size-4 shrink-0" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              )}
              <p className="text-sm font-medium">
                {formatUploadBatchStatusLine({ counts, isComplete: true })}
              </p>
            </div>
            <ul className="max-h-40 divide-y divide-hairline overflow-y-auto rounded-lg border border-edge">
              {batch.items.map((item, index) => {
                const canRemove = item.status === "error" || item.status === "cancelled";
                const terminal =
                  item.status === "done"
                    ? "Done"
                    : item.status === "cancelled"
                      ? "Cancelled"
                      : "Failed";
                return (
                  <li
                    key={item.id}
                    className="transfer-row-enter flex items-center gap-2 px-3 py-2.5 transition-colors duration-200 hover:bg-surface"
                    style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                  >
                    {item.status === "done" ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-ok" aria-hidden />
                    ) : item.status === "cancelled" ? (
                      <X className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                    ) : (
                      <AlertCircle className="size-3.5 shrink-0 text-danger" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {item.fileName}
                      </span>
                      {item.status === "error" && item.error ? (
                        <span className="block truncate text-[11px] text-danger" title={item.error}>
                          {item.error}
                        </span>
                      ) : (
                        <span className="block truncate text-[11px] text-ink-faint">
                          {formatBytes(item.fileSize)}
                          <span aria-hidden> · </span>
                          <span
                            className={
                              item.status === "done"
                                ? "text-ok"
                                : item.status === "error"
                                  ? "text-danger"
                                  : "text-ink-muted"
                            }
                          >
                            {terminal}
                          </span>
                        </span>
                      )}
                    </div>
                    {item.canRetry ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs font-semibold transition-colors"
                        onClick={() => retryUploadItem(item.id)}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shrink-0 text-ink-faint transition-colors hover:text-danger"
                        aria-label={`Remove ${item.fileName} from uploads`}
                        onClick={() => removeUploadBatchItem(item.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {canRetryFailed ? (
              <Button
                type="button"
                variant="outline"
                className="w-full text-sm font-semibold transition-colors"
                onClick={() => retryFailedUploadItems()}
              >
                Retry failed
              </Button>
            ) : null}
            <button
              type="button"
              className="self-end rounded-lg bg-brand px-5 py-2 text-sm font-bold text-brand-on transition hover:bg-brand-hover active:scale-[0.98]"
              onClick={() => dismissUploadBatch()}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
