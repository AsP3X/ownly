// Human: EPUB preview state — fetch bytes, parse spine/TOC, chapter nav, and reading preferences.
// Agent: FETCHES fetchFileBlobForPreview; WRITES epub Book + Rendition refs; READS epub-navigation helpers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Book, type Rendition } from "epubjs";
import {
  fetchFileBlobForPreview,
  fetchPublicShareBlobForPreview,
  getErrorMessage,
} from "@/api/client";
import { openEpubBookFromBlob } from "@/lib/epub-document-source";
import { measureRenditionHost, nextFrame, waitForRenditionHostLayout } from "@/lib/epub-rendition-layout";
import {
  clampSpineIndex,
  computeChapterProgress,
  flattenEpubToc,
  formatChapterProgressCompact,
  formatChapterProgressLabel,
  resolveChapterLabel,
  type EpubNavItem,
} from "@/lib/epub-navigation";
import {
  readEpubReaderPreferences,
  writeEpubReaderPreferences,
  type EpubReaderPreferences,
} from "@/lib/epub-reader-preference";
import {
  EPUB_FONT_SIZE_PX,
  EPUB_LINE_HEIGHT,
} from "@/components/drive/epub/epub-preview-constants";
import type { EpubPreviewDialogProps, EpubTocEntry } from "@/components/drive/epub/epub-preview-types";

export type EpubPreviewControllerViewModel = {
  file: EpubPreviewDialogProps["file"];
  loading: boolean;
  error: string;
  tocOpen: boolean;
  setTocOpen: (open: boolean) => void;
  toggleToc: () => void;
  tocEntries: EpubTocEntry[];
  currentSpineIndex: number;
  totalSpineItems: number;
  chapterLabel: string;
  progressFraction: number;
  progressLabel: string;
  progressCompactLabel: string;
  currentHref: string | null;
  preferences: EpubReaderPreferences;
  setPreferences: (next: EpubReaderPreferences) => void;
  goNextChapter: () => void;
  goPreviousChapter: () => void;
  goToTocEntry: (entry: EpubTocEntry) => void;
  registerRenditionHost: (node: HTMLDivElement | null) => void;
  bookReady: boolean;
  canRenderRendition: boolean;
};

function applyRenditionTheme(rendition: Rendition, preferences: EpubReaderPreferences): void {
  const fontSizePx = EPUB_FONT_SIZE_PX[preferences.fontSize];
  const lineHeight = EPUB_LINE_HEIGHT[preferences.lineSpacing];

  rendition.themes.register("ownly", {
    body: {
      "font-family": "Merriweather, Georgia, serif !important",
      "font-size": `${fontSizePx}px !important`,
      "line-height": `${lineHeight} !important`,
      color: preferences.theme === "dark" ? "#E8E6E3 !important" : "#2C2C2C !important",
      background:
        preferences.theme === "dark"
          ? "#141414 !important"
          : preferences.theme === "sepia"
            ? "#F4ECD8 !important"
            : "#FAF8F5 !important",
      margin: "0 !important",
    },
    img: {
      "max-width": "100% !important",
      "height": "auto !important",
      "object-fit": "contain !important",
      margin: "0 auto !important",
      display: "block !important",
    },
  });
  rendition.themes.select("ownly");
}

// Human: Normalize section HTML so content fills the iframe without horizontal clipping.
// Agent: RUNS on rendition.hooks.content for every spine section.
function registerContentLayout(rendition: Rendition): void {
  rendition.hooks.content.register((contents: { document?: Document }) => {
    const doc = contents.document;
    const html = doc?.documentElement;
    const body = doc?.body;
    if (!html || !body) return;

    html.style.setProperty("height", "100%", "important");
    html.style.setProperty("margin", "0", "important");
    html.style.setProperty("padding", "0", "important");
    html.style.setProperty("box-sizing", "border-box", "important");

    body.style.setProperty("margin", "0", "important");
    body.style.setProperty("padding", "0", "important");
    body.style.setProperty("box-sizing", "border-box", "important");
    body.style.setProperty("overflow-x", "hidden", "important");

    const images = body.querySelectorAll("img");
    if (images.length === 1) {
      const text = body.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length <= 64) {
        body.style.setProperty("display", "flex", "important");
        body.style.setProperty("align-items", "center", "important");
        body.style.setProperty("justify-content", "center", "important");
        body.style.setProperty("min-height", "100%", "important");
      }
    }

    images.forEach((node) => {
      const image = node as HTMLImageElement;
      image.style.setProperty("max-width", "100%", "important");
      image.style.setProperty("max-height", "100%", "important");
      image.style.setProperty("width", "auto", "important");
      image.style.setProperty("height", "auto", "important");
      image.style.setProperty("object-fit", "contain", "important");
      image.style.setProperty("display", "block", "important");
      image.style.setProperty("margin", "0 auto", "important");
    });
  });
}

function getSpineLength(book: Book): number {
  const spine = book.spine as Book["spine"] & { length?: number; spineItems?: unknown[] };
  return spine.length ?? spine.spineItems?.length ?? 0;
}

function isBookPackageReady(book: Book | null): book is Book & { package: unknown } {
  return Boolean(book && (book as Book & { package?: unknown }).package);
}

export function useEpubPreviewController({
  file,
  open,
  shareToken,
  sharePassword,
}: Pick<EpubPreviewDialogProps, "file" | "open" | "shareToken" | "sharePassword">): EpubPreviewControllerViewModel {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [tocEntries, setTocEntries] = useState<EpubTocEntry[]>([]);
  const [currentSpineIndex, setCurrentSpineIndex] = useState(0);
  const [totalSpineItems, setTotalSpineItems] = useState(0);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [preferences, setPreferencesState] = useState<EpubReaderPreferences>(() => readEpubReaderPreferences());
  const [bookReady, setBookReady] = useState(false);
  const [hostMounted, setHostMounted] = useState(false);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const renditionHostRef = useRef<HTMLDivElement | null>(null);
  const attachedHostRef = useRef<{ book: Book; node: HTMLDivElement } | null>(null);
  const syncGenerationRef = useRef(0);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncDirtyRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const currentSpineIndexRef = useRef(0);
  const preferencesRef = useRef(preferences);
  const abortRef = useRef<AbortController | null>(null);

  preferencesRef.current = preferences;
  currentSpineIndexRef.current = currentSpineIndex;

  const detachResizeObserver = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const destroyRendition = useCallback(() => {
    detachResizeObserver();
    renditionRef.current?.destroy();
    renditionRef.current = null;
    attachedHostRef.current = null;
  }, [detachResizeObserver]);

  // Human: Bumps sync generation so in-flight attach/display work aborts after the next await.
  // Agent: CALLS destroyRendition; USE when closing dialog or unmounting the host node.
  const cancelRenditionSync = useCallback(() => {
    syncGenerationRef.current += 1;
    destroyRendition();
  }, [destroyRendition]);

  const destroyBook = useCallback(() => {
    cancelRenditionSync();
    bookRef.current?.destroy();
    bookRef.current = null;
    setBookReady(false);
    setHostMounted(false);
    setTocEntries([]);
    setCurrentSpineIndex(0);
    setTotalSpineItems(0);
    setCurrentHref(null);
    setTocOpen(false);
  }, [cancelRenditionSync]);

  const displayAtIndex = useCallback(async (index: number) => {
    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!book) return;

    const clamped = clampSpineIndex(index, getSpineLength(book));
    setCurrentSpineIndex(clamped);

    const spineItem = book.spine.get(clamped);
    const href = spineItem?.href ?? null;
    setCurrentHref(href);

    if (rendition && href) {
      await rendition.display(href);
    }
  }, []);

  const syncRendition = useCallback(async () => {
    const generation = syncGenerationRef.current + 1;
    syncGenerationRef.current = generation;

    const node = renditionHostRef.current;
    const book = bookRef.current;

    if (!node || !book || !bookReady || !hostMounted) {
      cancelRenditionSync();
      return;
    }

    if (
      attachedHostRef.current?.book === book &&
      attachedHostRef.current?.node === node &&
      renditionRef.current
    ) {
      return;
    }

    destroyRendition();

    try {
      if (generation !== syncGenerationRef.current) return;
      if (bookRef.current !== book || renditionHostRef.current !== node) return;
      if (!isBookPackageReady(bookRef.current)) {
        throw new Error("EPUB metadata is not ready yet.");
      }

      await waitForRenditionHostLayout(node);
      if (generation !== syncGenerationRef.current) return;
      if (bookRef.current !== book || renditionHostRef.current !== node) return;

      const hostSize = measureRenditionHost(node);

      const rendition = book.renderTo(node, {
        width: hostSize.width,
        height: hostSize.height,
        // Human: Scrolled-doc avoids paginated column clipping on covers and fixed-layout pages.
        // Agent: USES one scrollable section per spine item; chapter nav still calls display(href).
        flow: "scrolled-doc",
        spread: "none",
      });
      renditionRef.current = rendition;
      applyRenditionTheme(rendition, preferencesRef.current);
      registerContentLayout(rendition);

      rendition.on("relocated", (location: { start?: { index?: number; href?: string } }) => {
        const spineIndex = location?.start?.index;
        if (typeof spineIndex === "number") {
          setCurrentSpineIndex(spineIndex);
        }
        const href = location?.start?.href;
        if (typeof href === "string") {
          setCurrentHref(href);
        }
      });

      await rendition.started;
      if (generation !== syncGenerationRef.current) return;
      if (bookRef.current !== book || renditionHostRef.current !== node) return;

      attachedHostRef.current = { book, node };
      await displayAtIndex(currentSpineIndexRef.current);

      await nextFrame();
      await nextFrame();
      const latestSize = measureRenditionHost(node);
      rendition.resize(latestSize.width, latestSize.height);

      detachResizeObserver();
      const observer = new ResizeObserver(() => {
        const renditionInstance = renditionRef.current;
        const hostNode = renditionHostRef.current;
        if (!renditionInstance || !hostNode) return;

        const nextSize = measureRenditionHost(hostNode);
        renditionInstance.resize(nextSize.width, nextSize.height);
      });
      observer.observe(node);
      resizeObserverRef.current = observer;
    } catch (cause) {
      if (generation !== syncGenerationRef.current) return;
      setError(getErrorMessage(cause));
    }
  }, [bookReady, cancelRenditionSync, destroyRendition, detachResizeObserver, displayAtIndex, hostMounted]);

  const syncRenditionRef = useRef(syncRendition);
  syncRenditionRef.current = syncRendition;

  // Human: Coalesce concurrent attach requests — one in-flight sync, one follow-up if dirtied.
  // Agent: SETS syncDirtyRef while busy; RE-RUNS once when the in-flight promise settles.
  const queueSyncRendition = useCallback(() => {
    if (syncInFlightRef.current) {
      syncDirtyRef.current = true;
      return;
    }

    const run = () => {
      syncDirtyRef.current = false;
      syncInFlightRef.current = syncRenditionRef.current().finally(() => {
        syncInFlightRef.current = null;
        if (syncDirtyRef.current) {
          run();
        }
      });
    };

    run();
  }, []);

  // Human: Stable ref callback — must not depend on bookReady or React re-attaches and destroys mid-start().
  // Agent: WRITES host ref + hostMounted state; sync is triggered by the dedicated effect below.
  const registerRenditionHost = useCallback((node: HTMLDivElement | null) => {
    renditionHostRef.current = node;
    setHostMounted(Boolean(node));
    if (!node) {
      cancelRenditionSync();
    }
  }, [cancelRenditionSync]);

  useEffect(() => {
    if (!bookReady || !hostMounted || !open) return;
    queueSyncRendition();
  }, [bookReady, hostMounted, open, file?.id, queueSyncRendition]);

  useEffect(() => {
    if (!open || !file) {
      abortRef.current?.abort();
      abortRef.current = null;
      destroyBook();
      setLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    async function loadEpub() {
      setLoading(true);
      setError("");

      try {
        const blob = shareToken
          ? await fetchPublicShareBlobForPreview(shareToken, file!.id, sharePassword, controller.signal)
          : await fetchFileBlobForPreview(file!, controller.signal);

        if (cancelled) return;

        destroyBook();

        const book = await openEpubBookFromBlob(blob);
        if (cancelled || controller.signal.aborted) {
          book.destroy();
          return;
        }

        bookRef.current = book;

        const navigation = await book.loaded.navigation;
        if (cancelled || controller.signal.aborted) {
          book.destroy();
          bookRef.current = null;
          return;
        }

        const flattened = flattenEpubToc((navigation?.toc ?? []) as EpubNavItem[]);
        setTocEntries(flattened);
        setTotalSpineItems(getSpineLength(book));
        setCurrentSpineIndex(0);
        setCurrentHref(book.spine.get(0)?.href ?? null);
        setBookReady(true);
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return;
        setError(getErrorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadEpub();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [destroyBook, file, open, sharePassword, shareToken]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyRenditionTheme(rendition, preferences);
    writeEpubReaderPreferences(preferences);
  }, [preferences]);

  const setPreferences = useCallback((next: EpubReaderPreferences) => {
    setPreferencesState(next);
  }, []);

  const goNextChapter = useCallback(() => {
    void displayAtIndex(currentSpineIndex + 1);
  }, [currentSpineIndex, displayAtIndex]);

  const goPreviousChapter = useCallback(() => {
    void displayAtIndex(currentSpineIndex - 1);
  }, [currentSpineIndex, displayAtIndex]);

  const goToTocEntry = useCallback(
    (entry: EpubTocEntry) => {
      const rendition = renditionRef.current;
      if (rendition) {
        void rendition.display(entry.href);
      }
      setCurrentHref(entry.href);
      setTocOpen(false);
    },
    [],
  );

  const toggleToc = useCallback(() => {
    setTocOpen((value) => !value);
  }, []);

  const chapterLabel = useMemo(
    () => resolveChapterLabel(tocEntries, currentHref, currentSpineIndex),
    [currentHref, currentSpineIndex, tocEntries],
  );

  const progressFraction = useMemo(
    () => computeChapterProgress(currentSpineIndex, totalSpineItems),
    [currentSpineIndex, totalSpineItems],
  );

  const progressLabel = useMemo(
    () => formatChapterProgressLabel(currentSpineIndex, totalSpineItems),
    [currentSpineIndex, totalSpineItems],
  );

  const progressCompactLabel = useMemo(
    () => formatChapterProgressCompact(currentSpineIndex, totalSpineItems),
    [currentSpineIndex, totalSpineItems],
  );

  const canRenderRendition = bookReady && !loading && !error;

  return {
    file,
    loading,
    error,
    tocOpen,
    setTocOpen,
    toggleToc,
    tocEntries,
    currentSpineIndex,
    totalSpineItems,
    chapterLabel,
    progressFraction,
    progressLabel,
    progressCompactLabel,
    currentHref,
    preferences,
    setPreferences,
    goNextChapter,
    goPreviousChapter,
    goToTocEntry,
    registerRenditionHost,
    bookReady,
    canRenderRendition,
  };
}
