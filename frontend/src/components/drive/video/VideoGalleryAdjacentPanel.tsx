// Human: Off-screen gallery slide — poster frame while the user swipes between videos.
// Agent: FETCHES thumbnail blob when ready; RENDERS full-bleed cover like TikTok neighbor previews.

import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileThumbnailBlob } from "@/api/client";
import { cn } from "@/lib/utils";

type VideoGalleryAdjacentPanelProps = {
  file: FileItem | null;
  label: string;
};

// Human: Dimmed neighbor panel for vertical gallery track (previous / next slot).
// Agent: READS file.video_thumbnail_ready; REVOKES object URL on cleanup.
export function VideoGalleryAdjacentPanel({ file, label }: VideoGalleryAdjacentPanelProps) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file?.id || !file.video_thumbnail_ready) {
      setPosterUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void fetchFileThumbnailBlob(file.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPosterUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPosterUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.id, file?.video_thumbnail_ready]);

  return (
    <div
      className="relative size-full overflow-hidden bg-black"
      aria-hidden
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          className="size-full object-cover opacity-70"
          draggable={false}
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-black">
          <Film className="size-10 text-white/25" aria-hidden />
        </div>
      )}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-black/35",
          "bg-gradient-to-b from-black/20 via-transparent to-black/40",
        )}
      />
      {file ? (
        <p className="pointer-events-none absolute inset-x-4 bottom-8 truncate text-sm font-medium text-white/50">
          {label}
        </p>
      ) : null}
    </div>
  );
}
