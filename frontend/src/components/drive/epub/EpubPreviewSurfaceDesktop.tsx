// Human: Desktop EPUB reader — pen overlay card with optional TOC panel and chapter nav.
// Agent: RENDERS epub.js rendition node; READS EpubPreviewControllerViewModel.

import { useCallback, useEffect, useRef } from "react";
import { Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { EpubReaderControlBar } from "@/components/drive/epub/EpubReaderControlBar";
import type { EpubPreviewControllerViewModel } from "@/components/drive/epub/useEpubPreviewController";
import {
  EPUB_READER_CHAPTER_NAV_BUTTON_CLASS,
  EPUB_READER_CLOSE_BUTTON_CLASS,
  EPUB_READER_META_PILL_CLASS,
  EPUB_READER_PAPER_BG,
} from "@/components/drive/epub/epub-reader-tokens";
import { cn } from "@/lib/utils";

type EpubPreviewSurfaceDesktopProps = {
  onOpenChange: (open: boolean) => void;
  onDownload?: (file: FileItem) => void;
  vm: EpubPreviewControllerViewModel;
};

export function EpubPreviewSurfaceDesktop({
  onOpenChange,
  onDownload,
  vm,
}: EpubPreviewSurfaceDesktopProps) {
  const renditionHostRef = useRef<HTMLDivElement | null>(null);
  const {
    file,
    loading,
    error,
    tocOpen,
    setTocOpen,
    tocEntries,
    currentHref,
    chapterLabel,
    goToTocEntry,
    goNextChapter,
    goPreviousChapter,
    attachRendition,
    bookReady,
    currentSpineIndex,
    totalSpineItems,
  } = vm;

  const setRenditionHost = useCallback(
    (node: HTMLDivElement | null) => {
      renditionHostRef.current = node;
      attachRendition(node);
    },
    [attachRendition],
  );

  useEffect(() => {
    if (!bookReady) return;
    attachRendition(renditionHostRef.current);
  }, [attachRendition, bookReady, file?.id]);

  const canGoPrevious = currentSpineIndex > 0;
  const canGoNext = totalSpineItems > 0 && currentSpineIndex < totalSpineItems - 1;

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center px-4 py-6">
      {tocOpen ? (
        <aside className="absolute left-4 top-[4.375rem] z-20 flex h-[calc(100%-5.5rem)] w-[21.25rem] flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Table of Contents</h2>
            <button type="button" aria-label="Close table of contents" onClick={() => setTocOpen(false)}>
              <X className="size-5 text-muted-foreground" />
            </button>
          </div>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
            <span>Search chapters...</span>
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tocEntries.map((entry) => {
              const active = currentHref?.includes(entry.href);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(
                    "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                    active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60",
                  )}
                  style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
                  onClick={() => goToTocEntry(entry)}
                >
                  {active ? <span className="h-5 w-0.5 rounded-full bg-[#2563EB]" /> : null}
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>
        </aside>
      ) : null}

      <button
        type="button"
        className={cn(EPUB_READER_CHAPTER_NAV_BUTTON_CLASS, "absolute left-4 z-10")}
        aria-label="Previous chapter"
        disabled={!canGoPrevious}
        onClick={goPreviousChapter}
      >
        <span className="text-3xl">‹</span>
      </button>

      <section
        className="relative z-10 flex h-[55rem] max-h-[calc(100vh-8rem)] w-full max-w-[73.75rem] flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ backgroundColor: EPUB_READER_PAPER_BG }}
      >
        <header className="flex items-center justify-between gap-4 px-6 py-4">
          <div className={EPUB_READER_META_PILL_CLASS}>
            <span className="text-sm font-semibold">
              {file?.name ?? "EPUB"} • {chapterLabel}
            </span>
            <div className="flex items-center gap-2 border-l border-white/20 pl-3">
              {onDownload && file ? (
                <button type="button" aria-label="Download" onClick={() => onDownload(file)}>
                  <Download className="size-5" />
                </button>
              ) : null}
              <button type="button" aria-label="Share" title="Share from drive menu">
                <Share2 className="size-5" />
              </button>
            </div>
          </div>
          <button type="button" className={EPUB_READER_CLOSE_BUTTON_CLASS} aria-label="Close reader" onClick={() => onOpenChange(false)}>
            <X className="size-7" />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 px-8 pb-28">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              Loading EPUB…
            </div>
          ) : null}
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
          ) : null}
          <div ref={setRenditionHost} className={cn("h-full w-full", (loading || error) && "hidden")} />
        </div>

        <div className="absolute inset-x-6 bottom-6">
          <EpubReaderControlBar vm={vm} />
        </div>
      </section>

      <button
        type="button"
        className={cn(EPUB_READER_CHAPTER_NAV_BUTTON_CLASS, "absolute right-4 z-10")}
        aria-label="Next chapter"
        disabled={!canGoNext}
        onClick={goNextChapter}
      >
        <span className="text-3xl">›</span>
      </button>
    </div>
  );
}
