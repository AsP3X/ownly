// Human: Post-registration confirmation — blocks the signup form until the user acknowledges success.
// Agent: CONTROLLED Dialog; CALLS onContinue when user chooses to sign in; READS pendingActivation for copy.

import { CircleCheck } from "lucide-react";
import "./auth-motion.css";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RegisterSuccessDialogProps = {
  open: boolean;
  pendingActivation: boolean;
  onContinue: () => void;
};

export function RegisterSuccessDialog({
  open,
  pendingActivation,
  onContinue,
}: RegisterSuccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
        className="gap-0 overflow-hidden rounded-2xl border-edge bg-panel p-0 sm:max-w-md"
      >
        <DialogHeader className="items-center gap-4 px-8 pt-8 text-center">
          <div className="auth-pop flex size-14 items-center justify-center rounded-full bg-ok-weak ring-8 ring-ok/10">
            <CircleCheck className="size-7 text-ok" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-2xl font-bold text-ink">
              Account created
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-ink-muted">
              {pendingActivation
                ? "Your account has been created. An administrator must approve it before you can sign in."
                : "Your account has been created. You can now sign in with your email and password."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogFooter className="mt-6 border-t border-hairline bg-sunken/60 px-8 py-5">
          <Button
            type="button"
            className="w-full bg-brand text-brand-on transition-transform duration-150 hover:bg-brand-hover active:scale-[0.98] sm:w-auto"
            onClick={onContinue}
          >
            Continue to sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
