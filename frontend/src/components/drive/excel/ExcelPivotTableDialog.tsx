// Human: PivotTable dialog — pick group/value columns and aggregation from the selection.
// Agent: PREVIEWS computePivotSummary; EMITS insert callback to write a new sheet.

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
import { Label } from "@/components/ui/label";
import { columnIndexToLetters } from "@/lib/spreadsheet/cells";
import {
  columnIndicesInRange,
  computePivotSummary,
  type PivotAggregation,
} from "@/lib/spreadsheet/pivot-summary";
import type { CellRange } from "@/lib/spreadsheet/selection";
import type { SheetData } from "@/lib/spreadsheet/types";

type ExcelPivotTableDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheet: SheetData;
  selectionRange: CellRange;
  onInsertSheet: (sheetName: string, result: ReturnType<typeof computePivotSummary>) => void;
};

const AGGREGATIONS: { id: PivotAggregation; label: string }[] = [
  { id: "sum", label: "Sum" },
  { id: "count", label: "Count" },
  { id: "average", label: "Average" },
  { id: "max", label: "Max" },
  { id: "min", label: "Min" },
];

export function ExcelPivotTableDialog({
  open,
  onOpenChange,
  sheet,
  selectionRange,
  onInsertSheet,
}: ExcelPivotTableDialogProps) {
  const columns = useMemo(() => columnIndicesInRange(selectionRange), [selectionRange]);
  const [rowFieldCol, setRowFieldCol] = useState(columns[0] ?? 0);
  const [valueFieldCol, setValueFieldCol] = useState(columns[columns.length - 1] ?? 0);
  const [aggregation, setAggregation] = useState<PivotAggregation>("sum");

  const preview = useMemo(
    () => computePivotSummary(sheet, selectionRange, rowFieldCol, valueFieldCol, aggregation),
    [aggregation, rowFieldCol, selectionRange, sheet, valueFieldCol],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PivotTable Summary</DialogTitle>
          <DialogDescription>
            Group rows by one column and aggregate another from the current selection.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pivot-row-field">Rows</Label>
            <select
              id="pivot-row-field"
              className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm"
              value={rowFieldCol}
              onChange={(event) => setRowFieldCol(Number.parseInt(event.target.value, 10))}
            >
              {columns.map((col) => (
                <option key={col} value={col}>
                  Column {columnIndexToLetters(col)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pivot-value-field">Values</Label>
            <select
              id="pivot-value-field"
              className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm"
              value={valueFieldCol}
              onChange={(event) => setValueFieldCol(Number.parseInt(event.target.value, 10))}
            >
              {columns.map((col) => (
                <option key={col} value={col}>
                  Column {columnIndexToLetters(col)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pivot-aggregation">Aggregate</Label>
            <select
              id="pivot-aggregation"
              className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm"
              value={aggregation}
              onChange={(event) => setAggregation(event.target.value as PivotAggregation)}
            >
              {AGGREGATIONS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="max-h-56 overflow-auto rounded-lg border border-[#E5E7EB]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#F3F4F6]">
                {preview.headers.map((header) => (
                  <th key={header} className="border-b border-[#E5E7EB] px-3 py-2 text-left font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-[#666666]">
                    No numeric values found for this pivot configuration.
                  </td>
                </tr>
              ) : (
                preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-white even:bg-[#FAFAFA]">
                    {row.map((cell, colIndex) => (
                      <td key={colIndex} className="border-b border-[#E5E7EB] px-3 py-2">
                        {cell.display}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={preview.rows.length === 0}
            onClick={() => {
              const name = window.prompt("New sheet name", "Pivot") ?? "Pivot";
              if (!name.trim()) return;
              onInsertSheet(name.trim(), preview);
              onOpenChange(false);
            }}
          >
            Insert to New Sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
