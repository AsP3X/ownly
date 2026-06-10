// Human: Grid tile document preview — server JPEG sidecar for PDF and spreadsheet explorer tiles.
// Agent: USES useExplorerGridThumbnail; READS document_thumbnail_ready; FALLBACK icon on error.

import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
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

/** Human: Lazy-loaded grid preview for PDF and spreadsheet tiles backed by object-storage JPEGs. */
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

  const waitingForServerThumb =
    !file.document_thumbnail_ready &&
    (file.document_thumbnail_status === "queued" ||
      file.document_thumbnail_status === "processing");

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
        <img
          src={displaySrc}
          alt=""
          decoding="async"
          draggable={false}
          fetchPriority={fetchPriority}
          className="size-full object-cover"
          onError={handleImageError}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1">
          <Loader2
            className={cn("size-5 text-[#888888]", loading && "animate-spin")}
            aria-hidden
          />
          {waitingForServerThumb || isPdf ? (
            <span className="text-[10px] text-[#888888]">Generating preview…</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
