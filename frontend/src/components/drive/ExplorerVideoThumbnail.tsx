// Human: Grid tile video poster — server JPEG with priority queue, cache, and unload on scroll-away.
// Agent: USES useExplorerGridThumbnail; RE-TRIES poster load whenever tile re-enters viewport.

import { Film, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { useExplorerGridThumbnail } from "@/hooks/useExplorerGridThumbnail";
import {
  loadExplorerVideoThumbnailBlob,
} from "@/lib/explorer-thumbnail-loader";
import { makeExplorerThumbnailCacheKey } from "@/lib/explorer-thumbnail-cache";
import { cn } from "@/lib/utils";

type ExplorerVideoThumbnailProps = {
  file: FileItem;
  className?: string;
};

/** Human: Lazy-loaded poster preview for explorer video grid tiles. */
export function ExplorerVideoThumbnail({ file, className }: ExplorerVideoThumbnailProps) {
  const {
    containerRef,
    displaySrc,
    loading,
    showFailed,
    fetchPriority,
    handleImageError,
  } = useExplorerGridThumbnail({
    file,
    cacheKey: `${makeExplorerThumbnailCacheKey(file)}:video:${file.video_thumbnail_selected_index ?? 0}`,
    enabled: file.video_thumbnail_ready,
    loadBlob: loadExplorerVideoThumbnailBlob,
  });

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[#F3F4F6]",
        "aspect-[4/3] contain-[layout_paint]",
        className,
      )}
    >
      {showFailed || !file.video_thumbnail_ready ? (
        <div className="flex size-full items-center justify-center">
          <Film className="size-8 text-[#2563EB]" aria-hidden />
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
        <div className="flex size-full items-center justify-center">
          <Loader2
            className={cn("size-5 text-[#888888]", loading && "animate-spin")}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
