// Human: Case-insensitive PDF text search — partial words, digits, and symbols via substring match.
// Agent: READS PDFDocumentProxy pages via getTextContent; RETURNS match ranges for customTextRenderer highlights.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "react-pdf";

export type PdfSearchMatch = {
  matchIndex: number;
  pageNumber: number;
  startItemIndex: number;
  startOffsetInItem: number;
  endItemIndex: number;
  /** Exclusive end offset within the end text item's str. */
  endOffsetInItem: number;
};

export const PDF_SEARCH_HIGHLIGHT_CLASS = "pdf-search-highlight";
export const PDF_SEARCH_ACTIVE_CLASS = "pdf-search-highlight-active";

type HighlightRange = {
  start: number;
  end: number;
  active: boolean;
};

// Human: Trim query only — matching is case-insensitive so letter casing in input does not matter.
// Agent: RETURNS trimmed raw query; empty string means no search.
export function normalizePdfSearchQuery(query: string): string {
  return query.trim();
}

// Human: Map a character index in concatenated page text back to its source text-item index.
// Agent: READS itemStarts offsets; RETURNS item index containing charPosition.
function findItemIndexForCharPosition(itemStarts: number[], charPosition: number): number {
  for (let index = itemStarts.length - 1; index >= 0; index -= 1) {
    if (itemStarts[index]! <= charPosition) {
      return index;
    }
  }
  return 0;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Human: Scan every page for all case-insensitive substring occurrences of the query.
// Agent: CALLS pdf.getPage + getTextContent per page; SUPPORTS AbortSignal for stale searches.
export async function searchPdfDocument(
  pdf: PDFDocumentProxy,
  rawQuery: string,
  signal?: AbortSignal,
): Promise<PdfSearchMatch[]> {
  const query = normalizePdfSearchQuery(rawQuery);
  if (!query) return [];

  const lowerQuery = query.toLowerCase();
  const matches: PdfSearchMatch[] = [];
  let matchIndex = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (signal?.aborted) return matches;

    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(
      (item): item is TextItem => "str" in item && typeof item.str === "string",
    );

    let pageText = "";
    const itemStarts: number[] = [];
    for (const item of items) {
      itemStarts.push(pageText.length);
      pageText += item.str;
    }

    const lowerPageText = pageText.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerPageText.length) {
      const matchStart = lowerPageText.indexOf(lowerQuery, searchFrom);
      if (matchStart === -1) break;

      const matchEnd = matchStart + lowerQuery.length;
      const startItemIndex = findItemIndexForCharPosition(itemStarts, matchStart);
      const endItemIndex = findItemIndexForCharPosition(itemStarts, matchEnd - 1);

      matches.push({
        matchIndex,
        pageNumber,
        startItemIndex,
        startOffsetInItem: matchStart - itemStarts[startItemIndex]!,
        endItemIndex,
        endOffsetInItem: matchEnd - itemStarts[endItemIndex]!,
      });

      matchIndex += 1;
      searchFrom = matchStart + 1;
    }
  }

  return matches;
}

function getHighlightRangesForItem(
  pageNumber: number,
  itemIndex: number,
  strLength: number,
  matches: PdfSearchMatch[],
  activeMatchIndex: number,
): HighlightRange[] {
  const ranges: HighlightRange[] = [];

  for (const match of matches) {
    if (match.pageNumber !== pageNumber) continue;
    if (itemIndex < match.startItemIndex || itemIndex > match.endItemIndex) continue;

    const start =
      itemIndex === match.startItemIndex ? match.startOffsetInItem : 0;
    const end = itemIndex === match.endItemIndex ? match.endOffsetInItem : strLength;

    if (start >= end) continue;

    ranges.push({
      start,
      end,
      active: match.matchIndex === activeMatchIndex,
    });
  }

  return ranges.sort((left, right) => left.start - right.start);
}

function applyHighlightRanges(str: string, ranges: HighlightRange[]): string {
  if (ranges.length === 0) return str;

  let output = "";
  let cursor = 0;

  for (const range of ranges) {
    const clampedStart = Math.max(0, Math.min(range.start, str.length));
    const clampedEnd = Math.max(clampedStart, Math.min(range.end, str.length));

    if (clampedStart > cursor) {
      output += escapeHtml(str.slice(cursor, clampedStart));
    }

    const highlightClass = range.active
      ? PDF_SEARCH_ACTIVE_CLASS
      : PDF_SEARCH_HIGHLIGHT_CLASS;
    output += `<mark class="${highlightClass}">${escapeHtml(str.slice(clampedStart, clampedEnd))}</mark>`;
    cursor = clampedEnd;
  }

  if (cursor < str.length) {
    output += escapeHtml(str.slice(cursor));
  }

  return output;
}

// Human: Inject <mark> wrappers for react-pdf customTextRenderer when a query is active.
// Agent: READS pageNumber + itemIndex + matches; RETURNS HTML string for one text layer span.
export function renderPdfSearchTextItem(
  str: string,
  pageNumber: number,
  itemIndex: number,
  matches: PdfSearchMatch[],
  activeMatchIndex: number,
): string {
  if (matches.length === 0) return str;

  const ranges = getHighlightRangesForItem(
    pageNumber,
    itemIndex,
    str.length,
    matches,
    activeMatchIndex,
  );

  if (ranges.length === 0) return str;
  return applyHighlightRanges(str, ranges);
}

// Human: Scroll the active match mark into view inside the document pane.
// Agent: QUERIES mark.pdf-search-highlight-active within pageRefs; CALLS scrollIntoView.
export function scrollToPdfSearchMatch(
  pageRefs: Map<number, HTMLElement>,
  match: PdfSearchMatch | undefined,
): void {
  if (!match) return;

  const pageElement = pageRefs.get(match.pageNumber);
  if (!pageElement) return;

  const activeMark = pageElement.querySelector(`mark.${PDF_SEARCH_ACTIVE_CLASS}`);
  if (activeMark instanceof HTMLElement) {
    activeMark.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  pageElement.scrollIntoView({ block: "center", behavior: "smooth" });
}
