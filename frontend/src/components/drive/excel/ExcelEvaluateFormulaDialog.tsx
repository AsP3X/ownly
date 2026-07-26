// Human: Formulas → Evaluate Formula — show formula string and computed result for the active cell.
// Agent: READS formula + display; EMITS close only (read-only audit helper).

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ExcelEvaluateFormulaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cellLabel: string;
  formula: string | null;
  resultDisplay: string;
};

export function ExcelEvaluateFormulaDialog({
  open,
  onOpenChange,
  cellLabel,
  formula,
  resultDisplay,
}: ExcelEvaluateFormulaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Evaluate Formula — {cellLabel}</DialogTitle>
          <DialogDescription>
            Inspect the formula text and the value currently calculated for this cell.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <p className="font-semibold text-[#666666]">Formula</p>
            <pre className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 font-mono text-xs text-[#1A1A1A]">
              {formula?.trim() || "(no formula — constant value)"}
            </pre>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-[#666666]">Result</p>
            <p className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 font-mono text-[#1A1A1A]">
              {resultDisplay || "—"}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
