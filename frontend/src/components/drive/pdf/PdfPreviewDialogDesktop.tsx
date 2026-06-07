// Human: Desktop PDF viewer shell — Pencil Ownly Explorer PDF Viewer (thumbnails, header, zoom).
// Agent: RENDERS react-pdf Document; READS PdfPreviewControllerViewModel from usePdfPreviewController.

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
import { PDF_MAX_ZOOM, PDF_MIN_ZOOM } from "@/components/drive/pdf/pdf-preview-constants";
import type { PdfPreviewControllerViewModel } from "@/components/drive/pdf/usePdfPreviewController";

type PdfPreviewDialogDesktopProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: (file: FileItem) => void;
  vm: PdfPreviewControllerViewModel;
  onDocumentLoadError: (message: string) => void;
};

export function PdfPreviewDialogDesktop({
  open,
  onOpenChange,
  onDownload,
  vm,
  onDocumentLoadError,
}: PdfPreviewDialogDesktopProps) {
  const {
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
  } = vm;

  const showDownloadAction = Boolean(file && onDownload);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-visible border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[112.5rem]"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "PDF preview"}</DialogTitle>
          <DialogDescription>
            {numPages > 0
              ? `Viewing page ${currentPage} of ${numPages}. Scroll to change pages; Ctrl+scroll to zoom in 5% steps.`
              : "View PDF pages in the browser."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[min(1275px,135dvh)] w-full flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={zoom <= PDF_MIN_ZOOM}
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
                  disabled={zoom >= PDF_MAX_ZOOM}
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
                  onDocumentLoadError(loadError.message || "Could not open this PDF.");
                }}
                className="flex min-h-0 min-w-0 flex-1 flex-row"
              >
                <aside className="hidden w-[270px] shrink-0 flex-col border-r border-[#E5E7EB] bg-[#F7F8FA] sm:flex">
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
                                  "flex w-[150px] items-center justify-center rounded border bg-white p-2 transition-colors",
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
                                    <div className="flex h-[165px] w-full items-center justify-center">
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

                <div
                  ref={documentAreaRef}
                  tabIndex={-1}
                  onScroll={handleDocumentScroll}
                  className="relative flex min-h-0 min-w-0 flex-1 overflow-auto bg-[#374151] p-9 outline-none [touch-action:pan-x_pan-y]"
                >
                  {numPages > 0 && scaledWidth ? (
                    <div
                      className="mx-auto flex w-max min-w-full flex-col items-center"
                      style={{ gap: pageStackGapPx }}
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
                                <div className="flex min-h-[36rem] min-w-[24rem] items-center justify-center">
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
