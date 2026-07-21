// Human: Mobile EPUB reader — fullscreen pen layout with header, progress bar, TOC, and settings.
// Agent: RENDERS epub.js rendition node; READS EpubPreviewControllerViewModel; TOC via EpubReaderTocSheet.

import { useEffect, useState } from "react";
import { ChevronLeft, Ellipsis, Loader2 } from "lucide-react";
import { EpubReaderControlBar } from "@/components/drive/epub/EpubReaderControlBar";
import { EpubReaderSettingsSheet } from "@/components/drive/epub/EpubReaderSettingsSheet";
import { EpubReaderTocSheet } from "@/components/drive/epub/EpubReaderTocSheet";
import type { EpubPreviewControllerViewModel } from "@/components/drive/epub/useEpubPreviewController";
import { EPUB_READER_PAPER_BG } from "@/components/drive/epub/epub-reader-tokens";

import "./epub-reader-rendition.css";

type EpubPreviewSurfaceMobileProps = {
  onOpenChange: (open: boolean) => void;
  vm: EpubPreviewControllerViewModel;
};

export function EpubPreviewSurfaceMobile({ onOpenChange, vm }: EpubPreviewSurfaceMobileProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    file,
    loading,
    error,
    chapterLabel,
    registerRenditionHost,
    preferences,
    setPreferences,
    progressFraction,
    progressLabel,
    canRenderRendition,
    tocOpen,
    setTocOpen,
    tocEntries,
    currentHref,
    goToTocEntry,
  } = vm;

  // Human: Only one mobile sheet at a time — TOC and settings share the bottom overlay area.
  useEffect(() => {
    if (tocOpen) setSettingsOpen(false);
  }, [tocOpen]);

  function openSettings() {
    setTocOpen(false);
    setSettingsOpen(true);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" style={{ backgroundColor: EPUB_READER_PAPER_BG }}>
      <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
        <button type="button" aria-label="Close reader" onClick={() => onOpenChange(false)}>
          <ChevronLeft className="size-5 text-foreground" />
        </button>
        <p className="max-w-[60%] truncate text-sm font-semibold text-foreground">{file?.name ?? "EPUB"}</p>
        <button type="button" aria-label="More actions" onClick={openSettings}>
          <Ellipsis className="size-5 text-foreground" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Loading…
          </div>
        ) : null}
        {error ? <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div> : null}
        {canRenderRendition ? (
          <div ref={registerRenditionHost} className="epub-reader-rendition h-full w-full" />
        ) : null}
      </div>

      <footer className="border-t border-border bg-background px-4 py-3">
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${Math.round(progressFraction * 100)}%` }} />
        </div>
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate pr-2">{chapterLabel}</span>
          <span className="shrink-0">{progressLabel}</span>
        </div>
        <EpubReaderControlBar vm={vm} compact onOpenSettings={openSettings} />
      </footer>

      <EpubReaderTocSheet
        open={tocOpen}
        entries={tocEntries}
        currentHref={currentHref}
        onClose={() => setTocOpen(false)}
        onSelectEntry={goToTocEntry}
      />

      <EpubReaderSettingsSheet
        open={settingsOpen}
        preferences={preferences}
        onClose={() => setSettingsOpen(false)}
        onChange={setPreferences}
      />
    </div>
  );
}
