// Human: Page Setup dialog — orientation, scale, print titles, headers/footers.
// Agent: READS PageSetup; EMITS patch to setPageSetup workbook op.

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
import type { PageSetup } from "@/lib/spreadsheet/types";

type ExcelPageSetupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PageSetup | undefined;
  onApply: (setup: PageSetup) => void;
};

function PageSetupDialogBody({
  initial,
  onApply,
  onOpenChange,
}: {
  initial: PageSetup | undefined;
  onApply: (setup: PageSetup) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [setup, setSetup] = useState<PageSetup>(initial ?? {});

  return (
    <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Page Setup</DialogTitle>
          <DialogDescription>Orientation, scaling, and print titles.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Orientation
            <select
              className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
              value={setup.orientation ?? "portrait"}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  orientation: event.target.value as PageSetup["orientation"],
                }))
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Paper size
            <select
              className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
              value={setup.paperSize ?? "letter"}
              onChange={(event) =>
                setSetup((current) => ({
                  ...current,
                  paperSize: event.target.value as PageSetup["paperSize"],
                }))
              }
            >
              <option value="letter">Letter</option>
              <option value="a4">A4</option>
              <option value="legal">Legal</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Scale (%)
            <input
              type="number"
              min={10}
              max={400}
              className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
              value={setup.scalePercent ?? 100}
              onChange={(event) =>
                setSetup((current) => ({ ...current, scalePercent: Number(event.target.value) }))
              }
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Rows to repeat at top
            <input
              className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
              value={setup.printTitlesRows ?? ""}
              onChange={(event) =>
                setSetup((current) => ({ ...current, printTitlesRows: event.target.value }))
              }
              placeholder="1:1"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Header center
          <input
            className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
            value={setup.headerCenter ?? ""}
            onChange={(event) => setSetup((current) => ({ ...current, headerCenter: event.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Footer center
          <input
            className="rounded-lg border border-[#E5E7EB] px-2 py-1.5"
            value={setup.footerCenter ?? ""}
            onChange={(event) => setSetup((current) => ({ ...current, footerCenter: event.target.value }))}
          />
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => { onApply(setup); onOpenChange(false); }}>
            OK
          </Button>
        </DialogFooter>
    </DialogContent>
  );
}

export function ExcelPageSetupDialog({
  open,
  onOpenChange,
  initial,
  onApply,
}: ExcelPageSetupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PageSetupDialogBody
          key={JSON.stringify(initial ?? {})}
          initial={initial}
          onApply={onApply}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}
