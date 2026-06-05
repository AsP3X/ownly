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

  const loading = isVisible && !displaySrc;
  const showFailed = isVisible && failed && !loading;

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
        setFailed(true);
        setDisplaySrc(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
      cancelExplorerThumbnailLoad(options.file.id);
      revokeObjectUrl(objectUrlRef);
      setDisplaySrc(null);
    };
    // Human: Only reload when identity or thumbnail version changes — not every listing poll object swap.
    // Agent: DEPS file.id + cacheKey; AVOIDS abort/retry storms on unrelated FileItem field updates.
  }, [options.cacheKey, options.file.id, isVisible, options.loadBlob]);

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
