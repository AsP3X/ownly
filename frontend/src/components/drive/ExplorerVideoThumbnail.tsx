// Human: Grid tile video poster — server JPEG with priority queue, cache, and unload on scroll-away.
// Agent: CALLS loadExplorerVideoThumbnailBlob; CANCELS when tile phase is off.

import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  thumbnailPriorityForPhase,
  useExplorerTileVisible,
} from "@/hooks/useExplorerTileVisible";
import { loadExplorerVideoThumbnailBlob } from "@/lib/explorer-thumbnail-loader";
import { cancelExplorerThumbnailLoad } from "@/lib/explorer-thumbnail-queue";
import { cn } from "@/lib/utils";

type ExplorerVideoThumbnailProps = {
  file: FileItem;
  className?: string;
};

function revokeObjectUrl(objectUrlRef: { current: string | null }) {
  if (!objectUrlRef.current) return;
  URL.revokeObjectURL(objectUrlRef.current);
  objectUrlRef.current = null;
}

/** Human: Lazy-loaded poster preview for explorer video grid tiles. */
export function ExplorerVideoThumbnail({ file, className }: ExplorerVideoThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const phase = useExplorerTileVisible(containerRef);
  const priority = thumbnailPriorityForPhase(phase);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!priority || !file.video_thumbnail_ready) {
      return () => {
        cancelExplorerThumbnailLoad(file.id);
        revokeObjectUrl(objectUrlRef);
      };
    }

    const controller = new AbortController();
    revokeObjectUrl(objectUrlRef);

    void loadExplorerVideoThumbnailBlob(file, {
      priority,
      signal: controller.signal,
    })
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSrc(url);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });

    return () => {
      controller.abort();
      cancelExplorerThumbnailLoad(file.id);
      revokeObjectUrl(objectUrlRef);
    };
  }, [file, priority]);

  const displaySrc = priority ? src : null;
  const loading = Boolean(priority) && !displaySrc && !failed && file.video_thumbnail_ready;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[#F3F4F6]",
        "aspect-[4/3] contain-[layout_paint]",
        className,
      )}
    >
      {failed || !file.video_thumbnail_ready ? (
        <div className="flex size-full items-center justify-center">
          <Film className="size-8 text-[#2563EB]" aria-hidden />
        </div>
      ) : displaySrc ? (
        <img
          src={displaySrc}
          alt=""
          decoding="async"
          draggable={false}
          fetchPriority={priority === "high" ? "high" : "low"}
          className="size-full object-cover"
          onError={() => setFailed(true)}
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
