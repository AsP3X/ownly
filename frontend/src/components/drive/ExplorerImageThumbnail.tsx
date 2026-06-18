// Human: Grid tile image preview — server grid JPEG when ready, worker resize fallback otherwise.
// Agent: USES useExplorerGridThumbnail; RELOADS on re-enter viewport via cache or queue.

import { ImageIcon } from "lucide-react";
import type { FileItem } from "@/api/client";
import { ExplorerThumbnailShimmer } from "@/components/drive/ExplorerThumbnailShimmer";
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
        <ExplorerThumbnailShimmer slotFill label={loading ? "Loading preview" : "Generating preview"} />
      )}
    </div>
  );
}
