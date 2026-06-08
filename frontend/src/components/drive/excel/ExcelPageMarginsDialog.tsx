// Human: Page margins dialog for Page Layout ribbon.
// Agent: EDITS PageMargins inches; EMITS apply callback on save.

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
import type { PageMargins } from "@/lib/spreadsheet/types";

type ExcelPageMarginsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMargins: PageMargins;
  onApply: (margins: PageMargins) => void;
};

const DEFAULT_MARGINS: PageMargins = {
  top: 0.75,
  bottom: 0.75,
  left: 0.7,
  right: 0.7,
  header: 0.3,
  footer: 0.3,
};

function marginField(
  label: string,
  id: string,
  value: number,
  onChange: (next: number) => void,
) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step={0.05}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
    </div>
  );
}

export function ExcelPageMarginsDialog({
  open,
  onOpenChange,
  initialMargins,
  onApply,
}: ExcelPageMarginsDialogProps) {
  const [margins, setMargins] = useState<PageMargins>(initialMargins);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setMargins(initialMargins);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Page Margins</DialogTitle>
          <DialogDescription>Set margins in inches for printing and PDF export.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {marginField("Top", "excel-margin-top", margins.top, (top) => setMargins((current) => ({ ...current, top })))}
          {marginField("Bottom", "excel-margin-bottom", margins.bottom, (bottom) =>
            setMargins((current) => ({ ...current, bottom })),
          )}
          {marginField("Left", "excel-margin-left", margins.left, (left) => setMargins((current) => ({ ...current, left })))}
          {marginField("Right", "excel-margin-right", margins.right, (right) =>
            setMargins((current) => ({ ...current, right })),
          )}
          {marginField("Header", "excel-margin-header", margins.header ?? DEFAULT_MARGINS.header!, (header) =>
            setMargins((current) => ({ ...current, header })),
          )}
          {marginField("Footer", "excel-margin-footer", margins.footer ?? DEFAULT_MARGINS.footer!, (footer) =>
            setMargins((current) => ({ ...current, footer })),
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setMargins(DEFAULT_MARGINS)}>
            Reset to Normal
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(margins);
                onOpenChange(false);
              }}
            >
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
