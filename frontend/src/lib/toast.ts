// Human: Thin wrapper around Sonner for consistent drive mutation feedback.
// Agent: EXPORTS toastSuccess/toastError; USED after rename/move/delete when dialogs close.

import { toast } from "sonner";

/** Human: Optional inline button on a toast — carries Undo for reversible drive actions. */
export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastOptions = {
  action?: ToastAction;
  /** Human: Milliseconds the toast stays up; undoable actions need longer than the default. */
  duration?: number;
};

export function toastSuccess(message: string, options?: ToastOptions) {
  toast.success(message, options);
}

export function toastError(message: string) {
  toast.error(message);
}

export function toastInfo(message: string) {
  toast.info(message);
}
