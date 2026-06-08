// Human: Insert Function wizard — browse Excel function catalog and build a formula.
// Agent: READS FORMULA_CATALOG; EMITS formula string to commitFormulaBar.

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
import { FORMULA_CATALOG, FORMULA_CATEGORIES } from "@/lib/spreadsheet/formula-catalog";

type ExcelInsertFunctionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (formula: string) => void;
};

export function ExcelInsertFunctionDialog({
  open,
  onOpenChange,
  onInsert,
}: ExcelInsertFunctionDialogProps) {
  const [category, setCategory] = useState(FORMULA_CATEGORIES[0] ?? "Math");
  const [selectedName, setSelectedName] = useState("SUM");
  const [args, setArgs] = useState("A1:A10");

  const entries = useMemo(
    () => FORMULA_CATALOG.filter((entry) => entry.category === category),
    [category],
  );
  const selected = FORMULA_CATALOG.find((entry) => entry.name === selectedName) ?? entries[0];

  const preview = selected ? `=${selected.name}(${args})` : "=";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Insert Function</DialogTitle>
          <DialogDescription>Select a function and enter arguments.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Category
            <select
              className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                const first = FORMULA_CATALOG.find((entry) => entry.category === event.target.value);
                if (first) setSelectedName(first.name);
              }}
            >
              {FORMULA_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Function
            <select
              className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
              value={selectedName}
              onChange={(event) => setSelectedName(event.target.value)}
            >
              {entries.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selected ? (
          <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] p-3 text-sm text-[#666666]">
            <p className="font-medium text-[#1A1A1A]">{selected.syntax}</p>
            <p className="mt-1">{selected.description}</p>
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          Arguments
          <input
            className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            placeholder="A1:A10"
          />
        </label>

        <p className="font-mono text-sm text-[#1A1A1A]">{preview}</p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onInsert(preview);
              onOpenChange(false);
            }}
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
