// Human: Confirmation modal before permanently deleting a file or folder from the drive.
// Agent: FETCHES file deletion-preview; STARTS blob-progress delete job for large file deletes.

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteFile,
  deleteFolder,
  fetchFileDeletionPreview,
  getErrorMessage,
  type DeleteJobStatus,
  type FileDeletionPreview,
  type FolderDeletionPreview,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  DeleteJobProgress,
  DeletePreviewLoading,
  DeletePreviewSummary,
} from "@/components/drive/DeleteJobProgress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { confirmDialogWidthStyle } from "@/lib/confirm-dialog-layout";
import {
  runDeleteJobWithProgress,
  shouldUseDeleteJob,
} from "@/lib/delete-with-progress";

export type DeleteItemKind = "file" | "folder";

export type DeleteTarget = {
  kind: DeleteItemKind;
  id: string;
  name: string;
};

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DeleteTarget | null;
  folderPreview?: FolderDeletionPreview | null;
  folderPreviewLoading?: boolean;
  folderPreviewError?: string;
  /** Human: Drive shows Recycle + Permanently; recycle-bin-permanent shows blob preview + Permanently only. */
  variant?: "drive" | "recycle-bin-permanent";
  onDeleted?: (target: DeleteTarget) => void;
};

// Human: Render a readable summary of nested folder contents for the delete prompt.
// Agent: READS FolderDeletionPreview; RETURNS bullet list of file kinds and subfolder count.
function FolderContentsSummary({
  preview,
  permanentOnly = false,
}: {
  preview: FolderDeletionPreview;
  permanentOnly?: boolean;
}) {
  const { file_count, subfolder_count, content_types } = preview;
  const isEmpty = file_count === 0 && subfolder_count === 0;

  if (isEmpty) {
    return <p className="text-sm text-neutral-600">This folder is empty.</p>;
  }

  return (
    <div className="space-y-2 text-sm text-neutral-700">
      <p className="font-medium text-neutral-800">This folder contains:</p>
      <ul className="list-disc space-y-1 pl-5">
        {content_types.map((entry) => (
          <li key={entry.kind}>
            {entry.count} {entry.label}
          </li>
        ))}
        {subfolder_count > 0 ? (
          <li>
            {subfolder_count} nested subfolder{subfolder_count === 1 ? "" : "s"}
          </li>
        ) : null}
      </ul>
      <p className="text-neutral-600">
        {permanentOnly
          ? "All of these will be permanently deleted."
          : "All of these will be moved to the recycle bin."}
      </p>
    </div>
  );
}

// Human: Ask the user to confirm before a destructive delete action proceeds.
// Agent: PREVIEW file blob counts; JOB delete with progress OR sync delete for small files.
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  target,
  folderPreview = null,
  folderPreviewLoading = false,
  folderPreviewError = "",
  variant = "drive",
  onDeleted,
}: ConfirmDeleteDialogProps) {
  const permanentOnly = variant === "recycle-bin-permanent";
  const [confirming, setConfirming] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"recycle" | "permanent" | null>(null);
  const [error, setError] = useState("");
  const [filePreview, setFilePreview] = useState<FileDeletionPreview | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState("");
  const [deleteJobStatus, setDeleteJobStatus] = useState<DeleteJobStatus | null>(null);

  const itemKind = target?.kind ?? "file";
  const itemName = target?.name ?? "";
  const title = permanentOnly
    ? itemKind === "folder"
      ? "Delete folder permanently?"
      : "Delete file permanently?"
    : itemKind === "folder"
      ? "Recycle folder?"
      : "Recycle file?";
  const description = permanentOnly
    ? itemKind === "folder"
      ? `“${itemName}” and every file inside will be permanently removed from your library. This cannot be undone.`
      : `“${itemName}” will be permanently removed from your library. This cannot be undone.`
    : itemKind === "folder"
      ? `“${itemName}” and all nested subfolders will be moved to the recycle bin. You can restore them within 30 days or delete them permanently from the recycle bin.`
      : `“${itemName}” will be moved to the recycle bin. You can restore it within 30 days or delete it permanently from the recycle bin.`;

  const dialogWidthStyle = useMemo(
    () => confirmDialogWidthStyle([title.length, description.length, itemName.length]),
    [title, description, itemName],
  );

  // Human: Count storage blobs for single-file deletes before the user confirms.
  // Agent: GET /files/:id/deletion-preview when dialog opens on a file target.
  useEffect(() => {
    if (!open || itemKind !== "file" || !target?.id) {
      setFilePreview(null);
      setFilePreviewLoading(false);
      setFilePreviewError("");
      setDeleteJobStatus(null);
      return;
    }

    let cancelled = false;
    setFilePreview(null);
    setFilePreviewLoading(true);
    setFilePreviewError("");
    setDeleteJobStatus(null);

    void fetchFileDeletionPreview(target.id)
      .then((nextPreview) => {
        if (!cancelled) setFilePreview(nextPreview);
      })
      .catch((err) => {
        if (!cancelled) setFilePreviewError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setFilePreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, itemKind, target?.id]);

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
    if (!target || confirming) return;

    setConfirming(true);
    setConfirmMode(permanent ? "permanent" : "recycle");
    setError("");
    setDeleteJobStatus(null);

    try {
      if (target.kind === "file") {
        const useDeleteJob =
          permanent &&
          (filePreview
            ? shouldUseDeleteJob({
                file_count: 1,
                storage_object_count: filePreview.storage_object_count,
              })
            : false);

        if (useDeleteJob) {
          const finalStatus = await runDeleteJobWithProgress(
            [target.id],
            (status) => {
              setDeleteJobStatus(status);
            },
            { permanent: true },
          );

          if (finalStatus.status === "complete") {
            onDeleted?.(target);
            handleOpenChange(false);
          } else {
            setError(finalStatus.error ?? "Could not delete this file.");
          }
          return;
        }

        await deleteFile(target.id, { permanent });
      } else {
        const fileIds = folderPreview?.file_ids ?? [];
        const storageObjectCount = folderPreview?.storage_object_count ?? 0;
        const useDeleteJob =
          permanent &&
          fileIds.length > 0 &&
          shouldUseDeleteJob({
            file_count: fileIds.length,
            storage_object_count: storageObjectCount,
          });

        if (useDeleteJob) {
          const finalStatus = await runDeleteJobWithProgress(
            fileIds,
            (status) => {
              setDeleteJobStatus(status);
            },
            { permanent: true },
          );

          if (finalStatus.status !== "complete") {
            setError(finalStatus.error ?? "Could not delete this folder.");
            return;
          }
        }

        await deleteFolder(target.id, { permanent });
      }

      onDeleted?.(target);
      handleOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setConfirming(false);
      setConfirmMode(null);
    }
  }

  const showFilePreviewSummary =
    itemKind === "file" && filePreview && !filePreviewLoading && !filePreviewError;
  const previewBlocked =
    (itemKind === "file" && filePreviewLoading) ||
    (itemKind === "folder" && folderPreviewLoading);
  const showFolderPreviewSummary =
    itemKind === "folder" &&
    folderPreview &&
    !folderPreviewLoading &&
    !folderPreviewError &&
    folderPreview.storage_object_count > 0;
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

          {itemKind === "file" && filePreviewLoading ? <DeletePreviewLoading /> : null}
          {itemKind === "file" && filePreviewError ? (
            <div className="border-b border-neutral-100 px-6 py-4">
              <Alert variant="destructive">
                <AlertDescription className="break-words">{filePreviewError}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {showFilePreviewSummary ? (
            <DeletePreviewSummary
              storageObjectCount={filePreview.storage_object_count}
              fileCount={1}
            />
          ) : null}

          {itemKind === "folder" ? (
            <div className="border-b border-neutral-100 px-6 py-4">
              {folderPreviewLoading ? (
                <p className="text-sm text-neutral-500">Checking folder contents…</p>
              ) : folderPreviewError ? (
                <Alert variant="destructive">
                  <AlertDescription>{folderPreviewError}</AlertDescription>
                </Alert>
              ) : folderPreview ? (
                <>
                  <FolderContentsSummary preview={folderPreview} permanentOnly={permanentOnly} />
                  {showFolderPreviewSummary ? (
                    <DeletePreviewSummary
                      storageObjectCount={folderPreview.storage_object_count}
                      fileCount={folderPreview.file_count}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
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
                disabled={confirming || !target || previewBlocked}
                onClick={(event) => void handleSubmit(event, true)}
              >
                {confirming && confirmMode === "permanent" ? "Deleting…" : "Permanently"}
              </Button>
              {permanentOnly ? null : (
                <Button
                  type="button"
                  variant="default"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={confirming || !target || previewBlocked}
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

