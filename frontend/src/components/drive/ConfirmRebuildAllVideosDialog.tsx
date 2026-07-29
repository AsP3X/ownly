// Human: Confirm bulk rebuild of every ready video stream in the user's library.
// Agent: CALLS onConfirm; parent runs reprocessAllHls and refreshes listings.

import { RefreshCw } from "lucide-react";
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

type ConfirmRebuildAllVideosDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirming?: boolean;
  onConfirm: () => void;
};

// Human: Warn that playback pauses until each stream finishes rebuilding.
// Agent: READS confirming to disable actions; CALLS onConfirm when user proceeds.
export function ConfirmRebuildAllVideosDialog({
  open,
  onOpenChange,
  confirming = false,
  onConfirm,
}: ConfirmRebuildAllVideosDialogProps) {
  function handleOpenChange(next: boolean) {
    if (confirming && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden border-edge bg-panel p-0"
        style={confirmDialogWidthStyle(["Rebuild all video streams?".length])}
      >
        <DialogHeader className="border-b border-neutral-100 px-6 py-5 pr-12">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 size-5 shrink-0 text-sky-600" aria-hidden />
            <div className="min-w-0 space-y-1">
              <DialogTitle>Rebuild all video streams?</DialogTitle>
              <DialogDescription className="text-sm text-neutral-600">
                Only ready videos that have not already completed a successful rebuild will be
                re-packaged. Streams already rebuilt (and not broken) are skipped. Videos cannot be
                played until each rebuild finishes. Jobs run a few at a time — progress appears in
                the transfer tray and on file badges. Use “Rebuild this stream” on a single video if
                you need to repair one again.
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
            Cancel
          </Button>
          <Button type="button" disabled={confirming} onClick={onConfirm}>
            {confirming ? "Queueing…" : "Rebuild all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
