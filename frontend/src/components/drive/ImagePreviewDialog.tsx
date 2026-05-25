// Human: Folder-scoped image gallery — click an image to preview and arrow through siblings by filename.
// Agent: FETCHES fetchFileBlobForPreview; KEEPS prior slide visible while next loads; PRELOADS neighbors.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, getErrorMessage } from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ImagePreviewDialogProps = {
  images: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
};

export function ImagePreviewDialog({
  images,
  file,
  open,
  onOpenChange,
  onFileChange,
}: ImagePreviewDialogProps) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const activeFileIdRef = useRef<string | null>(null);

  const currentIndex = useMemo(
    () => (file ? images.findIndex((item) => item.id === file.id) : -1),
    [file, images],
  );
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < images.length - 1;

  // Human: Store a fetched blob URL in the session cache for instant revisits and preloads.
  // Agent: WRITES urlCacheRef; RETURNS existing url when file id was already loaded.
  const cacheBlobUrl = useCallback((fileId: string, blob: Blob) => {
    const existing = urlCacheRef.current.get(fileId);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    urlCacheRef.current.set(fileId, url);
    return url;
  }, []);

  // Human: Drop cached blob URLs when the dialog closes so memory is reclaimed.
  // Agent: REVOKES all entries in urlCacheRef; CLEARS preview state.
  const revokeAllCachedUrls = useCallback(() => {
    for (const url of urlCacheRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlCacheRef.current.clear();
    activeFileIdRef.current = null;
    setDisplayUrl(null);
    setError("");
    setLoading(false);
  }, []);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) revokeAllCachedUrls();
      onOpenChange(nextOpen);
    },
    [onOpenChange, revokeAllCachedUrls],
  );

  // Human: Resolve the active slide — swap instantly when cached, otherwise keep the prior image visible.
  // Agent: READS urlCacheRef; FETCHES on miss; WRITES displayUrl only when fetch matches activeFileIdRef.
  useEffect(() => {
    if (!open || !file?.id) return;

    activeFileIdRef.current = file.id;
    const requestFileId = file.id;

    const cached = urlCacheRef.current.get(requestFileId);
    if (cached) {
      setDisplayUrl(cached);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchFileBlobForPreview(file)
      .then((blob) => {
        if (cancelled) return;
        const url = cacheBlobUrl(requestFileId, blob);
        if (activeFileIdRef.current !== requestFileId) return;
        setDisplayUrl(url);
      })
      .catch((err) => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file, cacheBlobUrl]);

  // Human: Warm the previous and next slides so arrow navigation feels instant.
  // Agent: FETCHES uncached neighbors; WRITES urlCacheRef only (no displayUrl swap).
  useEffect(() => {
    if (!open || currentIndex < 0) return;

    const neighborIds = [images[currentIndex - 1]?.id, images[currentIndex + 1]?.id].filter(
      (id): id is string => Boolean(id),
    );

    for (const neighborId of neighborIds) {
      if (urlCacheRef.current.has(neighborId)) continue;
      const neighbor = images.find((item) => item.id === neighborId);
      if (!neighbor) continue;

      void fetchFileBlobForPreview(neighbor)
        .then((blob) => {
          cacheBlobUrl(neighborId, blob);
        })
        .catch(() => {
          // Human: Preload failures are silent — the active slide loader still handles errors.
        });
    }
  }, [open, currentIndex, images, cacheBlobUrl]);

  const goPrevious = useCallback(() => {
    if (!hasPrevious) return;
    onFileChange(images[currentIndex - 1]!);
  }, [currentIndex, hasPrevious, images, onFileChange]);

  const goNext = useCallback(() => {
    if (!hasNext) return;
    onFileChange(images[currentIndex + 1]!);
  }, [currentIndex, hasNext, images, onFileChange]);

  const goPreviousRef = useRef(goPrevious);
  const goNextRef = useRef(goNext);

  useEffect(() => {
    goPreviousRef.current = goPrevious;
    goNextRef.current = goNext;
  }, [goPrevious, goNext]);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Human: Focus the gallery pane when opened so arrow keys hit the dialog, not the drive behind it.
  // Agent: FOCUSES viewportRef after paint; RE-FOCUSES when the active image changes.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      viewportRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, file?.id]);

  // Human: Arrow keys move between images; capture phase runs before the dialog trap swallows them.
  // Agent: LISTENS document keydown capture while open; CALLS goPrevious/goNext via refs.
  useEffect(() => {
    if (!open) return;

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        goPreviousRef.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        goNextRef.current();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [open]);

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  };

  const positionLabel =
    currentIndex >= 0 && images.length > 0
      ? `${currentIndex + 1} of ${images.length}`
      : null;

  const showInitialLoader = loading && !displayUrl;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-2rem)] flex-col gap-3 overflow-hidden p-0 sm:max-w-5xl"
        onKeyDown={handleContentKeyDown}
      >
        <DialogHeader className="gap-1 border-b px-4 py-3 pr-12">
          <DialogTitle className="truncate">{file?.name ?? "Image preview"}</DialogTitle>
          <DialogDescription>
            {positionLabel
              ? `${positionLabel} in this folder — use arrow keys or buttons to browse.`
              : "Browse images in this folder with arrow keys or the navigation buttons."}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={viewportRef}
          tabIndex={-1}
          className="relative flex min-h-[50vh] items-center justify-center bg-neutral-950 px-14 py-6 outline-none"
        >
          {error ? (
            <p className="text-destructive px-4 text-center text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {displayUrl ? (
            <img
              src={displayUrl}
              alt={file?.name ?? "Image preview"}
              className="max-h-[70vh] max-w-full object-contain"
              draggable={false}
            />
          ) : null}

          {showInitialLoader ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950 text-sm text-white">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <span className="sr-only">Loading image…</span>
            </div>
          ) : null}

          {loading && displayUrl ? (
            <div
              className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white"
              aria-live="polite"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!hasPrevious}
            onClick={goPrevious}
            className={cn(
              "absolute left-2 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white",
              !hasPrevious && "opacity-30",
            )}
            aria-label="Previous image"
          >
            <ChevronLeft className="size-6" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!hasNext}
            onClick={goNext}
            className={cn(
              "absolute right-2 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white",
              !hasNext && "opacity-30",
            )}
            aria-label="Next image"
          >
            <ChevronRight className="size-6" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
