// Human: Review → Track Changes log — list cell edits recorded while tracking is on.
// Agent: READS TrackChangeEntry[]; EMITS clear / close.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TrackChangeEntry } from "@/lib/spreadsheet/types";

type ExcelTrackChangesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: TrackChangeEntry[];
  trackingEnabled: boolean;
  onClear: () => void;
};

export function ExcelTrackChangesDialog({
  open,
  onOpenChange,
  entries,
  trackingEnabled,
  onClear,
}: ExcelTrackChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Track Changes</DialogTitle>
          <DialogDescription>
            {trackingEnabled
              ? "Tracking is on. Cell edits are appended to this log."
              : "Tracking is off. Enable Track Changes on the Review tab to record edits."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-auto rounded-lg border border-edge">
          {entries.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">No changes recorded yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-sunken">
                  <th className="border-b border-edge px-2 py-1.5 text-left font-semibold">When</th>
                  <th className="border-b border-edge px-2 py-1.5 text-left font-semibold">Sheet</th>
                  <th className="border-b border-edge px-2 py-1.5 text-left font-semibold">Cell</th>
                  <th className="border-b border-edge px-2 py-1.5 text-left font-semibold">Before</th>
                  <th className="border-b border-edge px-2 py-1.5 text-left font-semibold">After</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((entry) => (
                  <tr key={entry.id} className="border-b border-[#F3F4F6]">
                    <td className="px-2 py-1.5 text-ink-muted">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">{entry.sheetName}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{entry.cell}</td>
                    <td className="max-w-[8rem] truncate px-2 py-1.5" title={entry.before}>
                      {entry.before || "∅"}
                    </td>
                    <td className="max-w-[8rem] truncate px-2 py-1.5" title={entry.after}>
                      {entry.after || "∅"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClear} disabled={entries.length === 0}>
            Clear log
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
