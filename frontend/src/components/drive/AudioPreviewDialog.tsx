// Human: Folder-scoped audio preview — streams via presigned URL for incremental buffer segments.
// Agent: CALLS fetchFileStreamUrlForPreview; CACHES urls; REVOKES blob fallbacks on dialog close.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileStreamUrlForPreview, getErrorMessage } from "@/api/client";
import { LightAudioPlayer } from "@/components/drive/audio/LightAudioPlayer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AudioPreviewDialogProps = {
  tracks: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
};

type CachedStream = {
  url: string;
  revokeOnClose: boolean;
};

export function AudioPreviewDialog({
  tracks,
  file,
  open,
  onOpenChange,
  onFileChange,
}: AudioPreviewDialogProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const urlCacheRef = useRef<Map<string, CachedStream>>(new Map());
  const activeFileIdRef = useRef<string | null>(null);

  const currentIndex = useMemo(
    () => (file ? tracks.findIndex((item) => item.id === file.id) : -1),
    [file, tracks],
  );
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < tracks.length - 1;
  const positionLabel =
    currentIndex >= 0 && tracks.length > 0
      ? `${currentIndex + 1} of ${tracks.length}`
      : null;

  // Human: Store resolved stream URLs so revisiting a track in the gallery skips another API round-trip.
  // Agent: WRITES urlCacheRef; RETURNS cached entry when file id was already resolved.
  const cacheStream = useCallback((fileId: string, entry: CachedStream) => {
    const existing = urlCacheRef.current.get(fileId);
    if (existing) return existing;
    urlCacheRef.current.set(fileId, entry);
    return entry;
  }, []);

  // Human: Revoke blob fallback URLs when the dialog closes; HTTP presigned URLs need no revoke.
  // Agent: REVOKES object URLs in urlCacheRef when revokeOnClose; CLEARS player state.
  const clearCachedUrls = useCallback(() => {
    for (const entry of urlCacheRef.current.values()) {
      if (entry.revokeOnClose) {
        URL.revokeObjectURL(entry.url);
      }
    }
    urlCacheRef.current.clear();
    activeFileIdRef.current = null;
    setAudioUrl(null);
    setError("");
    setLoading(false);
    setAutoPlayNext(false);
  }, []);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) clearCachedUrls();
      onOpenChange(nextOpen);
    },
    [clearCachedUrls, onOpenChange],
  );

  // Human: Resolve a stream URL for the active track — presigned URLs buffer in smaller byte-range chunks.
  // Agent: READS urlCacheRef; CALLS fetchFileStreamUrlForPreview on miss; WRITES audioUrl when id matches.
  useEffect(() => {
    if (!open || !file?.id) return;

    activeFileIdRef.current = file.id;
    const requestFileId = file.id;

    const cached = urlCacheRef.current.get(requestFileId);
    if (cached) {
      setAudioUrl(cached.url);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    setAudioUrl(null);

    void fetchFileStreamUrlForPreview(file)
      .then((entry) => {
        if (cancelled) return;
        const stored = cacheStream(requestFileId, entry);
        if (activeFileIdRef.current !== requestFileId) return;
        setAudioUrl(stored.url);
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
  }, [open, file, cacheStream]);

  // Human: Warm neighbor stream URLs so arrow navigation only waits on playback buffer, not API latency.
  // Agent: CALLS fetchFileStreamUrlForPreview for uncached neighbors; WRITES urlCacheRef only.
  useEffect(() => {
    if (!open || currentIndex < 0) return;

    const neighborIds = [tracks[currentIndex - 1]?.id, tracks[currentIndex + 1]?.id].filter(
      (id): id is string => Boolean(id),
    );

    for (const neighborId of neighborIds) {
      if (urlCacheRef.current.has(neighborId)) continue;
      const neighbor = tracks.find((item) => item.id === neighborId);
      if (!neighbor) continue;

      void fetchFileStreamUrlForPreview(neighbor)
        .then((entry) => {
          cacheStream(neighborId, entry);
        })
        .catch(() => {
          // Human: Preload failures are silent — the active track loader still surfaces errors.
        });
    }
  }, [open, currentIndex, tracks, cacheStream]);

  const goPrevious = useCallback(() => {
    if (!hasPrevious) return;
    setAutoPlayNext(false);
    onFileChange(tracks[currentIndex - 1]!);
  }, [currentIndex, hasPrevious, onFileChange, tracks]);

  const goNext = useCallback(() => {
    if (!hasNext) return;
    setAutoPlayNext(true);
    onFileChange(tracks[currentIndex + 1]!);
  }, [currentIndex, hasNext, onFileChange, tracks]);

  const goPreviousRef = useRef(goPrevious);
  const goNextRef = useRef(goNext);

  useEffect(() => {
    goPreviousRef.current = goPrevious;
    goNextRef.current = goNext;
  }, [goPrevious, goNext]);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Human: Focus the player pane when opened so arrow keys reach gallery navigation first.
  // Agent: FOCUSES viewportRef after paint; RE-FOCUSES when the active track changes.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      viewportRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, file?.id]);

  // Human: Arrow keys move between tracks; capture phase runs before the dialog trap swallows them.
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

  // Human: Auto-advance to the next track in the folder gallery when playback ends.
  // Agent: CALLS goNext when hasNext; STOPS at last track otherwise.
  const handleTrackEnded = useCallback(() => {
    if (hasNext) {
      setAutoPlayNext(true);
      goNext();
    }
  }, [goNext, hasNext]);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="sm:max-w-md gap-0 p-0 overflow-hidden"
        onKeyDown={handleContentKeyDown}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle>Audio preview</DialogTitle>
          <DialogDescription>
            {file?.name ?? "Listen to audio files from your drive."}
            {positionLabel ? ` · ${positionLabel}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={viewportRef}
          tabIndex={-1}
          className={cn(
            "px-5 py-4 outline-none",
            tracks.length > 1 ? "pb-3" : "pb-5",
          )}
          aria-label="Audio player"
        >
          <LightAudioPlayer
            key={file?.id}
            src={audioUrl}
            title={file?.name ?? "Audio"}
            mimeType={file?.mime_type ?? null}
            loading={loading}
            error={error}
            autoPlay={autoPlayNext}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={goPrevious}
            onNext={goNext}
            onEnded={handleTrackEnded}
          />
        </div>

        {tracks.length > 1 ? (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goPrevious}
              disabled={!hasPrevious}
              aria-label="Previous track"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">{positionLabel}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goNext}
              disabled={!hasNext}
              aria-label="Next track"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
