// Human: Grid tile video poster for DriveCloudExplorer — lazy-loaded JPEG above file metadata.
// Agent: LAZY-FETCHES fetchFileThumbnailBlob when visible; REVOKES blob URLs on unmount; FALLBACK icon on error.

import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileThumbnailBlob } from "@/api/client";
import { useExplorerTileVisible } from "@/hooks/useExplorerTileVisible";
import { cn } from "@/lib/utils";

type ExplorerVideoThumbnailProps = {
  file: FileItem;
  className?: string;
};

/** Human: Lazy-loaded poster preview for explorer video grid tiles. */
export function ExplorerVideoThumbnail({ file, className }: ExplorerVideoThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const visible = useExplorerTileVisible(containerRef);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Human: Resolve a blob URL for the selected poster once the tile is visible.
  // Agent: CALLS fetchFileThumbnailBlob; REVOKES object URL on cleanup.
  useEffect(() => {
    if (!visible || !file.video_thumbnail_ready) return;

    let cancelled = false;
    setFailed(false);
    setSrc(null);

    void fetchFileThumbnailBlob(file.id)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [visible, file.id, file.video_thumbnail_ready, file.video_thumbnail_selected_index]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[#F3F4F6]",
        "aspect-[4/3]",
        className,
      )}
    >
      {failed || !file.video_thumbnail_ready ? (
        <div className="flex size-full items-center justify-center">
          <Film className="size-8 text-[#2563EB]" aria-hidden />
        </div>
      ) : src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
        </div>
      )}
    </div>
  );
}
