// Human: Text to Columns wizard — split active column on a delimiter.
// Agent: EMITS delimiter to textToColumns workbook op.

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

type ExcelTextToColumnsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  onApply: (delimiter: string) => void;
};

export function ExcelTextToColumnsDialog({
  open,
  onOpenChange,
  columnLabel,
  onApply,
}: ExcelTextToColumnsDialogProps) {
  const [delimiter, setDelimiter] = useState(",");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Text to Columns</DialogTitle>
          <DialogDescription>Split column {columnLabel} into adjacent columns.</DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-sm">
          Delimiter
          <select
            className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value)}
          >
            <option value=",">Comma</option>
            <option value="	">Tab</option>
            <option value=";">Semicolon</option>
            <option value="|">Pipe</option>
            <option value=" ">Space</option>
          </select>
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => { onApply(delimiter); onOpenChange(false); }}>
            Finish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
