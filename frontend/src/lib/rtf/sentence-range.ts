// Human: Map caret/selection to sentence ranges for exclusive collab locks.
// Agent: PURE helpers over plain text; USED by useDocumentCollab + RTF surface.

// Human: Collapse editor HTML to plain text for offset-based locks and ops.
// Agent: STRIPS tags; DECODES common entities; RETURNS plain string.
export function htmlToPlainText(html: string): string {
  if (typeof document !== "undefined") {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el.innerText.replace(/\u00a0/g, " ");
  }
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// Human: Expand a caret (or selection) to the enclosing sentence [start, end).
// Agent: SCANS for .!? or newlines as boundaries; CLAMPS to text length.
export function sentenceRangeAround(
  text: string,
  caretStart: number,
  caretEnd: number = caretStart,
): { start: number; end: number } {
  const len = text.length;
  if (len === 0) return { start: 0, end: 0 };
  let start = Math.max(0, Math.min(caretStart, len));
  let end = Math.max(start, Math.min(caretEnd, len));

  const isBoundary = (ch: string) => ch === "." || ch === "!" || ch === "?" || ch === "\n";

  while (start > 0 && !isBoundary(text[start - 1]!)) {
    start -= 1;
  }
  // Skip leading whitespace after boundary
  while (start < len && /\s/.test(text[start]!)) {
    start += 1;
  }

  while (end < len && !isBoundary(text[end]!)) {
    end += 1;
  }
  // Include trailing sentence punctuation
  if (end < len && isBoundary(text[end]!)) {
    end += 1;
  }

  if (end <= start) {
    // Fallback: word or single char
    end = Math.min(len, start + 1);
  }
  return { start, end };
}

// Human: True when [a,b) overlaps [c,d).
// Agent: PURE interval overlap.
export function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  return a < d && b > c;
}
