// Human: In-browser PDF viewer — Pencil Ownly Explorer PDF Viewer with thumbnails, page nav, and zoom.
// Agent: FETCHES fetchFileBlobForPreview; RENDERS react-pdf Document + Page; READS pdf-viewer worker.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Document, Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "react-pdf";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import "@/lib/pdf-viewer";
import "@/lib/pdf-search.css";
import {
  normalizePdfSearchQuery,
  renderPdfSearchTextItem,
  scrollToPdfSearchMatch,
  searchPdfDocument,
  type PdfSearchMatch,
} from "@/lib/pdf-search";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PdfPreviewDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, PDF bytes load through anonymous public share download. */
  shareToken?: string;
  sharePassword?: string | null;
  /** Human: Optional download action — shown in the header when provided. */
  onDownload?: (file: FileItem) => void;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
// Human: Default opens at 100% — matches Pencil zoom label in the viewer header.
const DEFAULT_ZOOM = 1;
// Human: Fine wheel steps — small notch per scroll tick; scaled slightly by delta magnitude.
const WHEEL_ZOOM_MIN = 0.012;
const WHEEL_ZOOM_MAX = 0.055;
const WHEEL_ZOOM_SCALE = 0.00035;
const THUMBNAIL_WIDTH = 84;
// Human: Padding inside the dark document pane (Tailwind p-6) used when fitting a full page.
const PAGE_AREA_PADDING_PX = 48;
// Human: Vertical gap between stacked pages in the scrollable document pane.
const PAGE_STACK_GAP_PX = 24;
// Human: Debounce in-document search while typing so large PDFs stay responsive.
const SEARCH_DEBOUNCE_MS = 300;

// Human: Skip global viewer shortcuts when focus is in an editable field (search input, page input).
// Agent: READS event.target tagName and isContentEditable; RETURNS true for INPUT/TEXTAREA/SELECT/contenteditable.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

function clampPage(value: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(total, Math.max(1, value));
}

// Human: Scale PDF page dimensions so the entire page fits inside the document pane (contain).
// Agent: READS native page size + container clientWidth/clientHeight; RETURNS fit width in px.
function computeFitPageWidth(
  nativeWidth: number,
  nativeHeight: number,
  containerWidth: number,
  containerHeight: number,
): number {
  const availableWidth = Math.max(containerWidth - PAGE_AREA_PADDING_PX, 200);
  const availableHeight = Math.max(containerHeight - PAGE_AREA_PADDING_PX, 200);
  const widthScale = availableWidth / nativeWidth;
  const heightScale = availableHeight / nativeHeight;
  const fitScale = Math.min(widthScale, heightScale);
  return Math.round(nativeWidth * fitScale);
}

// Human: Scale wheel deltas from line/page modes into pixel-like steps for consistent zoom speed.
// Agent: READS WheelEvent.deltaMode; RETURNS normalized deltaY for clampZoom step sizing.
function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * 800;
  }
  return event.deltaY;
}

export function PdfPreviewDialog({
  file,
  open,
  onOpenChange,
  shareToken,
  sharePassword,
  onDownload,
}: PdfPreviewDialogProps) {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
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

  // Human: Callback ref so resize listeners attach after the dialog portal mounts the document pane.
  // Agent: WRITES documentAreaNode when the dark document-area DOM node appears or unmounts.
  const documentAreaRef = useCallback((node: HTMLDivElement | null) => {
    setDocumentAreaNode(node);
  }, []);

  // Human: Reset viewer state when switching files or reopening the dialog.
  // Agent: CLEARS pdfData and zoom; FETCH effect loads bytes for the active file id.
  useEffect(() => {
    setPdfData(null);
    setError("");
    setNumPages(0);
    setCurrentPage(1);
    setPageInputValue("1");
    setZoom(DEFAULT_ZOOM);
    setFitPageWidth(undefined);
    setPageNativeSize(null);
    pdfDocumentRef.current = null;
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setActiveSearchMatchIndex(0);
    setSearching(false);
  }, [file?.id]);

  // Human: Keep the page input in sync when navigation changes currentPage externally.
  // Agent: WRITES pageInputValue string from currentPage whenever the active page changes.
  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  // Human: Fit each page to the document pane so one full page is visible at 100% zoom.
  // Agent: READS pageNativeSize + documentAreaNode via ResizeObserver; WRITES fitPageWidth.
  useLayoutEffect(() => {
    if (!open || !documentAreaNode || !pageNativeSize) return;

    const updateFitWidth = () => {
      setFitPageWidth(
        computeFitPageWidth(
          pageNativeSize.width,
          pageNativeSize.height,
          documentAreaNode.clientWidth,
          documentAreaNode.clientHeight,
        ),
      );
    };

    updateFitWidth();
    const observer = new ResizeObserver(updateFitWidth);
    observer.observe(documentAreaNode);
    return () => observer.disconnect();
  }, [open, documentAreaNode, pageNativeSize]);

  // Human: Load PDF bytes through the authenticated download path used by image preview.
  // Agent: FETCHES fetchFileBlobForPreview; WRITES ArrayBuffer only when activeFileIdRef still matches.
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

  // Human: Track the page nearest the viewport center while the user scrolls the document pane.
  // Agent: READS [data-pdf-page] offsets; WRITES currentPage from scroll position.
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

  // Human: Load native page dimensions from the PDF so fit-to-page width can be computed.
  // Agent: CALLS pdf.getPage(1) on Document load; WRITES pageNativeSize from viewport at scale 1.
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

  // Human: Debounced case-insensitive search across all pages when the query changes.
  // Agent: CALLS searchPdfDocument; CANCELS stale runs via AbortController.
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
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [open, searchQuery, numPages]);

  // Human: Re-scroll to the active match after zoom or text-layer re-render changes layout.
  // Agent: READS activeSearchMatchIndex + searchMatches; CALLS scrollToPdfSearchMatch.
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

  const zoomIn = useCallback(() => {
    setZoom((current) => clampZoom(current + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((current) => clampZoom(current - ZOOM_STEP));
  }, []);

  // Human: Ctrl+wheel zooms inside the document pane; plain wheel scrolls when content overflows.
  // Agent: LISTENS wheel on documentAreaNode; preventDefault ONLY when event.ctrlKey is set.
  const applyWheelZoom = useCallback((deltaY: number) => {
    const direction = deltaY < 0 ? 1 : -1;
    const step = Math.min(
      WHEEL_ZOOM_MAX,
      Math.max(WHEEL_ZOOM_MIN, Math.abs(deltaY) * WHEEL_ZOOM_SCALE),
    );
    setZoom((current) => clampZoom(current + direction * step));
  }, []);

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

  // Human: Focus the search field when the panel opens (toolbar button or Ctrl/Cmd+F).
  // Agent: CALLS searchInputRef.focus after searchOpen becomes true.
  useEffect(() => {
    if (!open || !searchOpen) return;
    const frameId = requestAnimationFrame(() => {
      const input = searchInputRef.current ?? mobileSearchInputRef.current;
      input?.focus();
      input?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open, searchOpen]);

  // Human: Keyboard shortcuts for zoom, page navigation, and in-document search.
  // Agent: LISTENS document keydown capture; SKIPS editable targets; Ctrl/Cmd+F opens search.
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

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomInRef.current();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomOutRef.current();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPreviousPageRef.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNextPageRef.current();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [open, searchOpen]);

  useEffect(() => {
    if (!open || !documentAreaNode) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      applyWheelZoom(normalizeWheelDelta(event));
    }

    documentAreaNode.addEventListener("wheel", handleWheel, { passive: false });
    return () => documentAreaNode.removeEventListener("wheel", handleWheel);
  }, [open, documentAreaNode, applyWheelZoom]);

  // Human: Scroll the active thumbnail into view when the current page changes.
  // Agent: READS thumbnailRefs; CALLS scrollIntoView on the matching sidebar button.
  useEffect(() => {
    if (!open || numPages === 0) return;
    const activeThumb = thumbnailRefs.current.get(currentPage);
    activeThumb?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, currentPage, numPages]);

  const scaledWidth = fitPageWidth ? Math.round(fitPageWidth * zoom) : undefined;
  const showDownloadAction = Boolean(file && onDownload);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-visible border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[75rem]"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
      >
        {/* Human: Screen-reader title — visible chrome lives inside the viewer card per Pencil. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "PDF preview"}</DialogTitle>
          <DialogDescription>
            {numPages > 0
              ? `Viewing page ${currentPage} of ${numPages}. Scroll to change pages; Ctrl+scroll to zoom.`
              : "View PDF pages in the browser."}
          </DialogDescription>
        </DialogHeader>

        {/* Human: Viewer card — white shell, header toolbar, thumbnail sidebar, dark document pane. */}
        <div className="flex h-[min(850px,90dvh)] w-full flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
          {/* Human: Card header — filename, security badge, page/zoom controls, actions. */}
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="size-5 shrink-0 text-red-500" aria-hidden />
              <p className="truncate text-sm font-bold text-[#1A1A1A]">{file?.name ?? "PDF preview"}</p>
              <span className="hidden items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 sm:inline-flex">
                <ShieldCheck className="size-3" aria-hidden />
                Decrypted Locally
              </span>
            </div>

            <div className="hidden items-center gap-6 md:flex">
              {/* Human: Page navigation cluster — prev, editable page input, total, next. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canGoPrevious}
                  onClick={goPreviousPage}
                  aria-label="Previous page"
                  className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#666666] transition-colors hover:bg-[#F7F8FA] disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                </button>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Current page"
                    value={pageInputValue}
                    onChange={(event) => setPageInputValue(event.target.value.replace(/\D/g, ""))}
                    onBlur={commitPageInput}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitPageInput();
                      }
                    }}
                    className="h-[26px] w-8 rounded border border-[#E5E7EB] bg-white text-center text-xs text-[#1A1A1A] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                  />
                  <span className="text-xs text-[#666666]">of {numPages || "—"}</span>
                </div>

                <button
                  type="button"
                  disabled={!canGoNext}
                  onClick={goNextPage}
                  aria-label="Next page"
                  className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronRight className="size-3.5" aria-hidden />
                </button>
              </div>

              <div className="h-5 w-px bg-[#E5E7EB]" aria-hidden />

              {/* Human: Zoom cluster — minus, percentage label, plus. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={zoom <= MIN_ZOOM}
                  onClick={zoomOut}
                  aria-label="Zoom out"
                  className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#666666] transition-colors hover:bg-[#F7F8FA] disabled:pointer-events-none disabled:opacity-40"
                >
                  <Minus className="size-3.5" aria-hidden />
                </button>
                <span className="min-w-[2.75rem] text-center text-xs font-bold text-[#1A1A1A]">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  disabled={zoom >= MAX_ZOOM}
                  onClick={zoomIn}
                  aria-label="Zoom in"
                  className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:pointer-events-none disabled:opacity-40"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              {searchOpen ? (
                <div className="hidden items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-2 py-1 sm:flex">
                  <Search className="size-3.5 shrink-0 text-[#666666]" aria-hidden />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (event.shiftKey) goToPreviousSearchMatch();
                        else goToNextSearchMatch();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        closeSearch();
                      }
                    }}
                    placeholder="Search in document"
                    aria-label="Search in PDF"
                    className="h-7 w-[min(12rem,28vw)] bg-transparent text-xs text-[#1A1A1A] outline-none placeholder:text-[#888888]"
                  />
                  <span className="min-w-[4.5rem] text-center text-[10px] text-[#666666]" aria-live="polite">
                    {searchResultLabel}
                  </span>
                  <button
                    type="button"
                    disabled={!canNavigateSearchMatches}
                    onClick={goToPreviousSearchMatch}
                    aria-label="Previous search result"
                    className="flex size-6 items-center justify-center rounded-md text-[#666666] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronUp className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={!canNavigateSearchMatches}
                    onClick={goToNextSearchMatch}
                    aria-label="Next search result"
                    className="flex size-6 items-center justify-center rounded-md text-[#666666] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronDown className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={closeSearch}
                    aria-label="Close search"
                    className="flex size-6 items-center justify-center rounded-md text-[#666666] transition-colors hover:bg-white"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title="Search in PDF (Ctrl+F)"
                  aria-label="Search in PDF"
                  onClick={() => setSearchOpen(true)}
                  className="hidden size-8 items-center justify-center rounded-lg bg-[#F7F8FA] text-[#666666] transition-colors hover:bg-[#E5E7EB] hover:text-[#1A1A1A] sm:flex"
                >
                  <Search className="size-4" aria-hidden />
                </button>
              )}

              {showDownloadAction ? (
                <button
                  type="button"
                  onClick={() => onDownload?.(file!)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#1d4ed8]"
                >
                  <Download className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">Download</span>
                </button>
              ) : null}

              <DialogClose
                render={
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-lg bg-[#F7F8FA] text-[#1A1A1A] transition-colors hover:bg-[#E5E7EB]"
                    aria-label="Close PDF preview"
                  />
                }
              >
                <X className="size-4" aria-hidden />
              </DialogClose>
            </div>
          </header>

          {/* Human: Mobile search strip — case-insensitive in-document search below the sm breakpoint. */}
          {searchOpen ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#E5E7EB] px-4 py-2 md:hidden">
              <Search className="size-3.5 shrink-0 text-[#666666]" aria-hidden />
              <input
                ref={mobileSearchInputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.shiftKey) goToPreviousSearchMatch();
                    else goToNextSearchMatch();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
                placeholder="Search in document"
                aria-label="Search in PDF"
                className="h-8 min-w-0 flex-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
              <span className="shrink-0 text-[10px] text-[#666666]" aria-live="polite">
                {searchResultLabel}
              </span>
              <button
                type="button"
                disabled={!canNavigateSearchMatches}
                onClick={goToPreviousSearchMatch}
                aria-label="Previous search result"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-40"
              >
                <ChevronUp className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                disabled={!canNavigateSearchMatches}
                onClick={goToNextSearchMatch}
                aria-label="Next search result"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-40"
              >
                <ChevronDown className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 justify-end border-b border-[#E5E7EB] px-4 py-2 md:hidden">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Search in PDF"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#666666]"
              >
                <Search className="size-3.5" aria-hidden />
                Search
              </button>
            </div>
          )}

          {/* Human: Mobile page/zoom strip — mirrors header controls below the sm breakpoint. */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canGoPrevious}
                onClick={goPreviousPage}
                aria-label="Previous page"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" aria-hidden />
              </button>
              <span className="text-xs text-[#666666]">
                {currentPage} / {numPages || "—"}
              </span>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={goNextPage}
                aria-label="Next page"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-40"
              >
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={zoom <= MIN_ZOOM}
                onClick={zoomOut}
                aria-label="Zoom out"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-40"
              >
                <Minus className="size-3.5" aria-hidden />
              </button>
              <span className="text-xs font-bold text-[#1A1A1A]">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                disabled={zoom >= MAX_ZOOM}
                onClick={zoomIn}
                aria-label="Zoom in"
                className="flex size-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-40"
              >
                <Plus className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {error ? (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-red-300" role="alert">
                {error}
              </p>
            ) : null}

            {loading && !pdfData ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[#666666]">
                <Loader2 className="size-6 animate-spin" aria-hidden />
                <span className="sr-only">Loading PDF…</span>
              </div>
            ) : null}

            {pdfData && !error ? (
              // Human: One Document instance feeds thumbnail sidebar and the scrollable page stack.
              // Agent: PARSES pdfData once; onLoadSuccess SETS numPages + pageNativeSize for fit width.
              <Document
                file={pdfData}
                loading={
                  <div className="flex flex-1 items-center justify-center gap-2 py-12 text-sm text-[#666666]">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    Rendering PDF…
                  </div>
                }
                onLoadSuccess={handleDocumentLoadSuccess}
                onLoadError={(loadError) => {
                  setError(loadError.message || "Could not open this PDF.");
                }}
                className="flex min-h-0 min-w-0 flex-1 flex-row"
              >
                {/* Human: Thumbnail sidebar — scrollable page previews with active border state. */}
                <aside className="hidden w-[180px] shrink-0 flex-col border-r border-[#E5E7EB] bg-[#F7F8FA] sm:flex">
                  <p className="px-3 pt-4 text-[11px] font-bold tracking-wide text-[#888888]">PAGE THUMBNAILS</p>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                    {numPages > 0
                      ? Array.from({ length: numPages }, (_, index) => {
                          const pageNumber = index + 1;
                          const isActive = pageNumber === currentPage;

                          return (
                            <button
                              key={`thumb-${pageNumber}`}
                              type="button"
                              ref={(node) => {
                                if (node) thumbnailRefs.current.set(pageNumber, node);
                                else thumbnailRefs.current.delete(pageNumber);
                              }}
                              onClick={() => goToPage(pageNumber)}
                              aria-label={`Go to page ${pageNumber}`}
                              aria-current={isActive ? "page" : undefined}
                              className="mb-3 flex w-full flex-col items-center gap-1 last:mb-0"
                            >
                              <div
                                className={cn(
                                  "flex w-[100px] items-center justify-center rounded border bg-white p-2 transition-colors",
                                  isActive
                                    ? "border-2 border-[#2563EB]"
                                    : "border border-[#E5E7EB] hover:border-[#2563EB]/50",
                                )}
                              >
                                <Page
                                  pageNumber={pageNumber}
                                  width={THUMBNAIL_WIDTH}
                                  renderAnnotationLayer={false}
                                  renderTextLayer={false}
                                  loading={
                                    <div className="flex h-[110px] w-full items-center justify-center">
                                      <Loader2 className="size-4 animate-spin text-[#888888]" aria-hidden />
                                    </div>
                                  }
                                />
                              </div>
                              <span
                                className={cn(
                                  "text-[10px]",
                                  isActive ? "font-bold text-[#2563EB]" : "text-[#666666]",
                                )}
                              >
                                Page {pageNumber}
                              </span>
                            </button>
                          );
                        })
                      : null}
                  </div>
                </aside>

                {/* Human: Document pane — scrollable stack of full pages, fit-to-viewport at 100% zoom. */}
                <div
                  ref={documentAreaRef}
                  tabIndex={-1}
                  onScroll={handleDocumentScroll}
                  className="relative flex min-h-0 min-w-0 flex-1 overflow-auto bg-[#374151] p-6 outline-none"
                >
                  {numPages > 0 && scaledWidth ? (
                    <div
                      className="mx-auto flex flex-col items-center"
                      style={{ gap: PAGE_STACK_GAP_PX }}
                    >
                      {Array.from({ length: numPages }, (_, index) => {
                        const pageNumber = index + 1;

                        return (
                          <div
                            key={`page-${pageNumber}`}
                            data-pdf-page
                            ref={(node) => {
                              if (node) pageRefs.current.set(pageNumber, node);
                              else pageRefs.current.delete(pageNumber);
                            }}
                            className="rounded bg-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
                          >
                            <Page
                              pageNumber={pageNumber}
                              width={scaledWidth}
                              renderAnnotationLayer
                              renderTextLayer
                              customTextRenderer={
                                hasSearchQuery && searchMatches.length > 0 ? customTextRenderer : undefined
                              }
                              loading={
                                <div className="flex min-h-[24rem] min-w-[16rem] items-center justify-center">
                                  <Loader2 className="size-6 animate-spin text-[#888888]" aria-hidden />
                                </div>
                              }
                              className={cn(loading && "opacity-70")}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : numPages > 0 ? (
                    <div className="flex flex-1 items-center justify-center py-12">
                      <Loader2 className="size-6 animate-spin text-white/70" aria-hidden />
                      <span className="sr-only">Sizing PDF pages…</span>
                    </div>
                  ) : null}
                </div>
              </Document>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
