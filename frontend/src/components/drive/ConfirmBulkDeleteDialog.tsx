// Human: Confirmation modal before permanently deleting multiple files from the drive.
// Agent: CALLS deleteFile per id sequentially; REPORTS partial failures; NOTIFY onDeleted with successes.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteFile, getErrorMessage } from "@/api/client";
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

export type BulkDeleteItem = {
  id: string;
  name: string;
};

type ConfirmBulkDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BulkDeleteItem[];
  onDeleted?: (deletedIds: string[]) => void;
};

// Human: Ask the user to confirm before bulk destructive deletes proceed.
// Agent: FORM submit loops deleteFile; COLLECTS failures; CALLS onDeleted with successful ids only.
export function ConfirmBulkDeleteDialog({
  open,
  onOpenChange,
  items,
  onDeleted,
}: ConfirmBulkDeleteDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const count = items.length;
  const title = count === 1 ? "Delete file?" : `Delete ${count} files?`;
  const description =
    count === 1
      ? `“${items[0]?.name ?? ""}” will be permanently removed from your library. This cannot be undone.`
      : `${count} files will be permanently removed from your library. This cannot be undone.`;

  function handleOpenChange(next: boolean) {
    // Human: Ignore backdrop/Escape close while delete requests are in flight.
    // Agent: RETURNS early when confirming so parent open state stays true until done.
    if (!next && confirming) return;
    if (!next) setError("");
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (items.length === 0 || confirming) return;

    setConfirming(true);
    setError("");
    const deletedIds: string[] = [];
    const failures: string[] = [];

    for (const item of items) {
      try {
        await deleteFile(item.id);
        deletedIds.push(item.id);
      } catch (err) {
        failures.push(`${item.name}: ${getErrorMessage(err)}`);
      }
    }

    if (deletedIds.length > 0) {
      onDeleted?.(deletedIds);
    }

    if (failures.length === 0) {
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

    setConfirming(false);
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

          {count > 1 ? (
            <ul className="max-h-40 overflow-y-auto px-6 py-4 text-sm text-neutral-700">
              {items.map((item) => (
                <li key={item.id} className="truncate py-0.5">
                  {item.name}
                </li>
              ))}
            </ul>
          ) : null}

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
            <Button type="submit" variant="destructive" disabled={confirming || count === 0}>
              {confirming ? "Deleting…" : count === 1 ? "Delete" : `Delete ${count} files`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
