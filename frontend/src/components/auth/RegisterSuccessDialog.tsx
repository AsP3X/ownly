// Human: Post-registration confirmation — blocks the signup form until the user acknowledges success.
// Agent: CONTROLLED Dialog; CALLS onContinue when user chooses to sign in; READS pendingActivation for copy.

import { CircleCheck } from "lucide-react";
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
        className="gap-0 overflow-hidden border-[#E5E7EB] p-0 sm:max-w-md"
      >
        <DialogHeader className="items-center gap-4 px-8 pt-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-[#EFF6FF]">
            <CircleCheck className="size-7 text-[#2563EB]" aria-hidden />
          </div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-2xl font-bold text-[#1A1A1A]">
              Account created
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-[#666666]">
              {pendingActivation
                ? "Your account has been created. An administrator must approve it before you can sign in."
                : "Your account has been created. You can now sign in with your email and password."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogFooter className="mt-6 border-t border-[#E5E7EB] bg-[#F9FAFB] px-8 py-5">
          <Button
            type="button"
            className="w-full bg-[#2563EB] text-white hover:bg-[#1D4ED8] sm:w-auto"
            onClick={onContinue}
          >
            Continue to sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
