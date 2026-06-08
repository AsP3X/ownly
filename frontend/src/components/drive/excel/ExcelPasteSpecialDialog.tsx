// Human: Paste Special dialog — values, formats, transpose options.
// Agent: EMITS PasteMode + transpose flag to pasteClipboard handler.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PasteMode } from "@/lib/spreadsheet/clipboard";

export type PasteSpecialOptions = {
  mode: PasteMode;
  transpose: boolean;
};

type ExcelPasteSpecialDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaste: (options: PasteSpecialOptions) => void;
};

export function ExcelPasteSpecialDialog({
  open,
  onOpenChange,
  onPaste,
}: ExcelPasteSpecialDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paste Special</DialogTitle>
          <DialogDescription>Choose how clipboard contents are pasted.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Button type="button" variant="outline" className="justify-start" onClick={() => onPaste({ mode: "all", transpose: false })}>
            All
          </Button>
          <Button type="button" variant="outline" className="justify-start" onClick={() => onPaste({ mode: "values", transpose: false })}>
            Values only
          </Button>
          <Button type="button" variant="outline" className="justify-start" onClick={() => onPaste({ mode: "all", transpose: true })}>
            All — Transpose
          </Button>
          <Button type="button" variant="outline" className="justify-start" onClick={() => onPaste({ mode: "values", transpose: true })}>
            Values — Transpose
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
