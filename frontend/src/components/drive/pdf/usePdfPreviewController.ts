// Human: PDF preview state — fetch bytes, page nav, search, zoom, and fit-to-pane sizing for desktop/mobile shells.
// Agent: FETCHES fetchFileBlobForPreview; WRITES pdfData, currentPage, searchMatches; READS pdf-viewer worker via importers.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "react-pdf";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import {
  normalizePdfSearchQuery,
  renderPdfSearchTextItem,
  scrollToPdfSearchMatch,
  searchPdfDocument,
  type PdfSearchMatch,
} from "@/lib/pdf-search";
import type { PdfPreviewDialogProps } from "@/components/drive/pdf/pdf-preview-types";
import {
  PDF_DEFAULT_ZOOM,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  PDF_PAGE_AREA_PADDING_DESKTOP_PX,
  PDF_PAGE_STACK_GAP_DESKTOP_PX,
  PDF_PAGE_STACK_GAP_MOBILE_PX,
  PDF_SEARCH_DEBOUNCE_MS,
  PDF_THUMBNAIL_WIDTH_DESKTOP,
  PDF_THUMBNAIL_WIDTH_MOBILE,
  PDF_ZOOM_STEP,
} from "@/components/drive/pdf/pdf-preview-constants";

export type PdfPreviewVariant = "desktop" | "mobile";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function clampZoom(value: number): number {
  const snapped = Math.round(value / PDF_ZOOM_STEP) * PDF_ZOOM_STEP;
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, Number(snapped.toFixed(2))));
}

function clampPage(value: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(total, Math.max(1, value));
}

function computeFitPageWidth(
  nativeWidth: number,
  nativeHeight: number,
  containerWidth: number,
  containerHeight: number,
  pageAreaPaddingPx: number,
): number {
  const availableWidth = Math.max(containerWidth - pageAreaPaddingPx, 300);
  const availableHeight = Math.max(containerHeight - pageAreaPaddingPx, 300);
  const widthScale = availableWidth / nativeWidth;
  const heightScale = availableHeight / nativeHeight;
  const fitScale = Math.min(widthScale, heightScale);
  return Math.round(nativeWidth * fitScale);
}

type ZoomAnchor = {
  contentX: number;
  contentY: number;
  pointerX: number;
  pointerY: number;
  scale: number;
};

export function usePdfPreviewController(
  {
    file,
    open,
    shareToken,
    sharePassword,
  }: Pick<PdfPreviewDialogProps, "file" | "open" | "shareToken" | "sharePassword">,
  variant: PdfPreviewVariant,
) {
  const isDesktop = variant === "desktop";
  const pageAreaPaddingPx = isDesktop ? PDF_PAGE_AREA_PADDING_DESKTOP_PX : 0;
  const pageStackGapPx = isDesktop ? PDF_PAGE_STACK_GAP_DESKTOP_PX : PDF_PAGE_STACK_GAP_MOBILE_PX;
  const thumbnailWidth = isDesktop ? PDF_THUMBNAIL_WIDTH_DESKTOP : PDF_THUMBNAIL_WIDTH_MOBILE;

  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [zoom, setZoom] = useState(PDF_DEFAULT_ZOOM);
  const [fitPageWidth, setFitPageWidth] = useState<number | undefined>(undefined);
  const [pageNativeSize, setPageNativeSize] = useState<{ width: number; height: number } | null>(null);
  const [documentAreaNode, setDocumentAreaNode] = useState<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<PdfSearchMatch[]>([]);
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const activeFileIdRef = useRef<string | null>(null);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const thumbnailRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);

  const documentAreaRef = useCallback((node: HTMLDivElement | null) => {
    setDocumentAreaNode(node);
  }, []);

  useEffect(() => {
    setPdfData(null);
    setError("");
    setNumPages(0);
    setCurrentPage(1);
    setPageInputValue("1");
    setZoom(PDF_DEFAULT_ZOOM);
    setFitPageWidth(undefined);
    setPageNativeSize(null);
    pdfDocumentRef.current = null;
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setActiveSearchMatchIndex(0);
    setSearching(false);
  }, [file?.id]);

  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  useLayoutEffect(() => {
    if (!open || !documentAreaNode || !pageNativeSize) return;

    const updateFitWidth = () => {
      if (!isDesktop) {
        const width = Math.max(documentAreaNode.clientWidth - pageAreaPaddingPx, 280);
        setFitPageWidth(Math.round(pageNativeSize.width * (width / pageNativeSize.width)));
        return;
      }

      setFitPageWidth(
        computeFitPageWidth(
          pageNativeSize.width,
          pageNativeSize.height,
          documentAreaNode.clientWidth,
          documentAreaNode.clientHeight,
          pageAreaPaddingPx,
        ),
      );
    };

    updateFitWidth();
    const observer = new ResizeObserver(updateFitWidth);
    observer.observe(documentAreaNode);
    return () => observer.disconnect();
  }, [open, documentAreaNode, pageNativeSize, isDesktop, pageAreaPaddingPx]);

  useEffect(() => {
    if (!open || !file?.id) return;

    activeFileIdRef.current = file.id;
    const requestFileId = file.id;

    let cancelled = false;
    setLoading(true);
    setError("");

    void (shareToken
      ? fetchPublicShareBlobForPreview(shareToken, file.id, sharePassword)
      : fetchFileBlobForPreview(file))
      .then(async (blob) => {
        if (cancelled) return;
        const buffer = await blob.arrayBuffer();
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setPdfData(buffer);
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
  }, [open, file, shareToken, sharePassword]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = clampPage(page, numPages);
      setCurrentPage(clamped);
      pageRefs.current.get(clamped)?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [numPages],
  );

  const handleDocumentScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const pages = container.querySelectorAll("[data-pdf-page]");
    const mid = container.scrollTop + container.clientHeight / 2;

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index] as HTMLElement;
      if (page.offsetTop <= mid && page.offsetTop + page.offsetHeight > mid) {
        setCurrentPage(index + 1);
        break;
      }
    }
  }, []);

  const handleDocumentLoadSuccess = useCallback((pdf: PDFDocumentProxy) => {
    pdfDocumentRef.current = pdf;
    setNumPages(pdf.numPages);
    setCurrentPage(1);

    void pdf.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      setPageNativeSize({ width: viewport.width, height: viewport.height });
    });
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setActiveSearchMatchIndex(0);
    setSearching(false);
  }, []);

  const goToSearchMatch = useCallback(
    (matchIndex: number) => {
      if (searchMatches.length === 0) return;

      const wrappedIndex =
        ((matchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
      const match = searchMatches[wrappedIndex];
      if (!match) return;

      setActiveSearchMatchIndex(wrappedIndex);
      setCurrentPage(match.pageNumber);
      requestAnimationFrame(() => {
        scrollToPdfSearchMatch(pageRefs.current, match);
      });
    },
    [searchMatches],
  );

  const goToNextSearchMatch = useCallback(() => {
    goToSearchMatch(activeSearchMatchIndex + 1);
  }, [activeSearchMatchIndex, goToSearchMatch]);

  const goToPreviousSearchMatch = useCallback(() => {
    goToSearchMatch(activeSearchMatchIndex - 1);
  }, [activeSearchMatchIndex, goToSearchMatch]);

  useEffect(() => {
    const normalizedQuery = normalizePdfSearchQuery(searchQuery);
    if (!open || !normalizedQuery) {
      setSearchMatches([]);
      setActiveSearchMatchIndex(0);
      setSearching(false);
      return;
    }

    const pdf = pdfDocumentRef.current;
    if (!pdf) return;

    const controller = new AbortController();
    setSearching(true);

    const timeoutId = window.setTimeout(() => {
      void searchPdfDocument(pdf, normalizedQuery, controller.signal)
        .then((matches) => {
          if (controller.signal.aborted) return;
          setSearchMatches(matches);
          setActiveSearchMatchIndex(0);
          if (matches.length > 0) {
            setCurrentPage(matches[0]!.pageNumber);
            requestAnimationFrame(() => {
              scrollToPdfSearchMatch(pageRefs.current, matches[0]);
            });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, PDF_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [open, searchQuery, numPages]);

  useEffect(() => {
    if (!open || searchMatches.length === 0) return;
    const match = searchMatches[activeSearchMatchIndex];
    if (!match) return;

    const frameId = requestAnimationFrame(() => {
      scrollToPdfSearchMatch(pageRefs.current, match);
    });
    return () => cancelAnimationFrame(frameId);
  }, [open, activeSearchMatchIndex, searchMatches, fitPageWidth, zoom]);

  const customTextRenderer = useCallback(
    ({ str, pageNumber, itemIndex }: TextItem & { pageNumber: number; itemIndex: number }) =>
      renderPdfSearchTextItem(str, pageNumber, itemIndex, searchMatches, activeSearchMatchIndex),
    [searchMatches, activeSearchMatchIndex],
  );

  const goPreviousPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const goNextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const commitPageInput = useCallback(() => {
    const parsed = Number.parseInt(pageInputValue, 10);
    if (Number.isNaN(parsed)) {
      setPageInputValue(String(currentPage));
      return;
    }
    goToPage(parsed);
  }, [currentPage, goToPage, pageInputValue]);

  const applyZoomDeltaAtPoint = useCallback(
    (delta: number, clientX: number, clientY: number) => {
      if (!isDesktop) return;

      const container = documentAreaNode;
      if (!container) {
        setZoom((current) => clampZoom(current + delta));
        return;
      }

      const rect = container.getBoundingClientRect();
      const pointerX = clientX - rect.left;
      const pointerY = clientY - rect.top;
      const contentX = container.scrollLeft + pointerX;
      const contentY = container.scrollTop + pointerY;

      setZoom((current) => {
        const next = clampZoom(current + delta);
        if (next === current) return current;

        zoomAnchorRef.current = {
          contentX,
          contentY,
          pointerX,
          pointerY,
          scale: next / current,
        };
        return next;
      });
    },
    [documentAreaNode, isDesktop],
  );

  const zoomTowardDocumentCenter = useCallback(
    (delta: number) => {
      if (!isDesktop) return;

      const container = documentAreaNode;
      if (!container) {
        setZoom((current) => clampZoom(current + delta));
        return;
      }

      const rect = container.getBoundingClientRect();
      applyZoomDeltaAtPoint(delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [applyZoomDeltaAtPoint, documentAreaNode, isDesktop],
  );

  const zoomIn = useCallback(() => {
    zoomTowardDocumentCenter(PDF_ZOOM_STEP);
  }, [zoomTowardDocumentCenter]);

  const zoomOut = useCallback(() => {
    zoomTowardDocumentCenter(-PDF_ZOOM_STEP);
  }, [zoomTowardDocumentCenter]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const container = documentAreaNode;
    if (!anchor || !container) return;

    zoomAnchorRef.current = null;
    container.scrollLeft = anchor.contentX * anchor.scale - anchor.pointerX;
    container.scrollTop = anchor.contentY * anchor.scale - anchor.pointerY;
  }, [zoom, documentAreaNode]);

  const zoomInRef = useRef(zoomIn);
  const zoomOutRef = useRef(zoomOut);
  const goPreviousPageRef = useRef(goPreviousPage);
  const goNextPageRef = useRef(goNextPage);
  const goToNextSearchMatchRef = useRef(goToNextSearchMatch);
  const goToPreviousSearchMatchRef = useRef(goToPreviousSearchMatch);
  const closeSearchRef = useRef(closeSearch);

  useEffect(() => {
    zoomInRef.current = zoomIn;
    zoomOutRef.current = zoomOut;
    goPreviousPageRef.current = goPreviousPage;
    goNextPageRef.current = goNextPage;
    goToNextSearchMatchRef.current = goToNextSearchMatch;
    goToPreviousSearchMatchRef.current = goToPreviousSearchMatch;
    closeSearchRef.current = closeSearch;
  }, [zoomIn, zoomOut, goPreviousPage, goNextPage, goToNextSearchMatch, goToPreviousSearchMatch, closeSearch]);

  useEffect(() => {
    if (!open || !searchOpen) return;
    const frameId = requestAnimationFrame(() => {
      const input = searchInputRef.current ?? mobileSearchInputRef.current;
      input?.focus();
      input?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open, searchOpen]);

  useEffect(() => {
    if (!open) return;

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearchRef.current();
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (isDesktop) {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomInRef.current();
        } else if (event.key === "-") {
          event.preventDefault();
          zoomOutRef.current();
        }
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPreviousPageRef.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNextPageRef.current();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [open, searchOpen, isDesktop]);

  const applyZoomDeltaAtPointRef = useRef(applyZoomDeltaAtPoint);

  useEffect(() => {
    applyZoomDeltaAtPointRef.current = applyZoomDeltaAtPoint;
  }, [applyZoomDeltaAtPoint]);

  useEffect(() => {
    if (!open || !documentAreaNode || !isDesktop) return;

    function handleDocumentWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();

      const direction = event.deltaY < 0 ? 1 : -1;
      applyZoomDeltaAtPointRef.current(direction * PDF_ZOOM_STEP, event.clientX, event.clientY);
    }

    documentAreaNode.addEventListener("wheel", handleDocumentWheel, { passive: false });
    return () => documentAreaNode.removeEventListener("wheel", handleDocumentWheel);
  }, [open, documentAreaNode, isDesktop]);

  useEffect(() => {
    if (!open || !isDesktop) return;

    function blockBrowserZoomWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
    }

    function blockBrowserZoomKeys(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "0" || key === "+" || key === "-" || key === "=") {
        event.preventDefault();
      }
    }

    document.addEventListener("wheel", blockBrowserZoomWheel, { passive: false, capture: true });
    document.addEventListener("keydown", blockBrowserZoomKeys, true);
    return () => {
      document.removeEventListener("wheel", blockBrowserZoomWheel, true);
      document.removeEventListener("keydown", blockBrowserZoomKeys, true);
    };
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open || numPages === 0) return;
    const activeThumb = thumbnailRefs.current.get(currentPage);
    activeThumb?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, currentPage, numPages]);

  const effectiveZoom = isDesktop ? zoom : PDF_DEFAULT_ZOOM;
  const scaledWidth = fitPageWidth ? Math.round(fitPageWidth * effectiveZoom) : undefined;
  const canGoPrevious = currentPage > 1;
  const canGoNext = numPages > 0 && currentPage < numPages;
  const normalizedSearchQuery = normalizePdfSearchQuery(searchQuery);
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const searchResultLabel =
    !hasSearchQuery
      ? ""
      : searching
        ? "Searching…"
        : searchMatches.length === 0
          ? "No results"
          : `${activeSearchMatchIndex + 1} of ${searchMatches.length}`;
  const canNavigateSearchMatches = searchMatches.length > 1;

  const reportDocumentError = useCallback((message: string) => {
    setError(message);
  }, []);

  return {
    file,
    pdfData,
    error,
    loading,
    numPages,
    currentPage,
    pageInputValue,
    setPageInputValue,
    zoom,
    scaledWidth,
    thumbnailWidth,
    pageStackGapPx,
    documentAreaRef,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    mobileSearchInputRef,
    thumbnailRefs,
    pageRefs,
    goToPage,
    handleDocumentScroll,
    handleDocumentLoadSuccess,
    closeSearch,
    goToNextSearchMatch,
    goToPreviousSearchMatch,
    customTextRenderer,
    goPreviousPage,
    goNextPage,
    commitPageInput,
    zoomIn,
    zoomOut,
    canGoPrevious,
    canGoNext,
    hasSearchQuery,
    searchMatches,
    searchResultLabel,
    canNavigateSearchMatches,
    reportDocumentError,
  };
}

export type PdfPreviewControllerViewModel = ReturnType<typeof usePdfPreviewController>;
