// Human: Load and display one explorer grid thumbnail — cache, visibility, and safe blob URLs.
// Agent: READS LRU cache; CALLS loadBlob when visible; CLEARS display URL on scroll-away cleanup.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { FileItem } from "@/api/client";
import { getCachedExplorerThumbnailBlob } from "@/lib/explorer-thumbnail-cache";
import {
  cancelExplorerThumbnailLoad,
  type ExplorerThumbnailPriority,
} from "@/lib/explorer-thumbnail-queue";
import {
  thumbnailPriorityForPhase,
  useExplorerTileVisible,
} from "@/hooks/useExplorerTileVisible";

function revokeObjectUrl(objectUrlRef: { current: string | null }) {
  if (!objectUrlRef.current) return;
  URL.revokeObjectURL(objectUrlRef.current);
  objectUrlRef.current = null;
}

// Human: Paint instantly from the LRU blob cache when scrolling back to a tile.
// Agent: CREATES object URL; RETURNS null when cache miss.
function objectUrlFromCachedBlob(
  cacheKey: string,
  objectUrlRef: { current: string | null },
): string | null {
  const cached = getCachedExplorerThumbnailBlob(cacheKey);
  if (!cached) return null;
  revokeObjectUrl(objectUrlRef);
  const url = URL.createObjectURL(cached);
  objectUrlRef.current = url;
  return url;
}

/**
 * Human: Backoff schedule for re-fetching a preview that is flagged ready but not yet servable.
 * The server sets *_thumbnail_ready before the JPEG is reliably readable, and background polling
 * stops the moment that flag flips — so without these retries a tile that loses the race keeps
 * its placeholder until the user reloads the page.
 * Agent: One entry per retry; length also caps the attempt count.
 */
const THUMBNAIL_RETRY_DELAYS_MS = [700, 1500, 3000, 6000, 12000, 20000];

export type UseExplorerGridThumbnailOptions = {
  file: FileItem;
  cacheKey: string;
  enabled?: boolean;
  loadBlob: (
    file: FileItem,
    options: { priority: ExplorerThumbnailPriority; signal?: AbortSignal },
  ) => Promise<Blob>;
};

export type UseExplorerGridThumbnailResult = {
  containerRef: RefObject<HTMLDivElement | null>;
  displaySrc: string | null;
  loading: boolean;
  showFailed: boolean;
  fetchPriority: "high" | "low";
  handleImageError: () => void;
};

// Human: Shared grid thumbnail lifecycle — visible tiles always retry until a live preview URL exists.
// Agent: STABLE effect on isVisible only; CLEARS displaySrc in cleanup so revoked URLs never render.
export function useExplorerGridThumbnail(
  options: UseExplorerGridThumbnailOptions,
): UseExplorerGridThumbnailResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const phase = useExplorerTileVisible(containerRef);
  const priority = thumbnailPriorityForPhase(phase);
  const enabled = options.enabled ?? true;
  const isVisible = Boolean(priority) && enabled;
  const fetchPriority: "high" | "low" = priority === "high" ? "high" : "low";

  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Human: Retry counter for the not-yet-servable race; also re-triggers the load effect.
  // Agent: RESET whenever the tile's identity or thumbnail version changes.
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryTimerRef = useRef<number | null>(null);

  // Human: Still retrying counts as loading, not failure — the poster is on its way.
  const loading = isVisible && !displaySrc && !failed;
  const showFailed = isVisible && failed;

  // Human: A new file or a new thumbnail version starts the retry budget over.
  // Agent: WRITES retryAttempt 0 + clears failed so a fresh version is not judged by a stale failure.
  useEffect(() => {
    setRetryAttempt(0);
    setFailed(false);
  }, [options.cacheKey, options.file.id]);

  // Human: Drop any pending retry when the tile unmounts or scrolls away.
  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!isVisible) {
      return () => {
        cancelExplorerThumbnailLoad(options.file.id);
        revokeObjectUrl(objectUrlRef);
        setDisplaySrc(null);
      };
    }

    const controller = new AbortController();
    let cancelled = false;

    const cachedUrl = objectUrlFromCachedBlob(options.cacheKey, objectUrlRef);
    if (cachedUrl) {
      setDisplaySrc(cachedUrl);
      setFailed(false);
      return () => {
        cancelled = true;
        controller.abort();
        cancelExplorerThumbnailLoad(options.file.id);
        revokeObjectUrl(objectUrlRef);
        setDisplaySrc(null);
      };
    }

    revokeObjectUrl(objectUrlRef);
    setDisplaySrc(null);

    // Human: Viewport tiles always use high queue priority so scroll-back previews finish loading.
    // Agent: CALLS loadBlob with high; AVOIDS restarting loads when near/on ratio oscillates.
    void options
      .loadBlob(options.file, {
        priority: "high",
        signal: controller.signal,
      })
      .then((blob) => {
        if (controller.signal.aborted || cancelled) return;
        revokeObjectUrl(objectUrlRef);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setDisplaySrc(url);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDisplaySrc(null);
        // Human: A poster flagged ready can still 404 briefly while the object lands in storage.
        // Nothing else will re-trigger this load — background polling stops as soon as the ready
        // flag flips, and cacheKey is frozen with updated_at — so retry here or the tile is stuck.
        // Agent: SCHEDULES a bumped retryAttempt; gives up (and shows the fallback) after the last delay.
        const delay = THUMBNAIL_RETRY_DELAYS_MS[retryAttempt];
        if (delay === undefined) {
          setFailed(true);
          return;
        }
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setRetryAttempt((attempt) => attempt + 1);
        }, delay);
      });

    return () => {
      cancelled = true;
      controller.abort();
      cancelExplorerThumbnailLoad(options.file.id);
      revokeObjectUrl(objectUrlRef);
      setDisplaySrc(null);
    };
    // Human: Reload on identity, thumbnail version, visibility, or a scheduled retry — not on
    // every listing poll object swap.
    // Agent: DEPS file.id + cacheKey + retryAttempt; AVOIDS abort/retry storms on unrelated field updates.
  }, [options.cacheKey, options.file.id, isVisible, options.loadBlob, retryAttempt]);

  const handleImageError = () => {
    setFailed(true);
    revokeObjectUrl(objectUrlRef);
    setDisplaySrc(null);
  };

  return {
    containerRef,
    displaySrc: isVisible ? displaySrc : null,
    loading,
    showFailed,
    fetchPriority,
    handleImageError,
  };
}
