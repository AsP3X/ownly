// Human: Folder-scoped audio preview — desktop dialog or Pencil mobile bottom sheet over blurred explorer.
// Agent: CALLS fetchFileStreamUrlForPreview; CACHES urls; MOUNTS MobileAudioPlayerSheet below lg breakpoint.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileItem } from "@/api/client";
import {
  fetchFileStreamUrlForPreview,
  fetchFileWaveform,
  fetchPublicShareStreamUrlForPreview,
  fetchPublicShareWaveform,
  getErrorMessage,
} from "@/api/client";
import { LightAudioPlayer } from "@/components/drive/audio/LightAudioPlayer";
import { MobileAudioPlayerSheet } from "@/components/drive/audio/MobileAudioPlayerSheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";

export type AudioPreviewDialogProps = {
  tracks: FileItem[];
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (file: FileItem) => void;
  /** When set, audio streams through anonymous public share download URL. */
  shareToken?: string;
  sharePassword?: string | null;
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
  shareToken,
  sharePassword,
}: AudioPreviewDialogProps) {
  const isDesktop = useIsDesktopPlayer(open);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [waveformBars, setWaveformBars] = useState<number[] | null>(null);
  const urlCacheRef = useRef<Map<string, CachedStream>>(new Map());
  const activeFileIdRef = useRef<string | null>(null);

  const currentIndex = useMemo(
    () => (file ? tracks.findIndex((item) => item.id === file.id) : -1),
    [file, tracks],
  );
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < tracks.length - 1;
  const positionLabel =
    currentIndex >= 0 && tracks.length > 1
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

  // Human: Revoke blob fallback URLs when the dialog closes; ticket stream URLs need no revoke.
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
    setWaveformBars(null);
  }, []);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) clearCachedUrls();
      onOpenChange(nextOpen);
    },
    [clearCachedUrls, onOpenChange],
  );

  // Human: Load analyzed waveform peaks for the mobile bottom sheet once the file row is ready.
  // Agent: CALLS fetchFileWaveform or public share variant; SETS waveformBars for AudioWaveformBars.
  useEffect(() => {
    if (!open || !file?.id || isDesktop) {
      setWaveformBars(null);
      return;
    }
    if (!file.audio_waveform_ready) {
      setWaveformBars(null);
      return;
    }

    let cancelled = false;
    const loadWaveform = shareToken
      ? fetchPublicShareWaveform(shareToken, file.id, sharePassword)
      : fetchFileWaveform(file.id);

    void loadWaveform
      .then((artifact) => {
        if (!cancelled) setWaveformBars(artifact.bars);
      })
      .catch(() => {
        if (!cancelled) setWaveformBars(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file?.id, file?.audio_waveform_ready, isDesktop, shareToken, sharePassword]);

  const resolveStream = useCallback(
    (item: FileItem) =>
      shareToken
        ? fetchPublicShareStreamUrlForPreview(shareToken, item, sharePassword)
        : fetchFileStreamUrlForPreview(item),
    [shareToken, sharePassword],
  );

  // Human: Resolve a stream URL for the active track — ticket URLs stay on the app origin (no localhost:9000).
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

    void resolveStream(file)
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
  }, [open, file, cacheStream, resolveStream]);

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

      void resolveStream(neighbor)
        .then((entry) => {
          cacheStream(neighborId, entry);
        })
        .catch(() => {
          // Human: Preload failures are silent — the active track loader still surfaces errors.
        });
    }
  }, [open, currentIndex, tracks, cacheStream, resolveStream]);

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
    if (!open || !isDesktop) return;
    const timer = window.setTimeout(() => {
      viewportRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, file?.id, isDesktop]);

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

  const subtitleParts = [file?.name ?? "Listen to audio files from your drive."];
  if (positionLabel) subtitleParts.push(positionLabel);

  const playerProps = {
    src: audioUrl,
    title: file?.name ?? "Audio",
    mimeType: file?.mime_type ?? null,
    loading,
    error,
    autoPlay: autoPlayNext,
    hasPrevious,
    hasNext,
    onPrevious: goPrevious,
    onNext: goNext,
    onEnded: handleTrackEnded,
  };

  if (!isDesktop) {
    return (
      <MobileAudioPlayerSheet
        key={file?.id}
        open={open}
        onOpenChange={handleDialogOpenChange}
        positionLabel={positionLabel}
        waveformBars={waveformBars}
        {...playerProps}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="gap-5 overflow-visible border border-[#E5E7EB] bg-white p-8 pt-10 shadow-[0_12px_32px_rgba(0,0,0,0.08)] sm:max-w-[640px] rounded-3xl"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        onKeyDown={handleContentKeyDown}
      >
        {/* Human: Dialog header — title + filename subtitle per Pencil Audio Preview Dialog card. */}
        <DialogHeader className="gap-2 text-left">
          <DialogTitle className="text-xl font-bold leading-tight text-[#1A1A1A]">
            Audio preview
          </DialogTitle>
          <DialogDescription className="text-sm font-normal text-[#666666]">
            {subtitleParts.join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={viewportRef}
          tabIndex={-1}
          className="outline-none"
          aria-label="Audio player"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <LightAudioPlayer key={file?.id} variant="embedded" {...playerProps} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
