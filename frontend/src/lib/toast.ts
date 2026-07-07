// Human: Thin wrapper around Sonner for consistent drive mutation feedback.
// Agent: EXPORTS toastSuccess/toastError; USED after rename/move/delete when dialogs close.

import { toast } from "sonner";

export function toastSuccess(message: string) {
  toast.success(message);
}

export function toastError(message: string) {
  toast.error(message);
}

export function toastInfo(message: string) {
  toast.info(message);
}
