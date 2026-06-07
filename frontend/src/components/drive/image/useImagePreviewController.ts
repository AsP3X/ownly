// Human: Image lightbox state — blob cache, gallery navigation, and keyboard handlers.
// Agent: NNCAXACNN tiers — X current, A ±1 visible, C ±2 cached, N beyond; ABORTS outside window.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import {
  fetchFileBlobForPreview,
  fetchFileGifAnimationPreviewUrl,
  fetchFileStreamUrlForPreview,
  fetchPublicShareBlobForPreview,
  fetchPublicShareGifAnimationPreviewUrl,
  getErrorMessage,
} from "@/api/client";
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
import {
  isGifPreviewFile,
  readImageNaturalDimensions,
  shouldUseGifCanvasPlayback,
} from "@/components/drive/image/image-preview-gif";
import { formatBytes } from "@/lib/utils-app";

export type ImagePreviewAdjacentUrls = {
  previous: string | null;
  next: string | null;
};

type CachedPreviewUrl = {
  url: string;
  revokeOnClose: boolean;
};

// Human: Only revoke object URLs — stream URLs are plain HTTP and must not go through revokeObjectURL.
// Agent: READS revokeOnClose + blob: prefix; CALLS URL.revokeObjectURL when appropriate.
function revokeCachedPreviewUrl(entry: CachedPreviewUrl) {
  if (entry.revokeOnClose && entry.url.startsWith("blob:")) {
    URL.revokeObjectURL(entry.url);
  }
}

export type ImagePreviewControllerViewModel = {
  file: FileItem | null;
  previousFile: FileItem | null;
  nextFile: FileItem | null;
  displayUrl: string | null;
  /** Human: Original pixel dimensions from the source file — recorded during mobile downscale. */
  getPreviewDimensions: (fileId: string | undefined) => { width: number; height: number } | null;
  /** Human: Raw GIF bytes for iOS canvas/video playback — avoids re-fetching stream URLs. */
  getPreviewGifBlob: (fileId: string | undefined) => Blob | null;
  /** Human: Ticket URL for preview-animation — fetched only when the slide is active. */
  resolveGifAnimationPreviewUrl: (
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<{ url: string; ready: boolean } | null>;
  /** Human: After first ffmpeg run, mark the MP4 sidecar cached for carousel revisits. */
  markGifAnimationPreviewCached: (fileId: string) => void;
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

// Human: fetch().blob() may omit type — re-wrap with the file row mime so GIF detection and object URLs stay correct.
// Agent: READS FileItem.mime_type; RETURNS new Blob only when type differs and mime is image/*.
function normalizePreviewBlob(blob: Blob, mimeType: string | null | undefined): Blob {
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (!mime.startsWith("image/") || blob.type === mime) {
    return blob;
  }
  return new Blob([blob], { type: mime });
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
  const urlCacheRef = useRef<Map<string, CachedPreviewUrl>>(new Map());
  const gifBlobCacheRef = useRef<Map<string, Blob>>(new Map());
  const animationUrlCacheRef = useRef<
    Map<string, { url: string; ready: boolean }>
  >(new Map());
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

      for (const [fileId, entry] of urlCacheRef.current.entries()) {
        if (keepIds.has(fileId)) continue;
        revokeCachedPreviewUrl(entry);
        urlCacheRef.current.delete(fileId);
        gifBlobCacheRef.current.delete(fileId);
        animationUrlCacheRef.current.delete(fileId);
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
      index > 0 ? urlCacheRef.current.get(gallery[index - 1]!.id)?.url ?? null : null;
    const nextNext =
      index < gallery.length - 1
        ? urlCacheRef.current.get(gallery[index + 1]!.id)?.url ?? null
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

  const cachePreviewUrl = useCallback(
    (fileId: string, url: string, revokeOnClose: boolean, session: number) => {
      if (!isCacheSessionActive(session)) return null;
      if (!isFileInBlobCacheWindow(fileId)) return null;

      const existing = urlCacheRef.current.get(fileId);
      if (existing) return existing.url;

      urlCacheRef.current.set(fileId, { url, revokeOnClose });
      return url;
    },
    [isCacheSessionActive, isFileInBlobCacheWindow],
  );

  const getPreviewGifBlob = useCallback((fileId: string | undefined) => {
    if (!fileId) return null;
    return gifBlobCacheRef.current.get(fileId) ?? null;
  }, []);

  // Human: Resolve preview-animation ticket URL without downloading the MP4 (no ffmpeg until video src loads).
  // Agent: READS animationUrlCacheRef; FETCHES preview-animation-url only when the active slide requests it.
  const resolveGifAnimationPreviewUrl = useCallback(
    async (
      fileId: string,
      signal?: AbortSignal,
    ): Promise<{ url: string; ready: boolean } | null> => {
      const cached = animationUrlCacheRef.current.get(fileId);
      if (cached) return cached;

      const item = imagesRef.current.find((entry) => entry.id === fileId);
      if (!item || !isGifPreviewFile(item)) return null;

      try {
        const animation = shareToken
          ? await fetchPublicShareGifAnimationPreviewUrl(
              shareToken,
              item,
              sharePassword,
            )
          : await fetchFileGifAnimationPreviewUrl(item);
        if (signal?.aborted) return null;
        const resolved = { url: animation.url, ready: animation.ready };
        animationUrlCacheRef.current.set(fileId, resolved);
        return resolved;
      } catch {
        return null;
      }
    },
    [sharePassword, shareToken],
  );

  const markGifAnimationPreviewCached = useCallback((fileId: string) => {
    const cached = animationUrlCacheRef.current.get(fileId);
    if (!cached || cached.ready) return;
    animationUrlCacheRef.current.set(fileId, { ...cached, ready: true });
  }, []);

  const cacheGifBlob = useCallback(
    (fileId: string, blob: Blob, session: number) => {
      if (!isCacheSessionActive(session)) return;
      if (!isFileInBlobCacheWindow(fileId)) return;
      gifBlobCacheRef.current.set(fileId, blob);
    },
    [isCacheSessionActive, isFileInBlobCacheWindow],
  );

  const cacheBlobUrl = useCallback(
    (fileId: string, blob: Blob, session: number) => {
      if (!isCacheSessionActive(session)) return null;
      if (!isFileInBlobCacheWindow(fileId)) return null;

      const existing = urlCacheRef.current.get(fileId);
      if (existing) return existing.url;

      const url = URL.createObjectURL(blob);
      urlCacheRef.current.set(fileId, { url, revokeOnClose: true });
      return url;
    },
    [isCacheSessionActive, isFileInBlobCacheWindow],
  );

  const revokeAllCachedUrls = useCallback(() => {
    cacheSessionRef.current += 1;
    abortAllFetches();

    for (const entry of urlCacheRef.current.values()) {
      revokeCachedPreviewUrl(entry);
    }
    urlCacheRef.current.clear();
    gifBlobCacheRef.current.clear();
    animationUrlCacheRef.current.clear();
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

  // Human: Fetch, optionally downscale for mobile, then cache a display URL for carousel imgs.
  // Agent: MOBILE GIFs use ticket stream URL (no canvas); other images CALL preparePreviewDisplayBlob.
  const loadPreviewUrl = useCallback(
    async (item: FileItem, options?: { silent?: boolean }): Promise<string | null> => {
      const session = cacheSessionRef.current;
      const silent = options?.silent ?? false;
      const isActive = () => isCacheSessionActive(session);
      const isMobilePreview = Boolean(previewDisplayMaxEdgePx && previewDisplayMaxEdgePx > 0);
      const isGif = isGifPreviewFile(item);
      const needsIosGifWorkaround = isGif && shouldUseGifCanvasPlayback();

      if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;

      const cached = urlCacheRef.current.get(item.id);
      if (cached) return cached.url;

      const existingRequest = inFlightRef.current.get(item.id);
      if (existingRequest) return existingRequest;

      const controller = new AbortController();
      fetchAbortRef.current.set(item.id, controller);

      const request = (async () => {
        try {
          if (controller.signal.aborted || !isActive() || !isFileInBlobCacheWindow(item.id)) {
            return null;
          }

          // Human: iOS animated preview — cache bytes for static poster; defer ffmpeg until active slide mounts video.
          // Agent: WRITES gifBlob cache; RETURNS blob URL; preview-animation ticket fetched in AnimatedGifCanvas.
          if (needsIosGifWorkaround) {
            const blob = await fetchPreviewBlob(item, controller.signal);
            if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;

            const displayBlob = normalizePreviewBlob(blob, item.mime_type);
            const { naturalWidth, naturalHeight } = await readImageNaturalDimensions(displayBlob);
            rememberPreviewDimensions(item.id, naturalWidth, naturalHeight);
            cacheGifBlob(item.id, displayBlob, session);

            if (silent) {
              // Human: Prefetch ticket URL only — ffmpeg starts when the active slide mounts video.
              // Agent: WARM animationUrlCacheRef for swipe; DOES NOT GET preview-animation body.
              void resolveGifAnimationPreviewUrl(item.id).catch(() => undefined);
            }

            return cacheBlobUrl(item.id, displayBlob, session);
          }

          // Human: Same-origin stream bytes keep GIF animation on Android mobile — skip downscale.
          // Agent: HTTP GET /files/:id/stream?ticket=; SKIPPED on iOS (uses MP4 workaround above).
          if (isMobilePreview && isGif && !shareToken && !needsIosGifWorkaround) {
            try {
              const stream = await fetchFileStreamUrlForPreview(item);
              if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;
              return cachePreviewUrl(item.id, stream.url, stream.revokeOnClose, session);
            } catch {
              // Human: Stream ticket may fail for some rows — fall through to blob download below.
              // Agent: FALLBACK fetchPreviewBlob path.
            }
          }

          const blob = await fetchPreviewBlob(item, controller.signal);
          if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;

          let displayBlob = normalizePreviewBlob(blob, item.mime_type);

          if (isMobilePreview && isGif) {
            const { naturalWidth, naturalHeight } = await readImageNaturalDimensions(displayBlob);
            rememberPreviewDimensions(item.id, naturalWidth, naturalHeight);
          } else if (isMobilePreview) {
            const prepared = await preparePreviewDisplayBlob(
              displayBlob,
              previewDisplayMaxEdgePx!,
              controller.signal,
            );
            if (!isActive() || !isFileInBlobCacheWindow(item.id)) return null;
            displayBlob = prepared.blob;
            rememberPreviewDimensions(item.id, prepared.naturalWidth, prepared.naturalHeight);
          }

          return cacheBlobUrl(item.id, displayBlob, session);
        } catch (err) {
          if (isAbortError(err)) return null;
          if (silent) return null;
          throw err;
        } finally {
          fetchAbortRef.current.delete(item.id);
          if (isCacheSessionActive(session)) {
            inFlightRef.current.delete(item.id);
          }
        }
      })();

      inFlightRef.current.set(item.id, request);
      return request;
    },
    [
      cacheBlobUrl,
      cacheGifBlob,
      cachePreviewUrl,
      fetchPreviewBlob,
      isCacheSessionActive,
      isFileInBlobCacheWindow,
      previewDisplayMaxEdgePx,
      rememberPreviewDimensions,
      resolveGifAnimationPreviewUrl,
      shareToken,
      sharePassword,
    ],
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
      setDisplayUrl(cachedCurrent.url);
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
    ? (urlCacheRef.current.get(file.id)?.url ?? displayUrl)
    : displayUrl;

  const resolvedAdjacentUrls = useMemo((): ImagePreviewAdjacentUrls => {
    if (currentIndex < 0) {
      return { previous: null, next: null };
    }

    return {
      previous:
        currentIndex > 0
          ? urlCacheRef.current.get(images[currentIndex - 1]!.id)?.url ?? null
          : null,
      next:
        currentIndex < images.length - 1
          ? urlCacheRef.current.get(images[currentIndex + 1]!.id)?.url ?? null
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
    getPreviewGifBlob,
    resolveGifAnimationPreviewUrl,
    markGifAnimationPreviewCached,
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
