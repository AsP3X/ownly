// Human: Grid tile image preview for DriveCloudExplorer — cover-cropped thumbnail above file metadata.
// Agent: LAZY-FETCHES fetchFileStreamUrlForPreview when visible; REVOKES blob URLs on unmount; FALLBACK icon on error.

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileStreamUrlForPreview } from "@/api/client";
import { cn } from "@/lib/utils";

type ExplorerImageThumbnailProps = {
  file: FileItem;
  className?: string;
};

/** Human: Lazy-loaded image preview for explorer grid tiles. */
export function ExplorerImageThumbnail({ file, className }: ExplorerImageThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Human: Defer preview-url fetch until the tile nears the viewport — avoids N+1 calls for off-screen rows.
  // Agent: IntersectionObserver with rootMargin; WRITES visible true once; DISCONNECTS after first intersect.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Human: Resolve a stream or blob URL for the thumbnail once the tile is visible.
  // Agent: CALLS fetchFileStreamUrlForPreview; REVOKES blob object URLs on cleanup when revokeOnClose is true.
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setFailed(false);
    setSrc(null);

    void fetchFileStreamUrlForPreview(file)
      .then(({ url, revokeOnClose }) => {
        if (cancelled) {
          if (revokeOnClose) URL.revokeObjectURL(url);
          return;
        }
        if (revokeOnClose) objectUrlRef.current = url;
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
  }, [visible, file.id]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[#F3F4F6]",
        "aspect-[4/3]",
        className,
      )}
    >
      {failed ? (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-8 text-[#2563EB]" aria-hidden />
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
