// Human: Code-split wrapper for grid PDF tiles — keeps react-pdf off the DrivePage initial chunk.
// Agent: LAZY-IMPORTS ExplorerPdfThumbnail; RENDERS Suspense fallback icon until pdf chunk loads.

import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { cn } from "@/lib/utils";

const ExplorerPdfThumbnailLazy = lazy(() =>
  import("@/components/drive/ExplorerPdfThumbnail").then((module) => ({
    default: module.ExplorerPdfThumbnail,
  })),
);

type LazyExplorerPdfThumbnailProps = {
  file: FileItem;
  className?: string;
};

function PdfThumbnailFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-[#F3F4F6]",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
    </div>
  );
}

/** Human: Explorer grid tile that loads the pdf.js chunk only when a PDF row is rendered. */
export function LazyExplorerPdfThumbnail({ file, className }: LazyExplorerPdfThumbnailProps) {
  return (
    <Suspense fallback={<PdfThumbnailFallback className={className} />}>
      <ExplorerPdfThumbnailLazy file={file} className={className} />
    </Suspense>
  );
}
