// Human: Formulas/Home Go To — jump to a cell address or named range.
// Agent: EMITS cell address or named-range bounds for selection.

import { useMemo, useState } from "react";
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
import { parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import type { NamedRange } from "@/lib/spreadsheet/named-ranges";
import type { CellAddress } from "@/lib/spreadsheet/types";

type ExcelGoToDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  namedRanges: NamedRange[];
  activeSheetName: string;
  onGoToCell: (address: CellAddress) => void;
  onGoToNamedRange: (range: NamedRange) => void;
};

export function ExcelGoToDialog({
  open,
  onOpenChange,
  namedRanges,
  activeSheetName,
  onGoToCell,
  onGoToNamedRange,
}: ExcelGoToDialogProps) {
  const [reference, setReference] = useState("");
  // Human: Prefer sheet-local named ranges first, then workbook-scoped ones.
  // Agent: SORTS namedRanges with active sheet matches first.
  const listedRanges = useMemo(() => {
    const sheet = activeSheetName.trim().toLowerCase();
    return [...namedRanges].sort((a, b) => {
      const aLocal = (a.sheetName ?? "").toLowerCase() === sheet ? 0 : 1;
      const bLocal = (b.sheetName ?? "").toLowerCase() === sheet ? 0 : 1;
      if (aLocal !== bLocal) return aLocal - bLocal;
      return a.name.localeCompare(b.name);
    });
  }, [namedRanges, activeSheetName]);

  const apply = () => {
    const trimmed = reference.trim();
    if (!trimmed) return;
    const named = namedRanges.find(
      (range) => range.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (named) {
      onGoToNamedRange(named);
      onOpenChange(false);
      return;
    }
    const address = parseCellAddressLabel(trimmed.replace(/^\$/, "").replace(/\$/g, ""));
    if (address) {
      onGoToCell(address);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Go To</DialogTitle>
          <DialogDescription>
            Enter a cell (e.g. B12) or pick a named range on this workbook.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="excel-goto-ref">Reference</Label>
            <Input
              id="excel-goto-ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply();
              }}
              placeholder="A1 or NamedRange"
              autoFocus
            />
          </div>

          {listedRanges.length > 0 ? (
            <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-[#E5E7EB] p-2">
              {listedRanges.map((range) => (
                <button
                  key={range.name}
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[#EFF6FF]"
                  onClick={() => {
                    setReference(range.name);
                    onGoToNamedRange(range);
                    onOpenChange(false);
                  }}
                >
                  <span className="font-medium text-[#1A1A1A]">{range.name}</span>
                  <span className="ml-2 text-xs text-[#888888]">
                    {range.sheetName}!{range.startRow + 1}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={apply}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
