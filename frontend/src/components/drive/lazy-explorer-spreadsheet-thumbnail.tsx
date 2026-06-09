// Human: Code-split wrapper for grid spreadsheet tiles — keeps SheetJS off the DrivePage initial chunk.
// Agent: LAZY-IMPORTS ExplorerSpreadsheetThumbnail; RENDERS Suspense fallback until xlsx chunk loads.

import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { cn } from "@/lib/utils";

const ExplorerSpreadsheetThumbnailLazy = lazy(() =>
  import("@/components/drive/ExplorerSpreadsheetThumbnail").then((module) => ({
    default: module.ExplorerSpreadsheetThumbnail,
  })),
);

type LazyExplorerSpreadsheetThumbnailProps = {
  file: FileItem;
  className?: string;
  /** Human: Fill a parent preview slot instead of owning the square aspect box. */
  slotFill?: boolean;
};

function SpreadsheetThumbnailFallback({
  className,
  slotFill = false,
}: {
  className?: string;
  slotFill?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden",
        slotFill
          ? "absolute inset-0 size-full rounded-none border-0 bg-transparent"
          : "relative aspect-square w-full rounded-lg border border-[#E5E7EB] bg-[#F3F4F6]",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
    </div>
  );
}

/** Human: Explorer grid tile that loads the spreadsheet parser chunk only when an xlsx row renders. */
export function LazyExplorerSpreadsheetThumbnail({
  file,
  className,
  slotFill = false,
}: LazyExplorerSpreadsheetThumbnailProps) {
  return (
    <Suspense fallback={<SpreadsheetThumbnailFallback className={className} slotFill={slotFill} />}>
      <ExplorerSpreadsheetThumbnailLazy file={file} className={className} slotFill={slotFill} />
    </Suspense>
  );
}
