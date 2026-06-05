// Human: Grid tile image preview — server grid JPEG when ready, worker resize fallback otherwise.
// Agent: USES explorer-thumbnail-loader + LRU cache; CANCELS loads when tile phase is off.

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  thumbnailPriorityForPhase,
  useExplorerTileVisible,
} from "@/hooks/useExplorerTileVisible";
import { loadExplorerImageThumbnailBlob } from "@/lib/explorer-thumbnail-loader";
import { cancelExplorerThumbnailLoad } from "@/lib/explorer-thumbnail-queue";
import { cn } from "@/lib/utils";

type ExplorerImageThumbnailProps = {
  file: FileItem;
  className?: string;
};

function revokeObjectUrl(objectUrlRef: { current: string | null }) {
  if (!objectUrlRef.current) return;
  URL.revokeObjectURL(objectUrlRef.current);
  objectUrlRef.current = null;
}

/** Human: Lazy-loaded grid image preview with server-side or client-side thumbnail sources. */
export function ExplorerImageThumbnail({ file, className }: ExplorerImageThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const phase = useExplorerTileVisible(containerRef);
  const priority = thumbnailPriorityForPhase(phase);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!priority) {
      return () => {
        cancelExplorerThumbnailLoad(file.id);
        revokeObjectUrl(objectUrlRef);
      };
    }

    const controller = new AbortController();
    revokeObjectUrl(objectUrlRef);

    void loadExplorerImageThumbnailBlob(file, {
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
  const loading = Boolean(priority) && !displaySrc && !failed;
  const waitingForServerThumb =
    !file.image_thumbnail_ready &&
    (file.image_thumbnail_status === "queued" ||
      file.image_thumbnail_status === "processing");

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[#F3F4F6]",
        "aspect-[4/3] contain-[layout_paint]",
        className,
      )}
    >
      {failed ? (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-8 text-[#2563EB]" aria-hidden />
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
