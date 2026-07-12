// Human: Desktop EPUB reader — centered card with overlay chapter nav on the scrim.
// Agent: RENDERS epub.js rendition node; READS EpubPreviewControllerViewModel.

import { Loader2, Bookmark, ChevronLeft, ChevronRight, Download, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { EpubReaderControlBar } from "@/components/drive/epub/EpubReaderControlBar";
import type { EpubPreviewControllerViewModel } from "@/components/drive/epub/useEpubPreviewController";
import {
  EPUB_READER_CHAPTER_NAV_BUTTON_CLASS,
  EPUB_READER_CLOSE_BUTTON_CLASS,
  EPUB_READER_DESKTOP_CHAPTER_NAV_NEXT_CLASS,
  EPUB_READER_DESKTOP_CHAPTER_NAV_PREV_CLASS,
  EPUB_READER_DESKTOP_VIEWPORT_CLASS,
  EPUB_READER_META_PILL_CLASS,
  EPUB_READER_PAPER_BG,
  EPUB_READER_SURFACE_CLASS,
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
    registerRenditionHost,
    currentSpineIndex,
    totalSpineItems,
    canRenderRendition,
  } = vm;

  const canGoPrevious = currentSpineIndex > 0;
  const canGoNext = totalSpineItems > 0 && currentSpineIndex < totalSpineItems - 1;

  return (
    <div className={EPUB_READER_DESKTOP_VIEWPORT_CLASS}>
      {tocOpen ? (
        <aside className="absolute left-2 top-2 z-40 flex h-[calc(100%-1rem)] w-[18rem] flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Table of Contents</h2>
            <button type="button" aria-label="Close table of contents" onClick={() => setTocOpen(false)}>
              <X className="size-5 text-muted-foreground" />
            </button>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
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
        className={cn(EPUB_READER_CHAPTER_NAV_BUTTON_CLASS, EPUB_READER_DESKTOP_CHAPTER_NAV_PREV_CLASS)}
        aria-label="Previous chapter"
        disabled={!canGoPrevious}
        onClick={goPreviousChapter}
      >
        <ChevronLeft className="size-7" aria-hidden />
      </button>

      <section
        className={cn(EPUB_READER_SURFACE_CLASS, "h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)]")}
        style={{ backgroundColor: EPUB_READER_PAPER_BG }}
      >
        <div className="relative z-20 flex shrink-0 items-start justify-between gap-3 px-3 pt-3">
          <div className={EPUB_READER_META_PILL_CLASS}>
            <span className="truncate font-semibold">
              {file?.name ?? "EPUB"} • {chapterLabel}
            </span>
            <div className="flex shrink-0 items-center gap-1 border-l border-white/20 pl-2">
              {onDownload && file ? (
                <button type="button" className="rounded-md p-1 opacity-90 hover:opacity-100" aria-label="Download" onClick={() => onDownload(file)}>
                  <Download className="size-4" />
                </button>
              ) : null}
              <button type="button" className="rounded-md p-1 opacity-90 hover:opacity-100" aria-label="Share" title="Share from drive menu">
                <Share2 className="size-4" />
              </button>
              <button type="button" className="rounded-md p-1 opacity-90 hover:opacity-100" aria-label="Bookmark" title="Bookmarks coming soon">
                <Bookmark className="size-4" />
              </button>
            </div>
          </div>

          <button
            type="button"
            className={EPUB_READER_CLOSE_BUTTON_CLASS}
            aria-label="Close reader"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 px-2 pb-1 pt-2">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              Loading EPUB…
            </div>
          ) : null}
          {error ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive">{error}</div>
          ) : null}
          {canRenderRendition ? (
            <div ref={registerRenditionHost} className="epub-reader-rendition h-full w-full" />
          ) : null}
        </div>

        <div className="shrink-0 px-3 pb-3 pt-1">
          <EpubReaderControlBar vm={vm} />
        </div>
      </section>

      <button
        type="button"
        className={cn(EPUB_READER_CHAPTER_NAV_BUTTON_CLASS, EPUB_READER_DESKTOP_CHAPTER_NAV_NEXT_CLASS)}
        aria-label="Next chapter"
        disabled={!canGoNext}
        onClick={goNextChapter}
      >
        <ChevronRight className="size-7" aria-hidden />
      </button>
    </div>
  );
}
