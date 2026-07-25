// Human: Confirm cancelling unfinished stream rebuilds so prior packages stay playable.
// Agent: CALLS onConfirm; parent runs cancelAllHlsReprocess and refreshes listings.

import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmDialogWidthStyle } from "@/lib/confirm-dialog-layout";

type ConfirmCancelRebuildsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirming?: boolean;
  onConfirm: () => void;
};

// Human: Warn that only unfinished rebuilds stop; finished streams stay as rebuilt.
// Agent: READS confirming to disable actions; CALLS onConfirm when user proceeds.
export function ConfirmCancelRebuildsDialog({
  open,
  onOpenChange,
  confirming = false,
  onConfirm,
}: ConfirmCancelRebuildsDialogProps) {
  function handleOpenChange(next: boolean) {
    if (confirming && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden border-neutral-200 bg-white p-0"
        style={confirmDialogWidthStyle(["Cancel unfinished rebuilds?".length])}
      >
        <DialogHeader className="border-b border-neutral-100 px-6 py-5 pr-12">
          <div className="flex items-start gap-3">
            <Ban className="mt-0.5 size-5 shrink-0 text-rose-600" aria-hidden />
            <div className="min-w-0 space-y-1">
              <DialogTitle>Cancel unfinished rebuilds?</DialogTitle>
              <DialogDescription className="text-sm text-neutral-600">
                Queued and in-progress stream rebuilds will stop. Videos keep their previous
                playable package when one still exists. Rebuilds that already finished are not
                undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogFooter className="border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={confirming}
            onClick={() => handleOpenChange(false)}
          >
            Keep rebuilding
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? "Cancelling…" : "Cancel rebuilds"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
