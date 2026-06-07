// Human: Mobile PDF viewer — Pencil MV Mobile Portrait PDF (full-bleed scroll, page badge, thumbnail drawer).
// Agent: RENDERS react-pdf Document; READS PdfPreviewControllerViewModel; WRITES sidebarOpen locally.

import { useCallback, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  PanelLeftClose,
  Search,
  X,
} from "lucide-react";
import { Document, Page } from "react-pdf";
import type { FileItem } from "@/api/client";
import "@/lib/pdf-viewer";
import "@/lib/pdf-search.css";
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
import { formatBytes } from "@/lib/utils-app";
import type { PdfPreviewControllerViewModel } from "@/components/drive/pdf/usePdfPreviewController";

type PdfPreviewSurfaceMobileProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: (file: FileItem) => void;
  vm: PdfPreviewControllerViewModel;
  onDocumentLoadError: (message: string) => void;
};

export function PdfPreviewSurfaceMobile({
  open,
  onOpenChange,
  onDownload,
  vm,
  onDocumentLoadError,
}: PdfPreviewSurfaceMobileProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const {
    file,
    pdfData,
    error,
    loading,
    numPages,
    currentPage,
    scaledWidth,
    thumbnailWidth,
    documentAreaRef,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
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
    hasSearchQuery,
    searchMatches,
    searchResultLabel,
    canNavigateSearchMatches,
  } = vm;

  const showDownloadAction = Boolean(file && onDownload);

  const handleGoToPage = useCallback(
    (page: number) => {
      goToPage(page);
      setSidebarOpen(false);
    },
    [goToPage],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSidebarOpen(false);
        closeSearch();
      }
      onOpenChange(nextOpen);
    },
    [closeSearch, onOpenChange],
  );

  const pageCountLabel = numPages > 0 ? `${currentPage} / ${numPages}` : "—";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!fixed inset-0 top-0 left-0 flex h-[100svh] max-h-[100svh] w-full !max-w-none -translate-x-0 -translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#374151] p-0 shadow-none ring-0 supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh"
        overlayClassName="bg-[#0A0A10]/95 backdrop-blur-3xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "PDF preview"}</DialogTitle>
          <DialogDescription>
            {numPages > 0
              ? `Viewing page ${currentPage} of ${numPages}. Scroll vertically to change pages.`
              : "View PDF pages in the browser."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {error ? (
            <p className="absolute inset-0 z-20 flex items-center justify-center px-6 text-center text-sm text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          {loading && !pdfData ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-white/80">
              <Loader2 className="size-7 animate-spin" aria-hidden />
              <span className="sr-only">Loading PDF…</span>
            </div>
          ) : null}

          {pdfData && !error ? (
            <Document
              file={pdfData}
              loading={
                <div className="flex flex-1 items-center justify-center gap-2 py-12 text-sm text-white/80">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  Rendering PDF…
                </div>
              }
              onLoadSuccess={handleDocumentLoadSuccess}
              onLoadError={(loadError) => {
                onDocumentLoadError(loadError.message || "Could not open this PDF.");
              }}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <div
                ref={documentAreaRef}
                tabIndex={-1}
                onScroll={handleDocumentScroll}
                className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none scroll-smooth [touch-action:pan-y] snap-y snap-proximity"
              >
                {numPages > 0 && scaledWidth ? (
                  Array.from({ length: numPages }, (_, index) => {
                      const pageNumber = index + 1;

                      return (
                        <div
                          key={`page-${pageNumber}`}
                          data-pdf-page
                          ref={(node) => {
                            if (node) pageRefs.current.set(pageNumber, node);
                            else pageRefs.current.delete(pageNumber);
                          }}
                          className="box-border flex h-full w-full shrink-0 snap-start snap-always items-center justify-center px-3"
                        >
                          <div className="max-w-full bg-white shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                            <Page
                              pageNumber={pageNumber}
                              width={scaledWidth}
                              renderAnnotationLayer
                              renderTextLayer
                              customTextRenderer={
                                hasSearchQuery && searchMatches.length > 0 ? customTextRenderer : undefined
                              }
                              loading={
                                <div className="flex min-h-[50dvh] w-full items-center justify-center bg-white">
                                  <Loader2 className="size-6 animate-spin text-[#888888]" aria-hidden />
                                </div>
                              }
                              className={cn(loading && "opacity-70")}
                            />
                          </div>
                        </div>
                      );
                    })
                ) : numPages > 0 ? (
                  <div className="flex min-h-[50dvh] items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-white/70" aria-hidden />
                    <span className="sr-only">Sizing PDF pages…</span>
                  </div>
                ) : null}
              </div>
            </Document>
          ) : null}

          {/* Human: Top/bottom gradients — legibility for floating chrome over the page stack. */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[100px] bg-gradient-to-b from-black/80 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[100px] bg-gradient-to-t from-black/80 to-transparent"
            aria-hidden
          />

          {/* Human: Top-right page badge opens thumbnail drawer; close dismisses the viewer. */}
          <div className="absolute inset-x-0 top-0 z-30 flex items-start justify-end gap-2 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-expanded={sidebarOpen}
              aria-controls="pdf-mobile-thumbnail-drawer"
              aria-label={`Page ${pageCountLabel}. Open page thumbnails.`}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-2xl border px-2.5 text-[11px] font-bold tabular-nums text-white transition-colors",
                sidebarOpen
                  ? "border-[#2563EB] bg-[#2563EB]/20"
                  : "border-white/10 bg-black/60",
              )}
            >
              <span>{currentPage}</span>
              <span className="font-normal text-white/60">/</span>
              <span className="font-normal text-white/80">{numPages || "—"}</span>
            </button>

            <DialogClose
              render={
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-[18px] border border-white/10 bg-black/60 text-white transition-colors hover:bg-black/80"
                  aria-label="Close PDF preview"
                />
              }
            >
              <X className="size-4" aria-hidden />
            </DialogClose>
          </div>

          {/* Human: Bottom bar — filename, decrypted label, download and search actions. */}
          {file ? (
            <div className="absolute inset-x-0 bottom-0 z-30 flex items-end justify-between gap-3 px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-white">{file.name}</p>
                <p className="truncate text-[11px] text-white/60">
                  Decrypted locally · {formatBytes(file.size_bytes)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                {showDownloadAction ? (
                  <button
                    type="button"
                    onClick={() => onDownload?.(file)}
                    className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                    aria-label={`Download ${file.name}`}
                  >
                    <Download className="size-[22px]" aria-hidden />
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setSearchOpen((value) => !value)}
                  aria-label="Search in PDF"
                  aria-expanded={searchOpen}
                  className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                >
                  <Search className="size-[22px]" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {/* Human: In-document search sheet — slides above bottom bar when search icon is tapped. */}
          {searchOpen ? (
            <div className="absolute inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#111118]/95 px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Search className="size-3.5 shrink-0 text-white/60" aria-hidden />
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
                  className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-2 text-xs text-white outline-none placeholder:text-white/40 focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
                <span className="shrink-0 text-[10px] text-white/60" aria-live="polite">
                  {searchResultLabel}
                </span>
                <button
                  type="button"
                  disabled={!canNavigateSearchMatches}
                  onClick={goToPreviousSearchMatch}
                  aria-label="Previous search result"
                  className="flex size-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white disabled:opacity-40"
                >
                  <ChevronUp className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={!canNavigateSearchMatches}
                  onClick={goToNextSearchMatch}
                  aria-label="Next search result"
                  className="flex size-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white disabled:opacity-40"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={closeSearch}
                  aria-label="Close search"
                  className="flex size-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {/* Human: Left thumbnail drawer — opened from page-count badge per Pencil sidebar state. */}
          {sidebarOpen && pdfData && !error ? (
            <>
              <button
                type="button"
                className="absolute inset-0 z-40 bg-black/50"
                aria-label="Close page thumbnails"
                onClick={() => setSidebarOpen(false)}
              />
              <aside
                id="pdf-mobile-thumbnail-drawer"
                className="absolute inset-y-0 left-0 z-50 flex w-[260px] max-w-[85vw] flex-col border-r border-[#E5E7EB] bg-[#F7F8FA] shadow-[4px_0_24px_rgba(0,0,0,0.2)] pt-[max(56px,env(safe-area-inset-top))]"
              >
                <div className="flex shrink-0 items-center justify-between px-3 pb-3">
                  <p className="text-[11px] font-bold tracking-wide text-[#888888]">PAGE THUMBNAILS</p>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close page thumbnails"
                    className="rounded-md p-1 text-[#666666] hover:bg-[#E5E7EB]"
                  >
                    <PanelLeftClose className="size-4" aria-hidden />
                  </button>
                </div>

                <Document file={pdfData} loading={null} className="min-h-0 flex-1 overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
                    {numPages > 0
                      ? Array.from({ length: numPages }, (_, index) => {
                          const pageNumber = index + 1;
                          const isActive = pageNumber === currentPage;

                          return (
                            <button
                              key={`mobile-thumb-${pageNumber}`}
                              type="button"
                              ref={(node) => {
                                if (node) thumbnailRefs.current.set(pageNumber, node);
                                else thumbnailRefs.current.delete(pageNumber);
                              }}
                              onClick={() => handleGoToPage(pageNumber)}
                              aria-label={`Go to page ${pageNumber}`}
                              aria-current={isActive ? "page" : undefined}
                              className="mb-3 flex w-full flex-col items-center gap-1 last:mb-0"
                            >
                              <div
                                className={cn(
                                  "flex w-[88px] items-center justify-center rounded border bg-white p-1.5 transition-colors",
                                  isActive
                                    ? "border-2 border-[#2563EB]"
                                    : "border border-[#E5E7EB] hover:border-[#2563EB]/50",
                                )}
                              >
                                <Page
                                  pageNumber={pageNumber}
                                  width={thumbnailWidth}
                                  renderAnnotationLayer={false}
                                  renderTextLayer={false}
                                  loading={
                                    <div className="flex h-[114px] w-full items-center justify-center">
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
                </Document>
              </aside>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
