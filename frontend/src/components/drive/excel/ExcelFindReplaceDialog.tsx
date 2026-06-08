// Human: Find and replace dialog for spreadsheet search across the active sheet.
// Agent: EMITS find/replace callbacks; OPENS via Ctrl+F from editor hook.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ExcelFindReplaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFindNext: (query: string) => void;
  onReplace: (findText: string, replaceText: string) => void;
  onReplaceAll: (findText: string, replaceText: string) => void;
};

export function ExcelFindReplaceDialog({
  open,
  onOpenChange,
  onFindNext,
  onReplace,
  onReplaceAll,
}: ExcelFindReplaceDialogProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Find and Replace</DialogTitle>
          <DialogDescription>Search the active sheet. Replace updates matching cells.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="excel-find">Find</Label>
            <Input
              id="excel-find"
              value={findText}
              onChange={(event) => setFindText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onFindNext(findText);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="excel-replace">Replace with</Label>
            <Input
              id="excel-replace"
              value={replaceText}
              onChange={(event) => setReplaceText(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onFindNext(findText)}>
            Find Next
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onReplace(findText, replaceText)}>
              Replace
            </Button>
            <Button type="button" onClick={() => onReplaceAll(findText, replaceText)}>
              Replace All
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
