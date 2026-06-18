// Human: Grid tile document preview — stored JPEG sidecar rendered like the opened file view.
// Agent: USES useExplorerGridThumbnail; DISPLAYS object-contain on white; READS document_thumbnail_ready.

import { FileSpreadsheet, FileText } from "lucide-react";
import type { FileItem } from "@/api/client";
import { ExplorerThumbnailShimmer } from "@/components/drive/ExplorerThumbnailShimmer";
import { useExplorerGridThumbnail } from "@/hooks/useExplorerGridThumbnail";
import { loadExplorerDocumentThumbnailBlob } from "@/lib/explorer-thumbnail-loader";
import { makeExplorerThumbnailCacheKey } from "@/lib/explorer-thumbnail-cache";
import { isPdfMime, isSpreadsheetPreviewMime } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type ExplorerDocumentThumbnailProps = {
  file: FileItem;
  className?: string;
  /** Human: Fill a parent preview slot instead of owning the square aspect box. */
  slotFill?: boolean;
};

/** Human: Lazy-loaded PDF/spreadsheet tile preview from object-storage JPEG sidecars. */
export function ExplorerDocumentThumbnail({
  file,
  className,
  slotFill = false,
}: ExplorerDocumentThumbnailProps) {
  const isPdf = isPdfMime(file.mime_type);
  const isSpreadsheet = isSpreadsheetPreviewMime(file.mime_type, file.name);

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

  const FailedIcon = isSpreadsheet ? FileSpreadsheet : FileText;
  const failedIconClass = isSpreadsheet ? "text-[#107C41]" : "text-[#2563EB]";

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden contain-[layout_paint]",
        slotFill
          ? "absolute inset-0 size-full rounded-none bg-transparent"
          : "relative aspect-square w-full rounded-lg bg-[#F3F4F6]",
        className,
      )}
    >
      {showFailed || (!file.document_thumbnail_ready && file.document_thumbnail_status === "failed") ? (
        <div className="flex size-full items-center justify-center">
          <FailedIcon className={cn("size-8", failedIconClass)} aria-hidden />
        </div>
      ) : displaySrc ? (
        isPdf ? (
          // Human: PDF tiles keep the full page visible with top-aligned letterboxing.
          // Agent: object-contain + items-start mirrors react-pdf explorer layout.
          <div className="flex size-full items-start justify-center overflow-hidden bg-white">
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
        ) : (
          // Human: Spreadsheet sidecars are square grid JPEGs — fill the tile edge-to-edge.
          // Agent: size-full object-cover; MATCHES ExplorerSpreadsheetThumbnail framing.
          <img
            src={displaySrc}
            alt=""
            decoding="async"
            draggable={false}
            fetchPriority={fetchPriority}
            className="size-full object-cover object-left-top bg-white"
            onError={handleImageError}
          />
        )
      ) : (
        <ExplorerThumbnailShimmer slotFill label={loading ? "Loading preview" : "Generating preview"} />
      )}
    </div>
  );
}
