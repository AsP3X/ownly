// Human: Confirmation modal before permanently deleting multiple files from the drive.
// Agent: FETCHES deletion-preview; STARTS delete job with blob progress when scope is large.

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteFile,
  fetchBulkDeletionPreview,
  getErrorMessage,
  type BulkDeletionPreview,
  type DeleteJobStatus,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  DeleteJobProgress,
  DeletePreviewLoading,
  DeletePreviewSummary,
} from "@/components/drive/DeleteJobProgress";
import {
  confirmDialogLabelTruncates,
  confirmDialogWidthStyle,
} from "@/lib/confirm-dialog-layout";
import {
  runDeleteJobWithProgress,
  shouldUseDeleteJob,
} from "@/lib/delete-with-progress";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type BulkDeleteItem = {
  id: string;
  name: string;
};

type ConfirmBulkDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BulkDeleteItem[];
  /** Human: Drive shows Recycle + Permanently; permanent-only is used from the recycle bin. */
  variant?: "drive" | "permanent-only";
  title?: string;
  description?: string;
  /** Human: Runs after a successful permanent delete job (e.g. empty recycle bin folder cleanup). */
  onPermanentComplete?: () => Promise<void>;
  onDeleted?: (deletedIds: string[]) => void;
};

// Human: Ask the user to confirm before bulk destructive deletes proceed.
// Agent: PREVIEW blob counts; JOB delete with progress OR sync loop for small selections.
export function ConfirmBulkDeleteDialog({
  open,
  onOpenChange,
  items,
  variant = "drive",
  title: titleOverride,
  description: descriptionOverride,
  onPermanentComplete,
  onDeleted,
}: ConfirmBulkDeleteDialogProps) {
  const permanentOnly = variant === "permanent-only";
  const [confirming, setConfirming] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"recycle" | "permanent" | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<BulkDeletionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [deleteJobStatus, setDeleteJobStatus] = useState<DeleteJobStatus | null>(null);

  const count = items.length;
  const defaultTitle = permanentOnly
    ? count === 1
      ? "Delete file permanently?"
      : `Delete ${count} files permanently?`
    : count === 1
      ? "Recycle file?"
      : `Recycle ${count} files?`;
  const title = titleOverride ?? defaultTitle;
  const defaultDescription = permanentOnly
    ? count === 1
      ? `“${items[0]?.name ?? ""}” will be permanently removed from your library. This cannot be undone.`
      : `${count} files will be permanently removed from your library. This cannot be undone.`
    : count === 1
      ? `“${items[0]?.name ?? ""}” will be moved to the recycle bin. You can restore it within 30 days or delete it permanently from the recycle bin.`
      : `${count} files will be moved to the recycle bin. You can restore them within 30 days or delete them permanently from the recycle bin.`;
  const description = descriptionOverride ?? defaultDescription;

  const dialogWidthStyle = useMemo(
    () =>
      confirmDialogWidthStyle([
        title.length,
        description.length,
        ...items.map((item) => item.name.length),
      ]),
    [title, description, items],
  );

  // Human: Load blob counts whenever the dialog opens with a new selection.
  // Agent: POST /files/deletion-preview; WRITES preview state for summary + job decision.
  useEffect(() => {
    if (!open || items.length === 0) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError("");
      setDeleteJobStatus(null);
      return;
    }

    let cancelled = false;
    setPreview(null);
    setPreviewLoading(true);
    setPreviewError("");
    setDeleteJobStatus(null);

    void fetchBulkDeletionPreview(items.map((item) => item.id))
      .then((nextPreview) => {
        if (!cancelled) setPreview(nextPreview);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, items]);

  function handleOpenChange(next: boolean) {
    if (!next && confirming) return;
    if (!next) {
      setError("");
      setDeleteJobStatus(null);
      setConfirmMode(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent, permanent: boolean) {
    event.preventDefault();
    if (items.length === 0 || confirming) return;

    setConfirming(true);
    setConfirmMode(permanent ? "permanent" : "recycle");
    setError("");
    setDeleteJobStatus(null);

    const fileIds = items.map((item) => item.id);
    const useDeleteJob =
      permanent && (preview ? shouldUseDeleteJob(preview) : items.length > 1);

    try {
      if (useDeleteJob) {
        const finalStatus = await runDeleteJobWithProgress(
          fileIds,
          (status) => {
            setDeleteJobStatus(status);
          },
          { permanent: true },
        );

        if (finalStatus.deleted_file_ids.length > 0) {
          onDeleted?.(finalStatus.deleted_file_ids);
        }

        if (finalStatus.status === "complete") {
          if (onPermanentComplete) {
            await onPermanentComplete();
          }
          handleOpenChange(false);
        } else {
          setError(finalStatus.error ?? "Could not delete the selected files.");
        }
        return;
      }

      const deletedIds: string[] = [];
      const failures: string[] = [];

      for (const item of items) {
        try {
          await deleteFile(item.id, { permanent });
          deletedIds.push(item.id);
        } catch (err) {
          failures.push(`${item.name}: ${getErrorMessage(err)}`);
        }
      }

      if (deletedIds.length > 0) {
        onDeleted?.(deletedIds);
      }

      if (failures.length === 0) {
        if (permanent && onPermanentComplete) {
          await onPermanentComplete();
        }
        handleOpenChange(false);
      } else if (deletedIds.length === 0) {
        setError(failures[0] ?? "Could not delete the selected files.");
      } else {
        setError(
          `Deleted ${deletedIds.length} of ${items.length}. ${failures.slice(0, 3).join(" ")}${
            failures.length > 3 ? " …" : ""
          }`,
        );
        handleOpenChange(false);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setConfirming(false);
      setConfirmMode(null);
    }
  }

  const showPreviewSummary = preview && !previewLoading && !previewError;
  const showProgress = confirming && deleteJobStatus !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={confirming}>
      <DialogContent
        style={dialogWidthStyle}
        className="w-full gap-0 overflow-x-hidden border-neutral-200 bg-white p-0 sm:max-w-none"
      >
        <form
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader className="min-w-0 border-b border-neutral-100 px-6 py-5 pr-12">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-lg text-neutral-900">
              <Trash2 className="size-5 shrink-0 text-red-600" aria-hidden />
              <span className="min-w-0 truncate">{title}</span>
            </DialogTitle>
            <DialogDescription className="break-words text-neutral-500">
              {description}
            </DialogDescription>
          </DialogHeader>

          {previewLoading ? <DeletePreviewLoading /> : null}
          {previewError ? (
            <div className="border-b border-neutral-100 px-6 py-4">
              <Alert variant="destructive">
                <AlertDescription className="break-words">{previewError}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {showPreviewSummary ? (
            <DeletePreviewSummary
              storageObjectCount={preview.storage_object_count}
              fileCount={preview.file_count}
            />
          ) : null}

          {count > 1 ? (
            <ul className="max-h-40 min-w-0 overflow-y-auto border-b border-neutral-100 px-6 py-4 text-sm text-neutral-700">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "min-w-0 py-0.5",
                    confirmDialogLabelTruncates(item.name.length) && "truncate",
                  )}
                  title={item.name}
                >
                  {item.name}
                </li>
              ))}
            </ul>
          ) : null}

          {showProgress ? <DeleteJobProgress status={deleteJobStatus} /> : null}

          {error ? (
            <div className="min-w-0 px-6 pt-4">
              <Alert variant="destructive">
                <AlertDescription className="break-words">{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <DialogFooter className="min-w-0 flex-row flex-wrap items-center justify-between gap-2 border-neutral-100 bg-neutral-50/80 px-6 py-5 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={confirming}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <div className="flex flex-row flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={confirming || count === 0 || previewLoading}
                onClick={(event) => void handleSubmit(event, true)}
              >
                {confirming && confirmMode === "permanent" ? "Deleting…" : "Permanently"}
              </Button>
              {permanentOnly ? null : (
                <Button
                  type="button"
                  variant="default"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={confirming || count === 0 || previewLoading}
                  onClick={(event) => void handleSubmit(event, false)}
                >
                  {confirming && confirmMode === "recycle" ? "Recycling…" : "Recycle"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

