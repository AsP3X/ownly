// Human: Image lightbox state — blob cache, gallery navigation, and keyboard handlers.
// Agent: PRELOADS entire gallery on open; WARMS decoded bitmaps; REVOKES object URLs on close.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import type { ImagePreviewDialogProps } from "@/components/drive/image/image-preview-types";
import {
  clearWarmedPreviewImages,
  orderGalleryForPreload,
  preloadGalleryImages,
  warmPreviewImage,
} from "@/components/drive/image/image-preview-preload";
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
  const [cacheRevision, setCacheRevision] = useState(0);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
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
  const currentIndexRef = useRef(currentIndex);
  const imagesRef = useRef(images);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    imagesRef.current = images;
  }, [currentIndex, images]);

  const bumpCacheRevision = useCallback(() => {
    setCacheRevision((revision) => revision + 1);
  }, []);

  // Human: Avoid re-render storms during bulk preload — only notify React when prev/next URLs change.
  // Agent: READS urlCacheRef; COMPARES against adjacentUrls state; WRITES setAdjacentUrls + cacheRevision on change.
  const refreshAdjacentUrlsIfChanged = useCallback(() => {
    const index = currentIndexRef.current;
    const gallery = imagesRef.current;
    if (index < 0) {
      setAdjacentUrls((previous) =>
        previous.previous === null && previous.next === null
          ? previous
          : { previous: null, next: null },
      );
      return;
    }

    const nextPrevious =
      index > 0 ? urlCacheRef.current.get(gallery[index - 1]!.id) ?? null : null;
    const nextNext =
      index < gallery.length - 1
        ? urlCacheRef.current.get(gallery[index + 1]!.id) ?? null
        : null;

    setAdjacentUrls((previous) => {
      if (previous.previous === nextPrevious && previous.next === nextNext) {
        return previous;
      }
      bumpCacheRevision();
      return { previous: nextPrevious, next: nextNext };
    });
  }, [bumpCacheRevision]);

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
    inFlightRef.current.clear();
    clearWarmedPreviewImages();
    activeFileIdRef.current = null;
    setDisplayUrl(null);
    setError("");
    setLoading(false);
    setCacheRevision(0);
    setAdjacentUrls({ previous: null, next: null });
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

  // Human: Fetch, cache, and decode one preview — dedupes concurrent requests for the same file id.
  // Agent: READS urlCacheRef and inFlightRef; WRITES blob URL + warmPreviewImage; THROWS on active slide when silent is false.
  const loadPreviewUrl = useCallback(
    async (item: FileItem, options?: { warm?: boolean; silent?: boolean }): Promise<string | null> => {
      const warm = options?.warm ?? true;
      const silent = options?.silent ?? false;
      const cachedUrl = urlCacheRef.current.get(item.id);
      if (cachedUrl) {
        if (warm) {
          try {
            await warmPreviewImage(item.id, cachedUrl);
          } catch {
            // Human: Warm failures are non-fatal — the carousel img can still decode on mount.
          }
        }
        return cachedUrl;
      }

      const existingRequest = inFlightRef.current.get(item.id);
      if (existingRequest) {
        return existingRequest;
      }

      const request = fetchPreviewBlob(item)
        .then(async (blob) => {
          const url = cacheBlobUrl(item.id, blob);
          if (warm) {
            try {
              await warmPreviewImage(item.id, url);
            } catch {
              // Human: Warm failures are non-fatal — the carousel img can still decode on mount.
            }
          }
          return url;
        })
        .catch((err) => {
          if (silent) return null;
          throw err;
        })
        .finally(() => {
          inFlightRef.current.delete(item.id);
        });

      inFlightRef.current.set(item.id, request);
      return request;
    },
    [cacheBlobUrl, fetchPreviewBlob],
  );

  // Human: Load the active slide with user-visible errors while the gallery preloader runs in parallel.
  // Agent: UPDATES displayUrl + loading for file.id; WARMS adjacent slides after navigation.
  useEffect(() => {
    if (!open || !file?.id || currentIndex < 0) return;

    activeFileIdRef.current = file.id;
    const requestFileId = file.id;
    const prevItem = currentIndex > 0 ? images[currentIndex - 1]! : null;
    const nextItem = currentIndex < images.length - 1 ? images[currentIndex + 1]! : null;

    let cancelled = false;
    const cachedCurrent = urlCacheRef.current.get(requestFileId);
    if (cachedCurrent) {
      setDisplayUrl(cachedCurrent);
      setError("");
      setLoading(false);
    } else {
      setLoading(true);
      setError("");
    }

    refreshAdjacentUrlsIfChanged();

    void loadPreviewUrl(file)
      .then((url) => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        if (url) {
          setDisplayUrl(url);
          setError("");
        }
      })
      .catch((err) => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setLoading(false);
        refreshAdjacentUrlsIfChanged();
      });

    void Promise.all([
      prevItem ? loadPreviewUrl(prevItem, { silent: true, warm: true }) : Promise.resolve(null),
      nextItem ? loadPreviewUrl(nextItem, { silent: true, warm: true }) : Promise.resolve(null),
    ]).then(() => {
      if (cancelled) return;
      refreshAdjacentUrlsIfChanged();
    });

    return () => {
      cancelled = true;
    };
  }, [open, file, currentIndex, images, loadPreviewUrl, refreshAdjacentUrlsIfChanged]);

  // Human: Preload every gallery blob once per open; decode only slides near the active index to avoid UI freezes.
  // Agent: PARALLEL fetch via preloadGalleryImages; WARMS anchor ±2 only; SCHEDULES adjacent refresh without per-image re-render storms.
  useEffect(() => {
    if (!open || images.length === 0) return;

    const controller = new AbortController();
    const anchorIndex = currentIndexRef.current;
    const orderedImages = orderGalleryForPreload(images, anchorIndex);
    let cacheRefreshFrame = 0;

    const scheduleAdjacentRefresh = () => {
      if (cacheRefreshFrame !== 0) return;
      cacheRefreshFrame = window.requestAnimationFrame(() => {
        cacheRefreshFrame = 0;
        if (controller.signal.aborted) return;
        refreshAdjacentUrlsIfChanged();
      });
    };

    void preloadGalleryImages(
      orderedImages,
      async (item) => {
        const itemIndex = images.findIndex((entry) => entry.id === item.id);
        const distance =
          itemIndex >= 0 ? Math.abs(itemIndex - currentIndexRef.current) : Number.POSITIVE_INFINITY;
        await loadPreviewUrl(item, { silent: true, warm: distance <= 2 });
        if (controller.signal.aborted) return;
        scheduleAdjacentRefresh();
      },
      { concurrency: 3, signal: controller.signal },
    );

    return () => {
      controller.abort();
      if (cacheRefreshFrame !== 0) {
        window.cancelAnimationFrame(cacheRefreshFrame);
      }
    };
  }, [open, images, loadPreviewUrl, refreshAdjacentUrlsIfChanged]);

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
  }, [currentIndex, images, adjacentUrls, displayUrl, cacheRevision]);

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
