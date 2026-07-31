// Human: Mobile table-of-contents bottom sheet — jump to any TOC entry from the compact control bar.
// Agent: READS tocEntries + currentHref; CALLS onSelectEntry; MIRRORS EpubReaderSettingsSheet overlay pattern.

import { X } from "lucide-react";
import type { EpubTocEntry } from "@/components/drive/epub/epub-preview-types";
import { isEpubTocEntryActive } from "@/lib/epub-navigation";
import { cn } from "@/lib/utils";

type EpubReaderTocSheetProps = {
  open: boolean;
  entries: EpubTocEntry[];
  currentHref: string | null;
  onClose: () => void;
  onSelectEntry: (entry: EpubTocEntry) => void;
};

export function EpubReaderTocSheet({
  open,
  entries,
  currentHref,
  onClose,
  onSelectEntry,
}: EpubReaderTocSheetProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[75%] flex-col rounded-t-2xl border-t border-border bg-background px-4 pb-6 pt-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Table of Contents</h2>
          <button type="button" aria-label="Close table of contents" onClick={onClose} className="text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No table of contents in this book.</p>
          ) : (
            entries.map((entry) => {
              const active = isEpubTocEntryActive(currentHref, entry.href);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(
                    "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition",
                    active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60",
                  )}
                  style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
                  onClick={() => onSelectEntry(entry)}
                >
                  {active ? <span className="h-5 w-0.5 shrink-0 rounded-full bg-brand" /> : null}
                  <span>{entry.label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
