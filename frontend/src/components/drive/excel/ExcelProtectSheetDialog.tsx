// Human: Protect Sheet dialog — lock sheet with optional password.
// Agent: EMITS SheetProtection to setSheetProtection workbook op.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SheetProtection } from "@/lib/spreadsheet/types";

type ExcelProtectSheetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (protection: SheetProtection | null) => void;
  currentlyProtected: boolean;
};

export function ExcelProtectSheetDialog({
  open,
  onOpenChange,
  onApply,
  currentlyProtected,
}: ExcelProtectSheetDialogProps) {
  const [password, setPassword] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Protect Sheet</DialogTitle>
          <DialogDescription>
            {currentlyProtected
              ? "This sheet is protected. Remove protection or set a new password."
              : "Prevent edits until the sheet is unprotected."}
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-sm">
          Password (optional)
          <input
            type="password"
            className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <DialogFooter className="gap-2 sm:justify-between">
          {currentlyProtected ? (
            <Button type="button" variant="outline" onClick={() => { onApply(null); onOpenChange(false); }}>
              Unprotect
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply({ locked: true, password: password.trim() || undefined });
                onOpenChange(false);
              }}
            >
              Protect
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
