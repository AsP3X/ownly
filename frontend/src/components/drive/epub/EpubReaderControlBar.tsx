// Human: Bottom control bar for EPUB reader — TOC, progress, font, and theme controls.
// Agent: READS EpubPreviewControllerViewModel; CALLS preference setters; desktop layout matches pen Control Bar.

import {
  Bookmark,
  List,
  Minus,
  Moon,
  Plus,
  Sun,
  Type,
} from "lucide-react";
import type { EpubPreviewControllerViewModel } from "@/components/drive/epub/useEpubPreviewController";
import {
  EPUB_READER_ACCENT,
  EPUB_READER_BOTTOM_BAR_CLASS,
} from "@/components/drive/epub/epub-reader-tokens";
import type { EpubReaderFontSize, EpubReaderTheme } from "@/lib/epub-reader-preference";
import { cn } from "@/lib/utils";

type EpubReaderControlBarProps = {
  vm: EpubPreviewControllerViewModel;
  compact?: boolean;
  onOpenSettings?: () => void;
};

const FONT_ORDER: EpubReaderFontSize[] = ["small", "medium", "large"];
const THEME_ORDER: EpubReaderTheme[] = ["light", "sepia", "dark"];

function cycleFontSize(current: EpubReaderFontSize, direction: 1 | -1): EpubReaderFontSize {
  const index = FONT_ORDER.indexOf(current);
  const next = Math.min(FONT_ORDER.length - 1, Math.max(0, index + direction));
  return FONT_ORDER[next] ?? current;
}

function cycleTheme(current: EpubReaderTheme, direction: 1 | -1): EpubReaderTheme {
  const index = THEME_ORDER.indexOf(current);
  const next = Math.min(THEME_ORDER.length - 1, Math.max(0, index + direction));
  return THEME_ORDER[next] ?? current;
}

export function EpubReaderControlBar({ vm, compact = false, onOpenSettings }: EpubReaderControlBarProps) {
  const { progressFraction, progressLabel, preferences, setPreferences, toggleToc } = vm;

  if (compact) {
    return (
      <div className={cn(EPUB_READER_BOTTOM_BAR_CLASS, "h-20 px-4")}>
        <div className="flex items-center gap-4">
          <button type="button" className="opacity-90 transition hover:opacity-100" aria-label="Table of contents" onClick={toggleToc}>
            <List className="size-5" />
          </button>
          <span className="text-xs text-white/80">{progressLabel}</span>
        </div>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.round(progressFraction * 100)}%`, backgroundColor: EPUB_READER_ACCENT }}
          />
        </div>
        <button
          type="button"
          className="opacity-90 transition hover:opacity-100"
          aria-label="Text settings"
          onClick={onOpenSettings}
        >
          <Type className="size-5" />
        </button>
      </div>
    );
  }

  // Human: Desktop pen layout — left icon cluster, center progress rail, right typography/theme cluster.
  // Agent: NO chapter chevrons here; chapter nav lives on flanking overlay buttons.
  return (
    <div className={EPUB_READER_BOTTOM_BAR_CLASS}>
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" className="opacity-90 transition hover:opacity-100" aria-label="Table of contents" onClick={toggleToc}>
          <List className="size-5" />
        </button>
        <button type="button" className="opacity-90 transition hover:opacity-100" aria-label="Bookmark" title="Bookmarks coming soon">
          <Bookmark className="size-5" />
        </button>
        <button
          type="button"
          className="opacity-90 transition hover:opacity-100"
          aria-label="Text settings"
          onClick={onOpenSettings}
        >
          <Type className="size-5" />
        </button>
        <span className="hidden whitespace-nowrap text-xs font-normal text-white/90 sm:inline">{progressLabel}</span>
      </div>

      <div className="flex h-5 min-w-0 flex-1 items-center justify-center px-3">
        <div className="h-1 w-full max-w-[20rem] overflow-hidden rounded-full bg-[#FFFFFF33]">
          <div
            className="h-full rounded-sm transition-all"
            style={{ width: `${Math.round(progressFraction * 100)}%`, backgroundColor: EPUB_READER_ACCENT }}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="opacity-90 transition hover:opacity-100"
          aria-label="Decrease font size"
          onClick={() => setPreferences({ ...preferences, fontSize: cycleFontSize(preferences.fontSize, -1) })}
        >
          <Minus className="size-5" />
        </button>
        <button
          type="button"
          className="opacity-90 transition hover:opacity-100"
          aria-label="Increase font size"
          onClick={() => setPreferences({ ...preferences, fontSize: cycleFontSize(preferences.fontSize, 1) })}
        >
          <Plus className="size-5" />
        </button>
        <button
          type="button"
          className="opacity-90 transition hover:opacity-100"
          aria-label="Light theme"
          onClick={() => setPreferences({ ...preferences, theme: "light" })}
        >
          <Sun className="size-5" />
        </button>
        <button
          type="button"
          className="opacity-90 transition hover:opacity-100"
          aria-label="Dark theme"
          onClick={() => setPreferences({ ...preferences, theme: cycleTheme(preferences.theme, 1) })}
        >
          <Moon className="size-5" />
        </button>
      </div>
    </div>
  );
}
