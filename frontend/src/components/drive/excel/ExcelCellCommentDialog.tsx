// Human: Cell comment editor dialog for spreadsheet notes.
// Agent: READS/WRITES comment text on active cell via parent callback.

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
import { Label } from "@/components/ui/label";

type ExcelCellCommentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cellLabel: string;
  initialComment: string;
  readOnly?: boolean;
  onSave: (comment: string) => void;
  onDelete: () => void;
};

export function ExcelCellCommentDialog({
  open,
  onOpenChange,
  cellLabel,
  initialComment,
  readOnly = false,
  onSave,
  onDelete,
}: ExcelCellCommentDialogProps) {
  const [comment, setComment] = useState(initialComment);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Comment — {cellLabel}</DialogTitle>
          <DialogDescription>Add a note to this cell. Comments are saved with the workbook.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="excel-cell-comment">Comment</Label>
          <textarea
            id="excel-cell-comment"
            value={comment}
            disabled={readOnly}
            onChange={(event) => setComment(event.target.value)}
            rows={5}
            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={readOnly}
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
          <Button
            type="button"
            disabled={readOnly}
            onClick={() => {
              onSave(comment.trim());
              onOpenChange(false);
            }}
          >
            Save Comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
