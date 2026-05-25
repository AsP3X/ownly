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
  onDeleted?: (target: DeleteTarget) => void;
};

// Human: Render a readable summary of nested folder contents for the delete prompt.
// Agent: READS FolderDeletionPreview; RETURNS bullet list of file kinds and subfolder count.
function FolderContentsSummary({ preview }: { preview: FolderDeletionPreview }) {
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
      <p className="text-neutral-600">All of these will be permanently deleted.</p>
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
  onDeleted,
}: ConfirmDeleteDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [filePreview, setFilePreview] = useState<FileDeletionPreview | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState("");
  const [deleteJobStatus, setDeleteJobStatus] = useState<DeleteJobStatus | null>(null);

  const itemKind = target?.kind ?? "file";
  const itemName = target?.name ?? "";
  const title = itemKind === "folder" ? "Delete folder?" : "Delete file?";
  const description =
    itemKind === "folder"
      ? `“${itemName}” and all nested subfolders will be removed. Every file inside will also be deleted. This cannot be undone.`
      : `“${itemName}” will be permanently removed from your library. This cannot be undone.`;

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
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || confirming) return;

    setConfirming(true);
    setError("");
    setDeleteJobStatus(null);

    try {
      if (target.kind === "file") {
        const useDeleteJob = filePreview
          ? shouldUseDeleteJob({
              file_count: 1,
              storage_object_count: filePreview.storage_object_count,
            })
          : false;

        if (useDeleteJob) {
          const finalStatus = await runDeleteJobWithProgress([target.id], (status) => {
            setDeleteJobStatus(status);
          });

          if (finalStatus.status === "complete") {
            onDeleted?.(target);
            handleOpenChange(false);
          } else {
            setError(finalStatus.error ?? "Could not delete this file.");
          }
          return;
        }

        await deleteFile(target.id);
      } else {
        await deleteFolder(target.id);
      }

      onDeleted?.(target);
      handleOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  const showFilePreviewSummary =
    itemKind === "file" && filePreview && !filePreviewLoading && !filePreviewError;
  const showProgress = confirming && deleteJobStatus !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={confirming}>
      <DialogContent
        style={dialogWidthStyle}
        className="w-full gap-0 overflow-x-hidden border-neutral-200 bg-white p-0 sm:max-w-none"
      >
        <form className="min-w-0" onSubmit={(event) => void handleSubmit(event)}>
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
                <FolderContentsSummary preview={folderPreview} />
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

          <DialogFooter className="min-w-0 flex-row flex-wrap justify-end gap-2 border-neutral-100 bg-neutral-50/80">
            <Button
              type="button"
              variant="outline"
              disabled={confirming}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirming || !target || (itemKind === "file" && filePreviewLoading)}
            >
              {confirming ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
