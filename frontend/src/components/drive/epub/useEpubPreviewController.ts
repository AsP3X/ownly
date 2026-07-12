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
    },
  });
  rendition.themes.select("ownly");
}

function getSpineLength(book: Book): number {
  const spine = book.spine as Book["spine"] & { length?: number; spineItems?: unknown[] };
  return spine.length ?? spine.spineItems?.length ?? 0;
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

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const renditionHostRef = useRef<HTMLDivElement | null>(null);
  const attachedHostRef = useRef<{ book: Book; node: HTMLDivElement } | null>(null);
  const syncGenerationRef = useRef(0);
  const currentSpineIndexRef = useRef(0);
  const preferencesRef = useRef(preferences);
  const abortRef = useRef<AbortController | null>(null);

  preferencesRef.current = preferences;
  currentSpineIndexRef.current = currentSpineIndex;

  const destroyRendition = useCallback(() => {
    renditionRef.current?.destroy();
    renditionRef.current = null;
    attachedHostRef.current = null;
  }, []);

  const destroyBook = useCallback(() => {
    syncGenerationRef.current += 1;
    destroyRendition();
    bookRef.current?.destroy();
    bookRef.current = null;
    setBookReady(false);
    setTocEntries([]);
    setCurrentSpineIndex(0);
    setTotalSpineItems(0);
    setCurrentHref(null);
    setTocOpen(false);
  }, [destroyRendition]);

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

    if (!node || !book || !bookReady) {
      destroyRendition();
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
      await book.opened;
      if (generation !== syncGenerationRef.current) return;
      if (bookRef.current !== book || renditionHostRef.current !== node) return;

      const bookWithPackage = bookRef.current as Book & { package?: unknown };
      if (!bookWithPackage.package) {
        throw new Error("EPUB metadata is not ready yet.");
      }

      const rendition = book.renderTo(node, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        manager: "default",
        // Human: Single-page spread keeps reflowable text and covers full width in the card.
        // Agent: MATCHES pen Reading Area width; avoids tiny centered cover in dual-page spread.
        spread: "none",
      });
      renditionRef.current = rendition;
      applyRenditionTheme(rendition, preferencesRef.current);

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
    } catch (cause) {
      if (generation !== syncGenerationRef.current) return;
      setError(getErrorMessage(cause));
    }
  }, [bookReady, destroyRendition, displayAtIndex]);

  const syncRenditionRef = useRef(syncRendition);
  syncRenditionRef.current = syncRendition;

  const registerRenditionHost = useCallback((node: HTMLDivElement | null) => {
    renditionHostRef.current = node;
    if (!node) {
      destroyRendition();
      return;
    }
    if (bookReady) {
      void syncRenditionRef.current();
    }
  }, [bookReady, destroyRendition]);

  useEffect(() => {
    if (!bookReady || !open) return;
    void syncRenditionRef.current();
  }, [bookReady, open, file?.id]);

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
        bookRef.current = book;

        if (cancelled) return;

        const navigation = await book.loaded.navigation;
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
  };
}
