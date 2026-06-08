// Human: AutoFilter dialog with text search and distinct-value checkboxes.
// Agent: EMITS ColumnFilterConfig; REPLACES window.prompt column filter flow.

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
import type { ColumnFilterConfig } from "@/lib/spreadsheet/filter-values";

type ExcelAutoFilterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  values: string[];
  initialFilter: ColumnFilterConfig;
  onApply: (filter: ColumnFilterConfig) => void;
  onClear: () => void;
};

export function ExcelAutoFilterDialog({
  open,
  onOpenChange,
  columnLabel,
  values,
  initialFilter,
  onApply,
  onClear,
}: ExcelAutoFilterDialogProps) {
  const [textQuery, setTextQuery] = useState(initialFilter.textQuery);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialFilter.selectedValues ?? values),
  );

  const visibleValues = useMemo(() => {
    const query = textQuery.trim().toLowerCase();
    if (!query) return values;
    return values.filter((value) => value.toLowerCase().includes(query));
  }, [textQuery, values]);

  const allVisibleChecked =
    visibleValues.length > 0 && visibleValues.every((value) => checked.has(value));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Filter — {columnLabel}</DialogTitle>
          <DialogDescription>Show rows where this column matches your selection.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="excel-filter-search">Search values</Label>
            <Input
              id="excel-filter-search"
              value={textQuery}
              onChange={(event) => setTextQuery(event.target.value)}
              placeholder="Type to narrow the list"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-[#666666]">
            <span>{visibleValues.length} value(s)</span>
            <button
              type="button"
              className="font-semibold text-[#2563EB] hover:underline"
              onClick={() => {
                setChecked((current) => {
                  const next = new Set(current);
                  if (allVisibleChecked) {
                    visibleValues.forEach((value) => next.delete(value));
                  } else {
                    visibleValues.forEach((value) => next.add(value));
                  }
                  return next;
                });
              }}
            >
              {allVisibleChecked ? "Clear visible" : "Select visible"}
            </button>
          </div>

          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[#E5E7EB] p-2">
            {visibleValues.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-[#666666]">No matching values.</p>
            ) : (
              visibleValues.map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[#F7F8FA]"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(value)}
                    onChange={(event) => {
                      setChecked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(value);
                        else next.delete(value);
                        return next;
                      });
                    }}
                  />
                  <span className="truncate">{value}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClear();
              onOpenChange(false);
            }}
          >
            Clear Filter
          </Button>
          <Button
            type="button"
            onClick={() => {
              const selectedValues = checked.size === values.length ? null : new Set(checked);
              onApply({ textQuery, selectedValues });
              onOpenChange(false);
            }}
          >
            Apply Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
