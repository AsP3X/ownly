// Human: Image lightbox state — blob cache, gallery navigation, and keyboard handlers.
// Agent: FETCHES preview blobs; REVOKES object URLs on close; WRITES view model for desktop/mobile surfaces.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import type { ImagePreviewDialogProps } from "@/components/drive/image/image-preview-types";
import { formatBytes } from "@/lib/utils-app";

export type ImagePreviewAdjacentUrls = {
  previous: string | null;
  next: string | null;
};

export type ImagePreviewControllerViewModel = {
  file: FileItem | null;
  displayUrl: string | null;
  error: string;
  loading: boolean;
  showInitialLoader: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  showGalleryNav: boolean;
  positionLabel: string | null;
  photoInfoLabel: string;
  sizeLabel: string;
  showDownloadAction: boolean;
  showShareAction: boolean;
  goPrevious: () => void;
  goNext: () => void;
  adjacentUrls: ImagePreviewAdjacentUrls;
  handleDialogOpenChange: (open: boolean) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
  handleContentKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function useImagePreviewController({
  images,
  file,
  open,
  onOpenChange,
  onFileChange,
  shareToken,
  sharePassword,
  onDownload,
  onShare,
}: ImagePreviewDialogProps): ImagePreviewControllerViewModel {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const activeFileIdRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [adjacentUrls, setAdjacentUrls] = useState<ImagePreviewAdjacentUrls>({
    previous: null,
    next: null,
  });

  const currentIndex = useMemo(
    () => (file ? images.findIndex((item) => item.id === file.id) : -1),
    [file, images],
  );

  const refreshAdjacentUrls = useCallback(() => {
    if (currentIndex < 0) {
      setAdjacentUrls({ previous: null, next: null });
      return;
    }

    setAdjacentUrls({
      previous:
        currentIndex > 0 ? urlCacheRef.current.get(images[currentIndex - 1]!.id) ?? null : null,
      next:
        currentIndex < images.length - 1
          ? urlCacheRef.current.get(images[currentIndex + 1]!.id) ?? null
          : null,
    });
  }, [currentIndex, images]);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < images.length - 1;
  const showGalleryNav = images.length > 1;
  const positionLabel =
    currentIndex >= 0 && images.length > 1 ? `${currentIndex + 1} of ${images.length}` : null;

  const cacheBlobUrl = useCallback((fileId: string, blob: Blob) => {
    const existing = urlCacheRef.current.get(fileId);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    urlCacheRef.current.set(fileId, url);
    return url;
  }, []);

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

  useEffect(() => {
    refreshAdjacentUrls();
  }, [refreshAdjacentUrls, displayUrl]);

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
          refreshAdjacentUrls();
        })
        .catch(() => {
          // Human: Preload failures are silent — the active slide loader still handles errors.
        });
    }
  }, [open, currentIndex, images, cacheBlobUrl, fetchPreviewBlob, refreshAdjacentUrls]);

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

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      viewportRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, file?.id]);

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

  const handleContentKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    },
    [goNext, goPrevious],
  );

  const showDownloadAction = Boolean(file && onDownload);
  const showShareAction = Boolean(file && onShare);
  const photoInfoLabel = file
    ? `${file.name} • ${formatBytes(file.size_bytes)}`
    : "Image preview";
  const sizeLabel = file ? formatBytes(file.size_bytes) : "";

  // Human: Resolve blob URLs from the in-memory cache during render so carousel commits stay in sync with file.
  // Agent: READS urlCacheRef by file.id and neighbor ids; RETURNS cached URL immediately after goNext/goPrevious.
  const resolvedDisplayUrl = file?.id
    ? (urlCacheRef.current.get(file.id) ?? displayUrl)
    : displayUrl;

  const resolvedAdjacentUrls = useMemo((): ImagePreviewAdjacentUrls => {
    if (currentIndex < 0) {
      return { previous: null, next: null };
    }

    return {
      previous:
        currentIndex > 0 ? urlCacheRef.current.get(images[currentIndex - 1]!.id) ?? null : null,
      next:
        currentIndex < images.length - 1
          ? urlCacheRef.current.get(images[currentIndex + 1]!.id) ?? null
          : null,
    };
  }, [currentIndex, images, adjacentUrls, displayUrl]);

  const resolvedShowInitialLoader = loading && !resolvedDisplayUrl;

  return {
    file,
    displayUrl: resolvedDisplayUrl,
    error,
    loading,
    showInitialLoader: resolvedShowInitialLoader,
    hasPrevious,
    hasNext,
    showGalleryNav,
    positionLabel,
    photoInfoLabel,
    sizeLabel,
    showDownloadAction,
    showShareAction,
    goPrevious,
    goNext,
    adjacentUrls: resolvedAdjacentUrls,
    handleDialogOpenChange,
    viewportRef,
    handleContentKeyDown,
  };
}
