// Human: Grid tile image preview — server grid JPEG when ready, worker resize fallback otherwise.
// Agent: USES useExplorerGridThumbnail; RELOADS on re-enter viewport via cache or queue.

import { ImageIcon, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { useExplorerGridThumbnail } from "@/hooks/useExplorerGridThumbnail";
import {
  loadExplorerImageThumbnailBlob,
} from "@/lib/explorer-thumbnail-loader";
import { makeExplorerThumbnailCacheKey } from "@/lib/explorer-thumbnail-cache";
import { cn } from "@/lib/utils";

type ExplorerImageThumbnailProps = {
  file: FileItem;
  className?: string;
  /** Human: Fill a parent preview slot instead of owning the square aspect box. */
  slotFill?: boolean;
};

/** Human: Lazy-loaded grid image preview with server-side or client-side thumbnail sources. */
export function ExplorerImageThumbnail({
  file,
  className,
  slotFill = false,
}: ExplorerImageThumbnailProps) {
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
    loadBlob: loadExplorerImageThumbnailBlob,
  });

  const waitingForServerThumb =
    !file.image_thumbnail_ready &&
    (file.image_thumbnail_status === "queued" ||
      file.image_thumbnail_status === "processing");

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
      {showFailed ? (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-8 text-[#2563EB]" aria-hidden />
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
          {waitingForServerThumb ? (
            <span className="text-[10px] text-[#888888]">Generating preview…</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
