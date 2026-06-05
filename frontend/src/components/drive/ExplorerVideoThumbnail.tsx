// Human: Grid tile video poster for DriveCloudExplorer — lazy-loaded JPEG above file metadata.
// Agent: FETCHES poster blob, RESIZES when large, REVOKES object URL when tile leaves viewport.

import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileThumbnailBlob } from "@/api/client";
import { useExplorerTileVisible } from "@/hooks/useExplorerTileVisible";
import { runExplorerThumbnailLoad } from "@/lib/explorer-thumbnail-queue";
import { resizeImageBlobForGridTile } from "@/lib/explorer-thumbnail-resize";
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
  const visible = useExplorerTileVisible(containerRef);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Human: Load poster JPEG only while intersecting; revoke blob URL when tile scrolls away.
  // Agent: QUEUES fetch+resize; WRITES src in async callback; CLEANUP revokes object URL when hidden.
  useEffect(() => {
    if (!visible || !file.video_thumbnail_ready) {
      return () => {
        revokeObjectUrl(objectUrlRef);
        setSrc(null);
        setLoading(false);
      };
    }

    let cancelled = false;
    revokeObjectUrl(objectUrlRef);

    void runExplorerThumbnailLoad(async () => {
      if (cancelled) return;
      setLoading(true);
      setFailed(false);

      const blob = await fetchFileThumbnailBlob(file.id);
      const resized = await resizeImageBlobForGridTile(blob);
      if (cancelled) return;
      const url = URL.createObjectURL(resized);
      objectUrlRef.current = url;
      setSrc(url);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setFailed(true);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      revokeObjectUrl(objectUrlRef);
      setSrc(null);
      setLoading(false);
    };
  }, [visible, file.id, file.video_thumbnail_ready, file.video_thumbnail_selected_index]);

  const displaySrc = visible ? src : null;

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
          fetchPriority="low"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Loader2
            className={cn("size-5 text-[#888888]", visible && loading && "animate-spin")}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
