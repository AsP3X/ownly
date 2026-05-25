// Human: Floating upload tray — shows batch progress in the lower-right while the drive stays usable.
// Agent: SUBSCRIBES upload-manager; RENDERS UploadBatchProgressView; DISMISS when batch complete.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Upload, X } from "lucide-react";
import { UploadBatchProgressView } from "@/components/drive/upload-batch-view";
import {
  cancelAllUploadItems,
  cancelUploadItem,
  dismissUploadBatch,
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

// Human: Non-blocking upload progress card — stacks above downloads in TransferPanelStack.
// Agent: READS UploadBatchSnapshot; TOGGLES minimized header-only mode; CALLS dismissUploadBatch.
export function UploadTransferPanel({ minimized, onMinimizedChange }: UploadTransferPanelProps) {
  const [batch, setBatch] = useState<UploadBatchSnapshot | null>(null);

  useEffect(() => subscribeUploadBatch(setBatch), []);

  if (!batch) return null;

  const activeCount = batch.items.filter((item) => item.status === "uploading").length;
  const queuedCount = batch.items.filter((item) => item.status === "queued").length;
  const doneCount = batch.items.filter((item) => item.status === "done").length;
  const errorCount = batch.items.filter((item) => item.status === "error").length;
  const cancelledCount = batch.items.filter((item) => item.status === "cancelled").length;
  const isComplete = batch.status === "complete";
  const totalCount = batch.items.length;
  const processedCount = doneCount + errorCount + cancelledCount;
  const overallPercent =
    totalCount === 0 ? 0 : Math.round((processedCount / totalCount) * 100);
  const hasPending = activeCount > 0 || queuedCount > 0;

  return (
    <div
      className="pointer-events-auto w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
      role="region"
      aria-label="Uploads"
    >
      <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
          <Upload className="size-4 shrink-0 text-blue-600" aria-hidden />
          <span>Uploads</span>
          {!minimized && isComplete ? (
            errorCount > 0 || cancelledCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                {doneCount} done
                {errorCount > 0 ? ` · ${errorCount} failed` : ""}
                {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Complete
              </span>
            )
          ) : !minimized && !isComplete ? (
            <>
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
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isComplete && hasPending && !minimized ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-neutral-600"
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
              className="text-neutral-500"
              aria-label="Dismiss uploads"
              onClick={() => dismissUploadBatch()}
            >
              <X className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onMinimizedChange(!minimized)}
            >
              {minimized ? "Show" : "Minimize"}
            </Button>
          )}
        </div>
      </div>

      {/* Human: Minimized tray shows overall file progress — primary indicator while browsing the drive. */}
      {/* Agent: READS processedCount/totalCount; RENDERS label + bar when minimized && !complete. */}
      {minimized && !isComplete ? (
        <div className="space-y-2 border-b border-neutral-100 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900">
              {processedCount} of {totalCount} file{totalCount === 1 ? "" : "s"}
            </p>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-700">
              {overallPercent}%
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
            role="progressbar"
            aria-valuenow={overallPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${processedCount} of ${totalCount} files processed`}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
          {errorCount > 0 || cancelledCount > 0 ? (
            <p className="text-xs text-amber-800">
              {doneCount} uploaded
              {errorCount > 0 ? ` · ${errorCount} failed` : ""}
              {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {minimized && isComplete ? (
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="text-sm font-medium text-neutral-900">
            {errorCount > 0 || cancelledCount > 0
              ? `${doneCount} of ${totalCount} uploaded${errorCount > 0 ? ` · ${errorCount} failed` : ""}${cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ""}`
              : `${totalCount} file${totalCount === 1 ? "" : "s"} uploaded`}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => dismissUploadBatch()}
          >
            Done
          </Button>
        </div>
      ) : null}

      {!minimized && !isComplete ? (
        <UploadBatchProgressView
          items={batch.items}
          onCancelItem={cancelUploadItem}
          onRemoveItem={removeUploadBatchItem}
        />
      ) : null}

      {!minimized && isComplete ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2",
              errorCount > 0 ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900",
            )}
          >
            {errorCount > 0 ? (
              <AlertCircle className="size-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            )}
            <p className="text-sm font-medium">
              {errorCount > 0 || cancelledCount > 0
                ? `${doneCount} uploaded${errorCount > 0 ? ` · ${errorCount} failed` : ""}${cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ""}`
                : `${doneCount} file${doneCount === 1 ? "" : "s"} uploaded`}
            </p>
          </div>
          <ul className="max-h-40 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
            {batch.items.map((item) => {
              const canRemove = item.status === "error" || item.status === "cancelled";
              return (
                <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {item.status === "done" ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-green-600" aria-hidden />
                  ) : item.status === "cancelled" ? (
                    <X className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
                  ) : (
                    <AlertCircle className="size-3.5 shrink-0 text-red-500" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-neutral-900">{item.fileName}</span>
                    {item.status === "error" && item.error ? (
                      <span className="block truncate text-xs text-red-600" title={item.error}>
                        {item.error}
                      </span>
                    ) : null}
                  </div>
                  {item.status === "cancelled" ? (
                    <span className="shrink-0 text-xs text-neutral-500">Cancelled</span>
                  ) : item.status === "error" ? (
                    <span className="shrink-0 text-xs text-red-600">Failed</span>
                  ) : null}
                  {canRemove ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-neutral-500 hover:text-red-600"
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
          <Button
            type="button"
            size="sm"
            className="self-end bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => dismissUploadBatch()}
          >
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}
