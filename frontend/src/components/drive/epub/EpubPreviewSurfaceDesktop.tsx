// Human: Desktop EPUB reader — pen Viewport Row with flanking chapter nav and absolute chrome on reader card.
// Agent: RENDERS epub.js rendition node; READS EpubPreviewControllerViewModel; MATCHES docs/design/epub-reader.pen.

import { useCallback, useEffect, useRef } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { EpubReaderControlBar } from "@/components/drive/epub/EpubReaderControlBar";
import type { EpubPreviewControllerViewModel } from "@/components/drive/epub/useEpubPreviewController";
import {
  EPUB_READER_CHAPTER_NAV_BUTTON_CLASS,
  EPUB_READER_CLOSE_BUTTON_CLASS,
  EPUB_READER_META_PILL_CLASS,
  EPUB_READER_PAPER_BG,
  EPUB_READER_SURFACE_CLASS,
  EPUB_READER_TEXT_MUTED,
} from "@/components/drive/epub/epub-reader-tokens";
import { cn } from "@/lib/utils";

import "./epub-reader-rendition.css";

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
    progressCompactLabel,
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
    <div className="flex h-full min-h-0 w-full items-center justify-center px-4 py-[4.375rem]">
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

      {/* Human: Pen Viewport Row — prev nav, reader card, next nav with 24px gaps. */}
      <div className="flex w-full max-w-[88rem] items-center justify-center gap-6">
        <button
          type="button"
          className={EPUB_READER_CHAPTER_NAV_BUTTON_CLASS}
          aria-label="Previous chapter"
          disabled={!canGoPrevious}
          onClick={goPreviousChapter}
        >
          <ChevronLeft className="size-10" aria-hidden />
        </button>

        <section
          className={cn(
            EPUB_READER_SURFACE_CLASS,
            "h-[55.3125rem] max-h-[calc(100dvh-8.75rem)] min-h-[32rem]",
          )}
          style={{ backgroundColor: EPUB_READER_PAPER_BG }}
        >
          {/* Human: Meta pill floats top-left inside the reader card (pen Meta Pill). */}
          <div className={cn(EPUB_READER_META_PILL_CLASS, "absolute left-6 top-6 z-20 max-w-[calc(100%-7.5rem)]")}>
            <span className="truncate text-base font-bold">
              {file?.name ?? "EPUB"} • {chapterLabel}
            </span>
            <div className="flex shrink-0 items-center gap-2 border-l border-white/20 pl-3">
              {onDownload && file ? (
                <button type="button" className="rounded-md p-1 opacity-90 hover:opacity-100" aria-label="Download" onClick={() => onDownload(file)}>
                  <Download className="size-5" />
                </button>
              ) : null}
              <button type="button" className="rounded-md p-1 opacity-90 hover:opacity-100" aria-label="Share" title="Share from drive menu">
                <Share2 className="size-5" />
              </button>
              <button type="button" className="rounded-md p-1 opacity-90 hover:opacity-100" aria-label="Bookmark" title="Bookmarks coming soon">
                <Bookmark className="size-5" />
              </button>
            </div>
          </div>

          {/* Human: Close control sits top-right inside the card, separate from the meta pill. */}
          <button
            type="button"
            className={cn(EPUB_READER_CLOSE_BUTTON_CLASS, "absolute right-6 top-6 z-20")}
            aria-label="Close reader"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-7" aria-hidden />
          </button>

          {/* Human: Reading Area — 940×640 centered band below top chrome (pen oExLx). */}
          <div className="absolute inset-x-[7.5rem] top-24 bottom-[8.75rem]">
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-5 animate-spin" />
                Loading EPUB…
              </div>
            ) : null}
            {error ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
            ) : null}
            <div
              ref={setRenditionHost}
              className={cn("epub-reader-rendition h-full w-full", (loading || error) && "hidden")}
            />
          </div>

          {/* Human: Compact page indicator centered above the bottom bar (pen qiu4Q). */}
          {!loading && !error ? (
            <p
              className="absolute bottom-[7.75rem] left-1/2 z-10 -translate-x-1/2 text-[0.8125rem] font-medium"
              style={{ color: EPUB_READER_TEXT_MUTED }}
            >
              {progressCompactLabel}
            </p>
          ) : null}

          {/* Human: Bottom Controls Wrap inset 24px from card edges (pen Wd9q5). */}
          <div className="absolute inset-x-6 bottom-6 z-20">
            <EpubReaderControlBar vm={vm} />
          </div>
        </section>

        <button
          type="button"
          className={EPUB_READER_CHAPTER_NAV_BUTTON_CLASS}
          aria-label="Next chapter"
          disabled={!canGoNext}
          onClick={goNextChapter}
        >
          <ChevronRight className="size-10" aria-hidden />
        </button>
      </div>
    </div>
  );
}
