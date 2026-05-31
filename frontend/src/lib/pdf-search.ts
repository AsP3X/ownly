// Human: Case-insensitive fuzzy PDF text search — query tokens match in order with gaps between them.
// Agent: READS PDFDocumentProxy pages via getTextContent; RETURNS contiguous highlight spans per match.

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

// Human: Split the query into whitespace-separated tokens for ordered fuzzy matching.
// Agent: RETURNS lowercased non-empty tokens; "my is" → ["my", "is"].
function tokenizePdfSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

type FuzzyTextSpan = {
  start: number;
  end: number;
};

// Human: Max characters allowed between consecutive query tokens — rejects cross-paragraph chains.
// Agent: USED by findFuzzyQueryMatches; "my name is" gap is ~6 chars; paragraph gaps are hundreds.
const MAX_INTER_TOKEN_GAP_CHARS = 20;

function isWordCharacter(character: string): boolean {
  return /[a-z0-9]/i.test(character);
}

// Human: Match a token as a whole word so "is" does not match inside "this" or "visa".
// Agent: READS lowerPageText from fromIndex; RETURNS index of next word-bounded occurrence.
function findWordBoundedToken(
  lowerPageText: string,
  token: string,
  fromIndex: number,
): number {
  if (!token) return -1;

  let searchFrom = fromIndex;
  while (searchFrom <= lowerPageText.length - token.length) {
    const matchIndex = lowerPageText.indexOf(token, searchFrom);
    if (matchIndex === -1) return -1;

    const charBefore = matchIndex > 0 ? lowerPageText[matchIndex - 1]! : "";
    const charAfter =
      matchIndex + token.length < lowerPageText.length
        ? lowerPageText[matchIndex + token.length]!
        : "";

    if (!isWordCharacter(charBefore) && !isWordCharacter(charAfter)) {
      return matchIndex;
    }

    searchFrom = matchIndex + 1;
  }

  return -1;
}

// Human: Drop spans swallowed by a shorter overlapping match — avoids duplicate yellow bands.
// Agent: FILTERS spans dominated by a tighter overlapping span.
function filterOverlappingSpans(spans: FuzzyTextSpan[]): FuzzyTextSpan[] {
  if (spans.length <= 1) return spans;

  const sorted = [...spans].sort((left, right) => {
    const leftLength = left.end - left.start;
    const rightLength = right.end - right.start;
    if (leftLength !== rightLength) return leftLength - rightLength;
    return left.start - right.start;
  });

  const kept: FuzzyTextSpan[] = [];
  for (const span of sorted) {
    const swallowedByShorter = kept.some(
      (other) =>
        other.start <= span.start &&
        other.end >= span.end &&
        (other.end - other.start) < (span.end - span.start),
    );
    if (swallowedByShorter) continue;

    for (let index = kept.length - 1; index >= 0; index -= 1) {
      const other = kept[index]!;
      if (
        span.start <= other.start &&
        span.end >= other.end &&
        (span.end - span.start) < (other.end - other.start)
      ) {
        kept.splice(index, 1);
      }
    }

    kept.push(span);
  }

  return kept.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return left.end - left.start - (right.end - right.start);
  });
}

// Human: Find spans where every token appears in order as whole words with bounded gaps.
// Agent: READS lowerPageText + tokens; RETURNS start/end e.g. "my is sabine vorberg" → "my name is sabine vorberg".
function findFuzzyQueryMatches(lowerPageText: string, tokens: string[]): FuzzyTextSpan[] {
  if (tokens.length === 0) return [];

  const spans: FuzzyTextSpan[] = [];
  const firstToken = tokens[0]!;
  let searchStart = 0;

  while (searchStart < lowerPageText.length) {
    const matchStart = findWordBoundedToken(lowerPageText, firstToken, searchStart);
    if (matchStart === -1) break;

    let matchEnd = matchStart + firstToken.length;
    let allTokensMatched = true;

    for (let tokenIndex = 1; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]!;
      const nextTokenStart = findWordBoundedToken(lowerPageText, token, matchEnd);
      if (nextTokenStart === -1) {
        allTokensMatched = false;
        break;
      }

      const gapChars = nextTokenStart - matchEnd;
      if (gapChars > MAX_INTER_TOKEN_GAP_CHARS) {
        allTokensMatched = false;
        break;
      }

      matchEnd = nextTokenStart + token.length;
    }

    if (allTokensMatched) {
      spans.push({ start: matchStart, end: matchEnd });
    }

    searchStart = matchStart + 1;
  }

  return filterOverlappingSpans(spans);
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

// Human: Scan every page for fuzzy token matches — each hit highlights the full spanning text.
// Agent: CALLS pdf.getPage + getTextContent per page; SUPPORTS AbortSignal for stale searches.
export async function searchPdfDocument(
  pdf: PDFDocumentProxy,
  rawQuery: string,
  signal?: AbortSignal,
): Promise<PdfSearchMatch[]> {
  const query = normalizePdfSearchQuery(rawQuery);
  if (!query) return [];

  const tokens = tokenizePdfSearchQuery(query);
  if (tokens.length === 0) return [];

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

    const fuzzySpans = findFuzzyQueryMatches(pageText.toLowerCase(), tokens);

    for (const span of fuzzySpans) {
      const startItemIndex = findItemIndexForCharPosition(itemStarts, span.start);
      const endItemIndex = findItemIndexForCharPosition(itemStarts, span.end - 1);

      matches.push({
        matchIndex,
        pageNumber,
        startItemIndex,
        startOffsetInItem: span.start - itemStarts[startItemIndex]!,
        endItemIndex,
        endOffsetInItem: span.end - itemStarts[endItemIndex]!,
      });

      matchIndex += 1;
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
