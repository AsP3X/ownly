// Human: Confirmation before closing an editor with unsaved changes.
// Agent: REPLACES window.confirm, which browsers may suppress — losing the user's only warning.

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDiscardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human: File being closed — omitted when the whole editor is closing. */
  name?: string;
  onConfirm: () => void;
};

// Human: Ask before throwing away edits; Cancel is the safe default and keeps focus in the editor.
// Agent: CALLER runs the close on onConfirm; this dialog owns no editor state.
export function ConfirmDiscardDialog({
  open,
  onOpenChange,
  name,
  onConfirm,
}: ConfirmDiscardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-edge bg-panel p-0 sm:max-w-md">
        <DialogHeader className="min-w-0 border-b border-hairline px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg text-ink">
            <TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden />
            Discard unsaved changes?
          </DialogTitle>
          <DialogDescription className="break-words text-ink-muted">
            {name
              ? `“${name}” has changes that have not been saved. Closing it now loses them.`
              : "This editor has changes that have not been saved. Closing now loses them."}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-row justify-end gap-2 border-hairline bg-surface/80">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
