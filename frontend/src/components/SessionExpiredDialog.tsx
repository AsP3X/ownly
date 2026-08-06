// Human: Shown when the session ends while an editor still holds unsaved changes.
// Agent: KEEPS the drive mounted so the draft survives; OFFERS a download before signing in again.

import { Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UnsavedWorkItem } from "@/lib/unsaved-work";

type SessionExpiredDialogProps = {
  open: boolean;
  items: UnsavedWorkItem[];
  onSignIn: () => void;
};

// Human: Save one draft to the user's device — the server will not accept it without a session.
// Agent: OBJECT URL revoked on the next tick; the anchor click has already started the download.
function downloadSnapshot(item: UnsavedWorkItem) {
  const url = URL.createObjectURL(item.getSnapshot());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = item.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SessionExpiredDialog({ open, items, onSignIn }: SessionExpiredDialogProps) {
  return (
    // Human: Not dismissable — the session is gone, so there is nothing useful behind it but the draft.
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden border-edge bg-panel p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-hairline px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg text-ink">
            <TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />
            Your session expired
          </DialogTitle>
          <DialogDescription className="text-ink-muted">
            {items.length === 1
              ? "You have unsaved changes that cannot be saved until you sign in again."
              : "You have unsaved changes in several files that cannot be saved until you sign in again."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 px-6 py-5">
          <p className="text-[13px] text-ink-muted">
            Download a copy first if you do not want to risk losing this work — signing in again
            leaves this page.
          </p>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {item.name}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => downloadSnapshot(item)}
              >
                <Download className="size-3.5" aria-hidden />
                Download a copy
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-hairline bg-surface/80">
          <Button
            type="button"
            className="bg-brand text-brand-on hover:bg-brand-hover"
            onClick={onSignIn}
          >
            Sign in again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
