// Human: Print preview dialog — shows print area with margin guides and isolated print action.
// Agent: READS buildPrintPreviewMatrix; CALLS printSpreadsheetElement on Print.

import { useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildPrintPreviewMatrix, printSpreadsheetElement } from "@/lib/spreadsheet/print-preview";
import type { PageMargins, SheetData } from "@/lib/spreadsheet/types";

type ExcelPrintPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheet: SheetData;
  sheetName: string;
  margins: PageMargins;
  showFormulas?: boolean;
};

export function ExcelPrintPreviewDialog({
  open,
  onOpenChange,
  sheet,
  sheetName,
  margins,
  showFormulas = false,
}: ExcelPrintPreviewDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const preview = useMemo(
    () => buildPrintPreviewMatrix(sheet, showFormulas),
    [sheet, showFormulas],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Print Preview — {sheetName}</DialogTitle>
          <DialogDescription>
            Margins: {margins.top}&quot; top, {margins.bottom}&quot; bottom, {margins.left}&quot; left,{" "}
            {margins.right}&quot; right.
          </DialogDescription>
        </DialogHeader>

        <div
          className="overflow-auto rounded-lg border border-[#E5E7EB] bg-[#E5E7EB] p-6"
          style={{
            maxHeight: "min(60vh, 480px)",
          }}
        >
          <div
            ref={printRef}
            className="mx-auto bg-white shadow-md"
            style={{
              padding: `${margins.top * 16}px ${margins.right * 16}px ${margins.bottom * 16}px ${margins.left * 16}px`,
              maxWidth: "100%",
            }}
          >
            <table className="w-full border-collapse text-xs text-[#1A1A1A]">
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => (
                      <td
                        key={colIndex}
                        className="border border-[#D1D5DB] px-2 py-1 align-top whitespace-pre-wrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!printRef.current) return;
              printSpreadsheetElement(printRef.current, margins);
            }}
          >
            Print / Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
