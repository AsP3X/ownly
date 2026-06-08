// Human: Name Manager dialog for workbook-level named ranges.
// Agent: LISTS namedRanges; EMITS add/remove callbacks from current selection.

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
import type { NamedRange } from "@/lib/spreadsheet/named-ranges";
import { columnIndexToLetters } from "@/lib/spreadsheet/cells";

type ExcelNamedRangeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ranges: NamedRange[];
  selectionLabel: string;
  onAddRange: (name: string) => void;
  onRemoveRange: (name: string) => void;
};

export function ExcelNamedRangeDialog({
  open,
  onOpenChange,
  ranges,
  selectionLabel,
  onAddRange,
  onRemoveRange,
}: ExcelNamedRangeDialogProps) {
  const [newName, setNewName] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Name Manager</DialogTitle>
          <DialogDescription>Create named ranges for formulas like =SUM(Sales).</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="excel-named-range-name">New name for {selectionLabel}</Label>
            <div className="flex gap-2">
              <Input
                id="excel-named-range-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Sales"
              />
              <Button
                type="button"
                onClick={() => {
                  if (!newName.trim()) return;
                  onAddRange(newName.trim());
                  setNewName("");
                }}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-[#E5E7EB]">
            {ranges.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[#666666]">No named ranges yet.</p>
            ) : (
              <ul className="divide-y divide-[#E5E7EB]">
                {ranges.map((range) => (
                  <li key={range.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1A1A1A]">{range.name}</p>
                      <p className="truncate text-[#666666]">
                        {range.sheetName}!{selectionLabelFromRange(range)}
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => onRemoveRange(range.name)}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function selectionLabelFromRange(range: NamedRange): string {
  const start = `${columnIndexToLetters(range.startCol)}${range.startRow + 1}`;
  const end = `${columnIndexToLetters(range.endCol)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}
