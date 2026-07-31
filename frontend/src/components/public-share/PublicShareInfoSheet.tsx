// Human: Mobile bottom sheet for link/file metadata — Pencil Info Dialog mobile portrait.
// Agent: READS PublicShareInfo; OPENS via controlled open prop; RENDERS creator card in sheet.

import { X } from "lucide-react";
import type { PublicShareInfo } from "@/api/client";
import { PublicShareCreatorInfoCard } from "@/components/public-share/PublicShareCreatorInfoCard";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

type PublicShareInfoSheetProps = {
  overview: PublicShareInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PublicShareInfoSheet({ overview, open, onOpenChange }: PublicShareInfoSheetProps) {
  const title =
    overview.resource_type === "file" ? "File Information" : "Link Information";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        overlayClassName="bg-[#090D1A]/60 backdrop-blur-md"
        className="gap-5 rounded-t-3xl border-0 bg-panel px-5 pt-3 pb-10"
      >
        <div className="flex flex-col items-center pb-1">
          <div className="h-1 w-10 rounded-sm bg-edge" aria-hidden />
        </div>

        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="text-lg font-bold text-ink">{title}</SheetTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-ink transition-colors hover:bg-brand-weak"
            aria-label="Close information"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <SheetDescription className="sr-only">
          Details about who shared this link and when it expires.
        </SheetDescription>

        <PublicShareCreatorInfoCard overview={overview} className="p-5" />
      </SheetContent>
    </Sheet>
  );
}
