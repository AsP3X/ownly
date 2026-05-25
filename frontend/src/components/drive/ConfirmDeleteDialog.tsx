// Human: Confirmation modal before permanently deleting a file or folder from the drive.
// Agent: CALLS deleteFile/deleteFolder on submit; BLOCKS dismiss while confirming; NOTIFY onDeleted.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteFile, deleteFolder, getErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
  onDeleted?: (target: DeleteTarget) => void;
};

// Human: Ask the user to confirm before a destructive delete action proceeds.
// Agent: FORM submit runs API delete; PREVENTS close while confirming; CALLS onDeleted on success.
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  target,
  onDeleted,
}: ConfirmDeleteDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const itemKind = target?.kind ?? "file";
  const itemName = target?.name ?? "";
  const title = itemKind === "folder" ? "Delete folder?" : "Delete file?";
  const description =
    itemKind === "folder"
      ? `“${itemName}” and any subfolders will be removed. Files inside will move to the parent folder. This cannot be undone.`
      : `“${itemName}” will be permanently removed from your library. This cannot be undone.`;

  function handleOpenChange(next: boolean) {
    // Human: Ignore backdrop/Escape close while the delete request is in flight.
    // Agent: RETURNS early when confirming so parent open state stays true until done.
    if (!next && confirming) return;
    if (!next) setError("");
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || confirming) return;

    setConfirming(true);
    setError("");
    try {
      if (target.kind === "file") {
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={confirming}>
      <DialogContent className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="border-b border-neutral-100 px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-lg text-neutral-900">
              <Trash2 className="size-5 text-red-600" aria-hidden />
              {title}
            </DialogTitle>
            <DialogDescription className="text-neutral-500">{description}</DialogDescription>
          </DialogHeader>

          {error ? (
            <div className="px-6 pt-4">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <DialogFooter className="flex-row justify-end gap-2 border-neutral-100 bg-neutral-50/80">
            <Button
              type="button"
              variant="outline"
              disabled={confirming}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={confirming || !target}>
              {confirming ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
