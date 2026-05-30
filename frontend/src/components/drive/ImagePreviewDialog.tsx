// Human: Folder-scoped image lightbox — Pencil Ownly Explorer Image Viewer over blurred backdrop.
// Agent: FETCHES fetchFileBlobForPreview; KEEPS prior slide visible while next loads; PRELOADS neighbors.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils-app";

type ImagePreviewDialogProps = {
  images: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
  /** When set, image bytes load through anonymous public share download. */
  shareToken?: string;
  sharePassword?: string | null;
  /** Human: Optional download action — shown in the bottom bar when provided. */
  onDownload?: (file: FileItem) => void;
  /** Human: Optional share action — hidden on anonymous public share views. */
  onShare?: (file: FileItem) => void;
};

export function ImagePreviewDialog({
  images,
  file,
  open,
  onOpenChange,
  onFileChange,
  shareToken,
  sharePassword,
  onDownload,
  onShare,
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

  const fetchPreviewBlob = useCallback(
    (item: FileItem) =>
      shareToken
        ? fetchPublicShareBlobForPreview(shareToken, item.id, sharePassword)
        : fetchFileBlobForPreview(item),
    [shareToken, sharePassword],
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

    void fetchPreviewBlob(file)
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
  }, [open, file, cacheBlobUrl, fetchPreviewBlob]);

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

      void fetchPreviewBlob(neighbor)
        .then((blob) => {
          cacheBlobUrl(neighborId, blob);
        })
        .catch(() => {
          // Human: Preload failures are silent — the active slide loader still handles errors.
        });
    }
  }, [open, currentIndex, images, cacheBlobUrl, fetchPreviewBlob]);

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
    currentIndex >= 0 && images.length > 1 ? `${currentIndex + 1} of ${images.length}` : null;

  const showInitialLoader = loading && !displayUrl;
  const showDownloadAction = Boolean(file && onDownload);
  const showShareAction = Boolean(file && onShare);

  const photoInfoLabel = file
    ? `${file.name} • ${formatBytes(file.size_bytes)}`
    : "Image preview";

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-1rem)] flex-col items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[960px]"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
        onKeyDown={handleContentKeyDown}
      >
        {/* Human: Screen-reader title — visible chrome lives inside the lightbox card per Pencil. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Image preview"}</DialogTitle>
          <DialogDescription>
            {positionLabel
              ? `${photoInfoLabel}. ${positionLabel} in this folder. Use arrow keys or side buttons to browse.`
              : `${photoInfoLabel}. Browse images in this folder with arrow keys or the navigation buttons.`}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={viewportRef}
          tabIndex={-1}
          className="flex w-full items-center justify-center gap-3 outline-none sm:gap-4"
          aria-label="Image gallery"
        >
          {/* Human: Previous slide — circular glass control flanking the lightbox card. */}
          <button
            type="button"
            disabled={!hasPrevious}
            onClick={goPrevious}
            aria-label="Previous image"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30 sm:size-[50px]",
            )}
          >
            <ChevronLeft className="size-5 sm:size-6" aria-hidden />
          </button>

          {/* Human: Lightbox card — dark frame, image fill, close + bottom metadata bar. */}
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#111118] shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
            <div className="relative flex min-h-[min(600px,70dvh)] w-full items-center justify-center">
              {error ? (
                <p className="px-6 text-center text-sm text-red-400" role="alert">
                  {error}
                </p>
              ) : null}

              {displayUrl ? (
                <img
                  src={displayUrl}
                  alt={file?.name ?? "Image preview"}
                  className="max-h-[min(600px,70dvh)] w-full object-contain"
                  draggable={false}
                />
              ) : null}

              {showInitialLoader ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#111118]">
                  <Loader2 className="size-7 animate-spin text-white/80" aria-hidden />
                  <span className="sr-only">Loading image…</span>
                </div>
              ) : null}

              {loading && displayUrl ? (
                <div
                  className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white"
                  aria-live="polite"
                >
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Loading…
                </div>
              ) : null}

              {/* Human: Close control — inset top-right on the image card. */}
              <DialogClose
                render={
                  <button
                    type="button"
                    className="absolute right-4 top-4 z-30 flex size-11 items-center justify-center rounded-[22px] border border-white/20 bg-black/60 text-white transition-colors hover:bg-black/80"
                    aria-label="Close image preview"
                  />
                }
              >
                <X className="size-[18px]" aria-hidden />
              </DialogClose>

              {/* Human: Translucent bottom bar — filename, size, and quick actions. */}
              {file ? (
                <div className="absolute inset-x-0 bottom-0 z-20 flex h-16 items-center justify-between bg-black/60 px-5">
                  <p className="min-w-0 truncate text-sm font-bold text-white">{photoInfoLabel}</p>

                  {(showDownloadAction || showShareAction) && (
                    <div className="flex shrink-0 items-center gap-4">
                      {showDownloadAction ? (
                        <button
                          type="button"
                          onClick={() => onDownload?.(file)}
                          className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                          aria-label={`Download ${file.name}`}
                        >
                          <Download className="size-4" aria-hidden />
                        </button>
                      ) : null}

                      {showShareAction ? (
                        <button
                          type="button"
                          onClick={() => onShare?.(file)}
                          className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                          aria-label={`Share ${file.name}`}
                        >
                          <Share2 className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Human: Next slide — circular glass control flanking the lightbox card. */}
          <button
            type="button"
            disabled={!hasNext}
            onClick={goNext}
            aria-label="Next image"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30 sm:size-[50px]",
            )}
          >
            <ChevronRight className="size-5 sm:size-6" aria-hidden />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
