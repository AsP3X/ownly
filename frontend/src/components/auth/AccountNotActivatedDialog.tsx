// Human: Blocks sign-in when an account exists but has not been activated by an administrator.
// Agent: CONTROLLED Dialog; Info icon TOGGLES inline explanation; CALLS onDismiss to close.

import { useState } from "react";
import { Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Human: Shared copy for why admin approval exists on this instance.
// Agent: READ by AccountNotActivatedDialog info panel; MATCHES setup "Require admin approval" intent.
export const ACCOUNT_ACTIVATION_EXPLANATION =
  "This instance can require administrator approval for new accounts. Until an admin activates your account, sign-in stays disabled to help prevent unauthorized access.";

type AccountNotActivatedDialogProps = {
  open: boolean;
  onDismiss: () => void;
};

export function AccountNotActivatedDialog({
  open,
  onDismiss,
}: AccountNotActivatedDialogProps) {
  const [showExplanation, setShowExplanation] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setShowExplanation(false);
          onDismiss();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
        className="gap-0 overflow-hidden border-[#E5E7EB] p-0 sm:max-w-md"
      >
        <DialogHeader className="items-center gap-4 px-8 pt-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-[#FFFBEB]">
            <ShieldAlert className="size-7 text-[#D97706]" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-2xl font-bold text-[#1A1A1A]">
              Account not activated
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-[#666666]">
              Contact an administrator to activate your account before signing in.
            </DialogDescription>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2563EB] hover:underline"
              aria-expanded={showExplanation}
              aria-controls="account-activation-explanation"
              onClick={() => setShowExplanation((current) => !current)}
            >
              <Info className="size-4 shrink-0" aria-hidden />
              Why is activation required?
            </button>
          </div>
        </DialogHeader>

        {showExplanation ? (
          <div
            id="account-activation-explanation"
            className="mx-8 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-left text-sm leading-relaxed text-[#666666]"
          >
            {ACCOUNT_ACTIVATION_EXPLANATION}
          </div>
        ) : null}

        <DialogFooter className="mt-6 border-t border-[#E5E7EB] bg-[#F9FAFB] px-8 py-5">
          <Button
            type="button"
            className="w-full bg-[#2563EB] text-white hover:bg-[#1D4ED8] sm:w-auto"
            onClick={() => {
              setShowExplanation(false);
              onDismiss();
            }}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
