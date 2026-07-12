// Human: Pure EPUB navigation helpers — flatten TOC trees and compute chapter progress labels.
// Agent: READS spine/TOC metadata; RETURNS indices and labels for useEpubPreviewController.

import type { EpubTocEntry } from "@/components/drive/epub/epub-preview-types";

export type EpubNavItem = {
  id?: string;
  label?: string;
  href?: string;
  subitems?: EpubNavItem[];
};

export function clampSpineIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, index));
}

export function computeChapterProgress(currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (currentIndex + 1) / total));
}

export function formatChapterProgressLabel(currentIndex: number, total: number): string {
  if (total <= 0) return "Page 0 of 0";
  return `Page ${currentIndex + 1} of ${total}`;
}

/** Human: Compact page indicator above the desktop control bar (pen: "42 / 318"). */
export function formatChapterProgressCompact(currentIndex: number, total: number): string {
  if (total <= 0) return "0 / 0";
  return `${currentIndex + 1} / ${total}`;
}

/** Human: Flatten nested navigation.toc into a single list with depth for indentation. */
export function flattenEpubToc(items: EpubNavItem[], depth = 0): EpubTocEntry[] {
  const entries: EpubTocEntry[] = [];

  for (const item of items) {
    const href = (item.href ?? "").trim();
    const label = (item.label ?? "").trim();
    if (href && label) {
      entries.push({
        id: item.id ?? `${depth}-${href}-${label}`,
        label,
        href,
        depth,
      });
    }

    if (item.subitems?.length) {
      entries.push(...flattenEpubToc(item.subitems, depth + 1));
    }
  }

  return entries;
}

/** Human: Resolve the best chapter title for the current spine position. */
export function resolveChapterLabel(
  tocEntries: EpubTocEntry[],
  currentHref: string | null,
  fallbackIndex: number,
): string {
  if (currentHref) {
    const normalized = normalizeHref(currentHref);
    const match = [...tocEntries]
      .reverse()
      .find((entry) => normalized.startsWith(normalizeHref(entry.href)) || normalizeHref(entry.href).startsWith(normalized));
    if (match) return match.label;
  }

  return `Chapter ${fallbackIndex + 1}`;
}

function normalizeHref(href: string): string {
  return href.split("#")[0]?.trim().toLowerCase() ?? "";
}
