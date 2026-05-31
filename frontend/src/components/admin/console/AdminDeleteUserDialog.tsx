// Human: Confirm delete from user table trash icon (Pencil row actions — not inside edit dialog).
// Agent: CALLS deleteAdminUser; WRITES via onDeleted callback.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { deleteAdminUser, getErrorMessage, type AdminUserRow } from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminEditUserCleanupRow } from "@/components/admin/console/AdminEditUserDialogLayout";
import { userDisplayName } from "@/lib/utils-app";

/** Human: Delete confirmation — requires cleanup checkbox per edit-user wireframe copy. */
export function AdminDeleteUserDialog({
  user,
  open,
  onOpenChange,
  onDeleted,
}: {
  user: AdminUserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [cleanup, setCleanup] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteAdminUser(user!.id);
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(false);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-[480px] gap-0 rounded-2xl border border-[#E5E7EB] bg-white p-7 sm:max-w-[480px]"
        overlayClassName="bg-[#0F172A66]"
      >
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-lg font-semibold text-[#1A1A1A]">Delete user account</DialogTitle>
          <DialogDescription className="text-[13px] text-[#666666]">
            {userDisplayName(user.email)} • {user.email}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 flex flex-col gap-4">
          <AdminEditUserCleanupRow checked={cleanup} onCheckedChange={setCleanup} />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
            className="rounded-lg border border-[#E5E7EB] bg-white px-[18px] py-2.5 text-[13px] font-medium text-[#666666] hover:bg-[#F7F8FA] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting || !cleanup}
            className="inline-flex items-center gap-2 rounded-lg bg-[#DC2626] px-[18px] py-2.5 text-[13px] font-medium text-white hover:bg-[#B91C1C] disabled:opacity-60"
          >
            {deleting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Deleting…
              </>
            ) : confirming ? (
              "Confirm delete"
            ) : (
              "Delete user"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
