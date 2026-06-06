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
};

function SpreadsheetThumbnailFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#F3F4F6]",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
    </div>
  );
}

/** Human: Explorer grid tile that loads the spreadsheet parser chunk only when an xlsx row renders. */
export function LazyExplorerSpreadsheetThumbnail({ file, className }: LazyExplorerSpreadsheetThumbnailProps) {
  return (
    <Suspense fallback={<SpreadsheetThumbnailFallback className={className} />}>
      <ExplorerSpreadsheetThumbnailLazy file={file} className={className} />
    </Suspense>
  );
}
