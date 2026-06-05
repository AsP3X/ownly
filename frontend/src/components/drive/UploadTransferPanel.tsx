// Human: Floating upload tray — shows batch progress in the lower-right while the drive stays usable.
// Agent: SUBSCRIBES upload-manager; RENDERS UploadBatchProgressView; DISMISS when batch complete.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Upload, X } from "lucide-react";
import {
  UploadBatchProgressView,
  UploadOverallProgressBar,
} from "@/components/drive/upload-batch-view";
import {
  cancelAllUploadItems,
  cancelUploadItem,
  dismissUploadBatch,
  getUploadBatchDisplayCounts,
  removeUploadBatchItem,
  subscribeUploadBatch,
  type UploadBatchSnapshot,
} from "@/lib/upload-manager";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type UploadTransferPanelProps = {
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
};

// Human: Compact status line for the minimized tray header — plain text avoids pill/button overlap.
// Agent: READS batch counts; RETURNS null when expanded (summary row already shows the same detail).
function UploadHeaderStatusLine({
  counts,
  isComplete,
}: {
  counts: ReturnType<typeof getUploadBatchDisplayCounts>;
  isComplete: boolean;
}) {
  if (isComplete) {
    if (counts.failed > 0 || counts.cancelled > 0) {
      const parts = [`${counts.done} uploaded`];
      if (counts.failed > 0) parts.push(`${counts.failed} failed`);
      if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
      return (
        <p className="text-xs font-medium text-amber-800">{parts.join(" · ")}</p>
      );
    }
    return <p className="text-xs font-medium text-emerald-800">All uploads complete</p>;
  }

  const parts: string[] = [];
  if (counts.inFlight > 0) parts.push(`${counts.inFlight} active`);
  if (counts.waiting > 0) parts.push(`${counts.waiting} queued`);
  if (parts.length === 0) return null;

  return (
    <p className="text-xs tabular-nums text-[#666666]">{parts.join(" · ")}</p>
  );
}

// Human: Non-blocking upload progress card — stacks above downloads in TransferPanelStack.
// Agent: READS UploadBatchSnapshot; TOGGLES minimized header-only mode; CALLS dismissUploadBatch.
export function UploadTransferPanel({ minimized, onMinimizedChange }: UploadTransferPanelProps) {
  const [batch, setBatch] = useState<UploadBatchSnapshot | null>(null);

  useEffect(() => subscribeUploadBatch(setBatch), []);

  if (!batch) return null;

  const counts = getUploadBatchDisplayCounts(batch.items);
  const isComplete = batch.status === "complete";
  const totalCount = counts.total;
  const processedCount = counts.done + counts.failed + counts.cancelled;
  const overallPercent =
    totalCount === 0 ? 0 : Math.round((processedCount / totalCount) * 100);
  const hasPending = counts.inFlight > 0 || counts.waiting > 0;

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white",
        minimized ? "shadow-[0_8px_16px_rgba(0,0,0,0.08)]" : "shadow-[0_12px_24px_rgba(0,0,0,0.1)]",
      )}
      role="region"
      aria-label="Uploads"
    >
      {/* Human: Two-row header — title/actions never share a row with status labels. */}
      {/* Agent: GRID col1 title + optional status; col2 stacked actions; SKIPS status row when expanded. */}
      <div
        className={cn(
          "grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-5 pt-4",
          !minimized ? "border-b border-[#E5E7EB] pb-3" : "pb-1",
        )}
      >
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <Upload className="size-4 shrink-0 text-[#2563EB]" aria-hidden />
          <span className="truncate text-sm font-bold text-[#1A1A1A]">Uploads</span>
        </div>

        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-0.5 self-start">
          {!isComplete && hasPending && !minimized ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-semibold text-[#666666] hover:text-[#1A1A1A]"
              onClick={() => cancelAllUploadItems()}
            >
              Cancel all
            </Button>
          ) : null}
          {isComplete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-[#888888] hover:text-[#1A1A1A]"
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
              className="text-[#888888] hover:text-[#1A1A1A]"
              aria-label={minimized ? "Expand uploads panel" : "Minimize uploads panel"}
              onClick={() => onMinimizedChange(!minimized)}
            >
              {minimized ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
            </Button>
          )}
        </div>

        {minimized ? (
          <div className="col-span-2 min-w-0">
            <UploadHeaderStatusLine counts={counts} isComplete={isComplete} />
          </div>
        ) : null}
      </div>

      {/* Human: Minimized tray — file count, percent, and overall bar per Pencil Minimized Uploads Panel. */}
      {/* Agent: READS processedCount/totalCount; RENDERS compact summary when minimized && !complete. */}
      {minimized && !isComplete ? (
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-[#1A1A1A]">
              {processedCount} of {totalCount} file{totalCount === 1 ? "" : "s"}
            </p>
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-[#2563EB]">
              {overallPercent}%
            </span>
          </div>
          <UploadOverallProgressBar percent={overallPercent} />
          {counts.failed > 0 || counts.cancelled > 0 ? (
            <p className="text-xs text-amber-800">
              {counts.done} uploaded
              {counts.failed > 0 ? ` · ${counts.failed} failed` : ""}
              {counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {minimized && isComplete ? (
        <div className="flex items-center justify-between gap-2 px-4 pb-4 pt-3">
          <p className="text-[13px] font-semibold text-[#1A1A1A]">
            {counts.failed > 0 || counts.cancelled > 0
              ? `${counts.done} of ${totalCount} uploaded${counts.failed > 0 ? ` · ${counts.failed} failed` : ""}${counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : ""}`
              : `${totalCount} file${totalCount === 1 ? "" : "s"} uploaded`}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-[#666666] transition hover:bg-[#F7F8FA]"
            onClick={() => dismissUploadBatch()}
          >
            Done
          </button>
        </div>
      ) : null}

      {!minimized && !isComplete ? (
        <div className="flex min-h-0 shrink-0 flex-col gap-3 px-5 pb-5 pt-4">
          <UploadBatchProgressView
            items={batch.items}
            onCancelItem={cancelUploadItem}
            onRemoveItem={removeUploadBatchItem}
          />
        </div>
      ) : null}

      {!minimized && isComplete ? (
        <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2",
              counts.failed > 0 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900",
            )}
          >
            {counts.failed > 0 ? (
              <AlertCircle className="size-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            )}
            <p className="text-sm font-medium">
              {counts.failed > 0 || counts.cancelled > 0
                ? `${counts.done} uploaded${counts.failed > 0 ? ` · ${counts.failed} failed` : ""}${counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : ""}`
                : `${counts.done} file${counts.done === 1 ? "" : "s"} uploaded`}
            </p>
          </div>
          <ul className="max-h-40 divide-y divide-[#E5E7EB] overflow-y-auto rounded-lg border border-[#E5E7EB]">
            {batch.items.map((item) => {
              const canRemove = item.status === "error" || item.status === "cancelled";
              return (
                <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {item.status === "done" ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                  ) : item.status === "cancelled" ? (
                    <X className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
                  ) : (
                    <AlertCircle className="size-3.5 shrink-0 text-red-500" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[#1A1A1A]">{item.fileName}</span>
                    {item.status === "error" && item.error ? (
                      <span className="block truncate text-xs text-red-600" title={item.error}>
                        {item.error}
                      </span>
                    ) : null}
                  </div>
                  {item.status === "cancelled" ? (
                    <span className="shrink-0 text-xs text-[#888888]">Cancelled</span>
                  ) : item.status === "error" ? (
                    <span className="shrink-0 text-xs text-red-600">Failed</span>
                  ) : null}
                  {canRemove ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-[#888888] hover:text-red-600"
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
          <button
            type="button"
            className="self-end rounded-lg bg-[#2563EB] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#1D4ED8]"
            onClick={() => dismissUploadBatch()}
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}
