// Human: Data validation dialog for list and numeric constraints on a column.
// Agent: EMITS DataValidationRule; WRITES via workbook-ops from parent dialog.

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
import {
  parseValidationListInput,
  type DataValidationRule,
} from "@/lib/spreadsheet/data-validation";

type ValidationScope = "column" | "cell";

type ExcelDataValidationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  cellLabel?: string;
  initialRule: DataValidationRule | null;
  onApply: (rule: DataValidationRule | null, scope: ValidationScope) => void;
};

export function ExcelDataValidationDialog({
  open,
  onOpenChange,
  columnLabel,
  cellLabel,
  initialRule,
  onApply,
}: ExcelDataValidationDialogProps) {
  const [type, setType] = useState<DataValidationRule["type"]>(initialRule?.type ?? "list");
  const [listInput, setListInput] = useState((initialRule?.values ?? []).join(", "));
  const [minInput, setMinInput] = useState(initialRule?.min !== undefined ? String(initialRule.min) : "");
  const [maxInput, setMaxInput] = useState(initialRule?.max !== undefined ? String(initialRule.max) : "");
  const [errorMessage, setErrorMessage] = useState(initialRule?.errorMessage ?? "");
  const [formulaInput, setFormulaInput] = useState(initialRule?.formula ?? "");
  const [scope, setScope] = useState<ValidationScope>("column");

  const buildRule = (): DataValidationRule | null => {
    if (type === "list") {
      const values = parseValidationListInput(listInput);
      if (values.length === 0) return null;
      return {
        type: "list",
        values,
        allowBlank: true,
        errorMessage: errorMessage.trim() || undefined,
      };
    }

    if (type === "custom") {
      const formula = formulaInput.trim();
      if (!formula) return null;
      return {
        type: "custom",
        formula,
        allowBlank: true,
        errorMessage: errorMessage.trim() || undefined,
      };
    }

    const min = minInput.trim() ? Number(minInput) : undefined;
    const max = maxInput.trim() ? Number(maxInput) : undefined;
    if (min === undefined && max === undefined) return null;

    return {
      type,
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
      allowBlank: true,
      errorMessage: errorMessage.trim() || undefined,
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Data Validation — {scope === "cell" && cellLabel ? cellLabel : columnLabel}
          </DialogTitle>
          <DialogDescription>
            Restrict values for this {scope === "cell" ? "cell" : "column"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="excel-validation-scope">Apply to</Label>
            <select
              id="excel-validation-scope"
              className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm"
              value={scope}
              onChange={(event) => setScope(event.target.value as ValidationScope)}
            >
              <option value="column">Entire column ({columnLabel})</option>
              <option value="cell">Active cell only{cellLabel ? ` (${cellLabel})` : ""}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="excel-validation-type">Allow</Label>
            <select
              id="excel-validation-type"
              className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value as DataValidationRule["type"])}
            >
              <option value="list">List</option>
              <option value="whole">Whole number</option>
              <option value="decimal">Decimal</option>
              <option value="date">Date</option>
              <option value="textLength">Text length</option>
              <option value="custom">Custom formula</option>
            </select>
          </div>

          {type === "list" ? (
            <div className="space-y-1.5">
              <Label htmlFor="excel-validation-list">Source (comma-separated)</Label>
              <Input
                id="excel-validation-list"
                value={listInput}
                onChange={(event) => setListInput(event.target.value)}
                placeholder="Yes, No, Maybe"
              />
            </div>
          ) : type === "custom" ? (
            <div className="space-y-1.5">
              <Label htmlFor="excel-validation-formula">Formula</Label>
              <Input
                id="excel-validation-formula"
                value={formulaInput}
                onChange={(event) => setFormulaInput(event.target.value)}
                placeholder=">0"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="excel-validation-min">Minimum</Label>
                <Input
                  id="excel-validation-min"
                  value={minInput}
                  onChange={(event) => setMinInput(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="excel-validation-max">Maximum</Label>
                <Input
                  id="excel-validation-max"
                  value={maxInput}
                  onChange={(event) => setMaxInput(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="excel-validation-error">Error message (optional)</Label>
            <Input
              id="excel-validation-error"
              value={errorMessage}
              onChange={(event) => setErrorMessage(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onApply(null, scope);
              onOpenChange(false);
            }}
          >
            Remove Rule
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(buildRule(), scope);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
