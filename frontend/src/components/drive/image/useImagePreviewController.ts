// Human: Image lightbox state — blob cache, gallery navigation, and keyboard handlers.
// Agent: PRELOADS gallery blobs under a session token; REVOKES URLs and WARMED bitmaps on close/unmount.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import type { ImagePreviewDialogProps } from "@/components/drive/image/image-preview-types";
import {
  clearWarmedPreviewImages,
  orderGalleryForPreload,
  preloadGalleryImages,
  retainWarmedPreviewImages,
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
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const cacheSessionRef = useRef(0);
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

  const isCacheSessionActive = useCallback(
    (session: number) => session === cacheSessionRef.current,
    [],
  );

  // Human: Only re-render carousel neighbors when prev/next blob URLs actually change.
  // Agent: READS urlCacheRef; COMPARES prior adjacentUrls; WRITES setAdjacentUrls when different.
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
      return { previous: nextPrevious, next: nextNext };
    });
  }, []);

  const retainWarmWindow = useCallback((index: number, gallery: readonly FileItem[]) => {
    if (index < 0) {
      retainWarmedPreviewImages([]);
      return;
    }

    const keepIds = [
      gallery[index]?.id,
      gallery[index - 1]?.id,
      gallery[index + 1]?.id,
    ].filter((id): id is string => Boolean(id));
    retainWarmedPreviewImages(keepIds);
  }, []);

  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < images.length - 1;
  const showGalleryNav = images.length > 1;
  const positionLabel =
    currentIndex >= 0 && images.length > 1 ? `${currentIndex + 1} of ${images.length}` : null;

  const cacheBlobUrl = useCallback((fileId: string, blob: Blob, session: number) => {
    if (!isCacheSessionActive(session)) return null;

    const existing = urlCacheRef.current.get(fileId);
    if (existing) return existing;

    const url = URL.createObjectURL(blob);
    urlCacheRef.current.set(fileId, url);
    return url;
  }, [isCacheSessionActive]);

  const revokeAllCachedUrls = useCallback(() => {
    cacheSessionRef.current += 1;

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
    setAdjacentUrls({ previous: null, next: null });
  }, []);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) revokeAllCachedUrls();
      onOpenChange(nextOpen);
    },
    [onOpenChange, revokeAllCachedUrls],
  );

  // Human: Parent unmounts the dialog without a close animation — still tear down blobs and warm bitmaps.
  // Agent: CALLS revokeAllCachedUrls on hook unmount; INVALIDATES in-flight session via cacheSessionRef.
  useEffect(() => {
    return () => {
      revokeAllCachedUrls();
    };
  }, [revokeAllCachedUrls]);

  const fetchPreviewBlob = useCallback(
    (item: FileItem) =>
      shareToken
        ? fetchPublicShareBlobForPreview(shareToken, item.id, sharePassword)
        : fetchFileBlobForPreview(item),
    [shareToken, sharePassword],
  );

  // Human: Fetch and optionally decode one preview — ignores results after session invalidation.
  // Agent: READS cacheSessionRef; DEDUPES inFlightRef; WRITES blob URL only for active session.
  const loadPreviewUrl = useCallback(
    async (item: FileItem, options?: { warm?: boolean; silent?: boolean }): Promise<string | null> => {
      const session = cacheSessionRef.current;
      const warm = options?.warm ?? true;
      const silent = options?.silent ?? false;
      const isActive = () => isCacheSessionActive(session);

      if (!isActive()) return null;

      const cachedUrl = urlCacheRef.current.get(item.id);
      if (cachedUrl) {
        if (warm) {
          try {
            await warmPreviewImage(item.id, cachedUrl, isActive);
          } catch {
            // Human: Warm failures are non-fatal — the carousel img can still decode on mount.
          }
        }
        return isActive() ? cachedUrl : null;
      }

      const existingRequest = inFlightRef.current.get(item.id);
      if (existingRequest) {
        return existingRequest;
      }

      const request = fetchPreviewBlob(item)
        .then(async (blob) => {
          if (!isActive()) return null;

          const url = cacheBlobUrl(item.id, blob, session);
          if (!url) return null;

          if (warm) {
            try {
              await warmPreviewImage(item.id, url, isActive);
            } catch {
              // Human: Warm failures are non-fatal — the carousel img can still decode on mount.
            }
          }

          return isActive() ? url : null;
        })
        .catch((err) => {
          if (silent) return null;
          throw err;
        })
        .finally(() => {
          if (isCacheSessionActive(session)) {
            inFlightRef.current.delete(item.id);
          }
        });

      inFlightRef.current.set(item.id, request);
      return request;
    },
    [cacheBlobUrl, fetchPreviewBlob, isCacheSessionActive],
  );

  // Human: Load the active slide with user-visible errors; warm and retain only the adjacent window.
  // Agent: UPDATES displayUrl; WARMS prev/current/next; PRUNES warmed bitmaps after navigation.
  useEffect(() => {
    if (!open || !file?.id || currentIndex < 0) return;

    const session = cacheSessionRef.current;
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
    retainWarmWindow(currentIndex, images);

    void loadPreviewUrl(file)
      .then((url) => {
        if (cancelled || !isCacheSessionActive(session) || activeFileIdRef.current !== requestFileId) {
          return;
        }
        if (url) {
          setDisplayUrl(url);
          setError("");
        }
      })
      .catch((err) => {
        if (cancelled || !isCacheSessionActive(session) || activeFileIdRef.current !== requestFileId) {
          return;
        }
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (cancelled || !isCacheSessionActive(session) || activeFileIdRef.current !== requestFileId) {
          return;
        }
        setLoading(false);
        refreshAdjacentUrlsIfChanged();
      });

    void Promise.all([
      prevItem ? loadPreviewUrl(prevItem, { silent: true, warm: true }) : Promise.resolve(null),
      nextItem ? loadPreviewUrl(nextItem, { silent: true, warm: true }) : Promise.resolve(null),
    ]).then(() => {
      if (cancelled || !isCacheSessionActive(session)) return;
      retainWarmWindow(currentIndexRef.current, imagesRef.current);
      refreshAdjacentUrlsIfChanged();
    });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    file,
    currentIndex,
    images,
    isCacheSessionActive,
    loadPreviewUrl,
    refreshAdjacentUrlsIfChanged,
    retainWarmWindow,
  ]);

  // Human: Background-fetch gallery blobs without decode; stop immediately when session ends.
  // Agent: PARALLEL preloadGalleryImages with warm:false; REFRESHES adjacent URLs via rAF batching.
  useEffect(() => {
    if (!open || images.length === 0) return;

    const session = cacheSessionRef.current;
    const anchorIndex = currentIndexRef.current;
    const orderedImages = orderGalleryForPreload(images, anchorIndex);
    let cacheRefreshFrame = 0;

    const scheduleAdjacentRefresh = () => {
      if (cacheRefreshFrame !== 0) return;
      cacheRefreshFrame = window.requestAnimationFrame(() => {
        cacheRefreshFrame = 0;
        if (!isCacheSessionActive(session)) return;
        refreshAdjacentUrlsIfChanged();
      });
    };

    void preloadGalleryImages(
      orderedImages,
      async (item) => {
        if (!isCacheSessionActive(session)) return;
        await loadPreviewUrl(item, { silent: true, warm: false });
        if (!isCacheSessionActive(session)) return;
        scheduleAdjacentRefresh();
      },
      {
        concurrency: 2,
        isActive: () => isCacheSessionActive(session),
      },
    );

    return () => {
      if (cacheRefreshFrame !== 0) {
        window.cancelAnimationFrame(cacheRefreshFrame);
      }
    };
  }, [open, images, isCacheSessionActive, loadPreviewUrl, refreshAdjacentUrlsIfChanged]);

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
