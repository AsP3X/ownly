// Human: Grid tile image preview for DriveCloudExplorer — cover-cropped thumbnail above file metadata.
// Agent: FETCHES blob, RESIZES for grid, REVOKES object URL when tile leaves viewport; FALLBACK icon on error.

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview } from "@/api/client";
import { useExplorerTileVisible } from "@/hooks/useExplorerTileVisible";
import { runExplorerThumbnailLoad } from "@/lib/explorer-thumbnail-queue";
import { resizeImageBlobForGridTile } from "@/lib/explorer-thumbnail-resize";
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

/** Human: Lazy-loaded, grid-sized image preview for explorer tiles. */
export function ExplorerImageThumbnail({ file, className }: ExplorerImageThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const visible = useExplorerTileVisible(containerRef);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Human: Load grid-sized bytes only while intersecting; revoke blob URL on leave or unmount.
  // Agent: QUEUES fetch+resize; WRITES src in async callback; CLEANUP revokes object URL when hidden.
  useEffect(() => {
    if (!visible) {
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

      const blob = await fetchFileBlobForPreview(file);
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
  }, [visible, file]);

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
