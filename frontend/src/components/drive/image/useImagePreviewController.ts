// Human: Image lightbox state — blob cache, gallery navigation, and keyboard handlers.
// Agent: NNCAXACNN tiers — X current, A ±1 visible, C ±2 cached, N beyond; ABORTS outside window.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import type { ImagePreviewDialogProps } from "@/components/drive/image/image-preview-types";
import {
  buildGalleryLoadPlan,
  collectGalleryWindowFileIds,
  collectLeadingEdgeFileIds,
  isGalleryIndexInBlobWindow,
  orderGalleryLoadSequence,
  PREVIEW_BLOB_CACHE_RADIUS,
} from "@/components/drive/image/image-preview-preload";
import { preparePreviewDisplayBlob } from "@/components/drive/image/image-preview-display-resize";
import { formatBytes } from "@/lib/utils-app";

export type ImagePreviewAdjacentUrls = {
  previous: string | null;
  next: string | null;
};

export type ImagePreviewControllerViewModel = {
  file: FileItem | null;
  previousFile: FileItem | null;
  nextFile: FileItem | null;
  displayUrl: string | null;
  /** Human: Original pixel dimensions from the source file — recorded during mobile downscale. */
  getPreviewDimensions: (fileId: string | undefined) => { width: number; height: number } | null;
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

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
  previewDisplayMaxEdgePx = null,
}: ImagePreviewDialogProps): ImagePreviewControllerViewModel {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const previewDimensionsRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const [previewDimensionsRevision, setPreviewDimensionsRevision] = useState(0);
  const inFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const fetchAbortRef = useRef<Map<string, AbortController>>(new Map());
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

  const isFileInBlobCacheWindow = useCallback((fileId: string) => {
    const index = currentIndexRef.current;
    const gallery = imagesRef.current;
    if (index < 0) return false;

    const itemIndex = gallery.findIndex((item) => item.id === fileId);
    return isGalleryIndexInBlobWindow(itemIndex, index, PREVIEW_BLOB_CACHE_RADIUS);
  }, []);

  const abortFetchForFile = useCallback((fileId: string) => {
    const controller = fetchAbortRef.current.get(fileId);
    if (!controller) return;
    controller.abort();
    fetchAbortRef.current.delete(fileId);
    inFlightRef.current.delete(fileId);
  }, []);

  const abortAllFetches = useCallback(() => {
    for (const controller of fetchAbortRef.current.values()) {
      controller.abort();
    }
    fetchAbortRef.current.clear();
    inFlightRef.current.clear();
  }, []);

  // Human: Revoke blob URLs outside the rolling window and cancel their in-flight downloads.
  // Agent: READS urlCacheRef; ABORTS fetchAbortRef; REVOKES distant object URLs.
  const evictBlobCacheOutsideWindow = useCallback(
    (index: number, gallery: readonly FileItem[]) => {
      const keepIds = collectGalleryWindowFileIds(gallery, index, PREVIEW_BLOB_CACHE_RADIUS);

      for (const fileId of fetchAbortRef.current.keys()) {
        if (!keepIds.has(fileId)) abortFetchForFile(fileId);
      }

      for (const [fileId, url] of urlCacheRef.current.entries()) {
        if (keepIds.has(fileId)) continue;
        URL.revokeObjectURL(url);
        urlCacheRef.current.delete(fileId);
        previewDimensionsRef.current.delete(fileId);
      }
      setPreviewDimensionsRevision((value) => value + 1);
    },
    [abortFetchForFile],
  );

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

  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < images.length - 1;
  const previousFile = hasPrevious ? (images[currentIndex - 1] ?? null) : null;
  const nextFile = hasNext ? (images[currentIndex + 1] ?? null) : null;
  const showGalleryNav = images.length > 1;
  const positionLabel =
    currentIndex >= 0 && images.length > 1 ? `${currentIndex + 1} of ${images.length}` : null;

  const rememberPreviewDimensions = useCallback((fileId: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    const existing = previewDimensionsRef.current.get(fileId);
    if (existing?.width === width && existing.height === height) return;
    previewDimensionsRef.current.set(fileId, { width, height });
    setPreviewDimensionsRevision((value) => value + 1);
  }, []);

  const getPreviewDimensions = useCallback((fileId: string | undefined) => {
    if (!fileId) return null;
    return previewDimensionsRef.current.get(fileId) ?? null;
  }, [previewDimensionsRevision]);

  const cacheBlobUrl = useCallback(
    (fileId: string, blob: Blob, session: number) => {
      if (!isCacheSessionActive(session)) return null;
      if (!isFileInBlobCacheWindow(fileId)) return null;

      const existing = urlCacheRef.current.get(fileId);
      if (existing) return existing;

      const url = URL.createObjectURL(blob);
      urlCacheRef.current.set(fileId, url);
      return url;
    },
    [isCacheSessionActive, isFileInBlobCacheWindow],
  );

  const revokeAllCachedUrls = useCallback(() => {
    cacheSessionRef.current += 1;
    abortAllFetches();

    for (const url of urlCacheRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlCacheRef.current.clear();
    previewDimensionsRef.current.clear();
    setPreviewDimensionsRevision((value) => value + 1);
    activeFileIdRef.current = null;
    setDisplayUrl(null);
    setError("");
    setLoading(false);
    setAdjacentUrls({ previous: null, next: null });
  }, [abortAllFetches]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) revokeAllCachedUrls();
      onOpenChange(nextOpen);
    },
    [onOpenChange, revokeAllCachedUrls],
  );

  useEffect(() => {
    return () => {
      revokeAllCachedUrls();
    };
  }, [revokeAllCachedUrls]);

  const fetchPreviewBlob = useCallback(
    (item: FileItem, signal?: AbortSignal) =>
      shareToken
        ? fetchPublicShareBlobForPreview(shareToken, item.id, sharePassword, signal)
        : fetchFileBlobForPreview(item, signal),
    [shareToken, sharePassword],
  );

  // Human: Fetch, optionally downscale for mobile, then cache a display blob URL for carousel imgs.
  // Agent: CALLS preparePreviewDisplayBlob when previewDisplayMaxEdgePx set; STORES source dimensions for fit layout.
  const loadPreviewUrl = useCallback(
    async (item: FileItem, options?: { silent?: boolean }): Promise<string | null> => {
      const session = cacheSessionRef.current;
      const silent = options?.silent ?? false;
      const isActive = () => isCacheSessionActive(session);

      if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;

      const cachedUrl = urlCacheRef.current.get(item.id);
      if (cachedUrl) return cachedUrl;

      const existingRequest = inFlightRef.current.get(item.id);
      if (existingRequest) return existingRequest;

      const controller = new AbortController();
      fetchAbortRef.current.set(item.id, controller);

      const request = fetchPreviewBlob(item, controller.signal)
        .then(async (blob) => {
          if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;

          let displayBlob = blob;
          if (previewDisplayMaxEdgePx && previewDisplayMaxEdgePx > 0) {
            const prepared = await preparePreviewDisplayBlob(
              blob,
              previewDisplayMaxEdgePx,
              controller.signal,
            );
            if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;
            displayBlob = prepared.blob;
            rememberPreviewDimensions(item.id, prepared.naturalWidth, prepared.naturalHeight);
          }

          return cacheBlobUrl(item.id, displayBlob, session);
        })
        .catch((err) => {
          if (isAbortError(err)) return null;
          if (silent) return null;
          throw err;
        })
        .finally(() => {
          fetchAbortRef.current.delete(item.id);
          if (isCacheSessionActive(session)) {
            inFlightRef.current.delete(item.id);
          }
        });

      inFlightRef.current.set(item.id, request);
      return request;
    },
    [cacheBlobUrl, fetchPreviewBlob, isCacheSessionActive, isFileInBlobCacheWindow, previewDisplayMaxEdgePx, rememberPreviewDimensions],
  );

  // Human: Enforce NNCAXACNN — prefetch leading +1/+2 before evicting trailing C→N on each navigation.
  // Agent: LOADS X then forward A/C; EVICTS only after leading edge ready; then backward A/C.
  useEffect(() => {
    if (!open || !file?.id || currentIndex < 0) return;

    const session = cacheSessionRef.current;
    activeFileIdRef.current = file.id;
    const requestFileId = file.id;
    const loadPlan = buildGalleryLoadPlan(images, currentIndex);
    const loadSequence = orderGalleryLoadSequence(loadPlan);
    const leadingEdgeIds = collectLeadingEdgeFileIds(loadPlan);
    const [currentItem, ...prefetchItems] = loadSequence;

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

    const loadLeadingEdge = async () => {
      if (!currentItem) return;

      try {
        const url = await loadPreviewUrl(currentItem);
        if (cancelled || !isCacheSessionActive(session) || activeFileIdRef.current !== requestFileId) {
          return;
        }
        if (url) {
          setDisplayUrl(url);
          setError("");
        }
      } catch (err) {
        if (cancelled || !isCacheSessionActive(session) || activeFileIdRef.current !== requestFileId) {
          return;
        }
        setError(getErrorMessage(err));
      } finally {
        if (cancelled || !isCacheSessionActive(session) || activeFileIdRef.current !== requestFileId) {
          return;
        }
        setLoading(false);
        refreshAdjacentUrlsIfChanged();
      }

      await Promise.all(
        prefetchItems
          .filter((item) => leadingEdgeIds.has(item.id))
          .map((item) => loadPreviewUrl(item, { silent: true })),
      );
      if (cancelled || !isCacheSessionActive(session)) return;

      refreshAdjacentUrlsIfChanged();
      evictBlobCacheOutsideWindow(currentIndex, images);

      await Promise.all(
        prefetchItems
          .filter((item) => !leadingEdgeIds.has(item.id))
          .map((item) => loadPreviewUrl(item, { silent: true })),
      );
      if (cancelled || !isCacheSessionActive(session)) return;

      refreshAdjacentUrlsIfChanged();
    };

    void loadLeadingEdge();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    file,
    currentIndex,
    images,
    evictBlobCacheOutsideWindow,
    isCacheSessionActive,
    loadPreviewUrl,
    refreshAdjacentUrlsIfChanged,
  ]);

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
    previousFile,
    nextFile,
    displayUrl: resolvedDisplayUrl,
    getPreviewDimensions,
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
