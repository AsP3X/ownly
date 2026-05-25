// Human: Modal to name and create a folder in the current drive location.
// Agent: CALLS createFolder API; WRITES parent_id from current folder; CLOSES on success.

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { createFolder, getErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

type CreateFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolderId?: string | null;
  onFolderCreated?: () => void;
};

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentFolderId = null,
  onFolderCreated,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setName("");
      setError("");
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await createFolder({
        name: trimmed,
        parent_id: parentFolderId,
      });
      onFolderCreated?.();
      handleOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="border-b border-neutral-100 px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-lg text-neutral-900">
              <FolderPlus className="size-5 text-blue-600" aria-hidden />
              New folder
            </DialogTitle>
            <DialogDescription className="text-neutral-500">
              Create a folder to organize files in your library.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-6 py-5">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Folder name"
              aria-label="Folder name"
              disabled={submitting}
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 text-white hover:bg-blue-700"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
