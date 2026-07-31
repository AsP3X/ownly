// Human: Grid tile document preview — stored JPEG sidecar rendered like the opened file view.
// Agent: USES useExplorerGridThumbnail; DISPLAYS object-contain on white; READS document_thumbnail_ready.

import { BookOpen, FileSpreadsheet, FileText } from "lucide-react";
import type { FileItem } from "@/api/client";
import { ExplorerThumbnailShimmer } from "@/components/drive/ExplorerThumbnailShimmer";
import { useExplorerGridThumbnail } from "@/hooks/useExplorerGridThumbnail";
import { loadExplorerDocumentThumbnailBlob } from "@/lib/explorer-thumbnail-loader";
import { makeExplorerThumbnailCacheKey } from "@/lib/explorer-thumbnail-cache";
import { isEpubMime, isSpreadsheetPreviewMime } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type ExplorerDocumentThumbnailProps = {
  file: FileItem;
  className?: string;
  /** Human: Fill a parent preview slot instead of owning the square aspect box. */
  slotFill?: boolean;
};

/** Human: Lazy-loaded PDF/spreadsheet/EPUB tile preview from object-storage JPEG sidecars. */
export function ExplorerDocumentThumbnail({
  file,
  className,
  slotFill = false,
}: ExplorerDocumentThumbnailProps) {
  const isSpreadsheet = isSpreadsheetPreviewMime(file.mime_type, file.name);
  const isEpub = isEpubMime(file.mime_type, file.name);

  const {
    containerRef,
    displaySrc,
    loading,
    showFailed,
    fetchPriority,
    handleImageError,
  } = useExplorerGridThumbnail({
    file,
    cacheKey: makeExplorerThumbnailCacheKey(file),
    enabled: file.document_thumbnail_ready === true,
    loadBlob: loadExplorerDocumentThumbnailBlob,
  });

  const FailedIcon = isSpreadsheet ? FileSpreadsheet : isEpub ? BookOpen : FileText;
  const failedIconClass = isSpreadsheet
    ? "text-[#107C41]"
    : isEpub
      ? "text-proc"
      : "text-brand";

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden contain-[layout_paint]",
        slotFill
          ? "absolute inset-0 size-full rounded-none bg-transparent"
          : "relative aspect-square w-full rounded-lg bg-sunken",
        className,
      )}
    >
      {showFailed || (!file.document_thumbnail_ready && file.document_thumbnail_status === "failed") ? (
        <div className="flex size-full items-center justify-center">
          <FailedIcon className={cn("size-8", failedIconClass)} aria-hidden />
        </div>
      ) : displaySrc ? (
        isSpreadsheet ? (
          // Human: Spreadsheet sidecars are square grid JPEGs — fill the tile edge-to-edge.
          // Agent: size-full object-cover; MATCHES ExplorerSpreadsheetThumbnail framing.
          <img
            src={displaySrc}
            alt=""
            decoding="async"
            draggable={false}
            fetchPriority={fetchPriority}
            className="dr-paper size-full object-cover object-left-top bg-white"
            onError={handleImageError}
          />
        ) : (
          // Human: PDF and EPUB covers keep portrait assets visible with centered letterboxing.
          // Agent: object-contain + items-center; EPUB cover JPEGs share the PDF tile framing.
          <div className="dr-paper flex size-full items-center justify-center overflow-hidden bg-white">
            <img
              src={displaySrc}
              alt=""
              decoding="async"
              draggable={false}
              fetchPriority={fetchPriority}
              className="max-h-full max-w-full object-contain"
              onError={handleImageError}
            />
          </div>
        )
      ) : (
        <ExplorerThumbnailShimmer slotFill label={loading ? "Loading preview" : "Generating preview"} />
      )}
    </div>
  );
}
