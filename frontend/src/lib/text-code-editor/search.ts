// Human: In-editor find/replace helpers for the floating search panel in the code editor dialog.
// Agent: READS source + query; RETURNS match ranges and navigation indices.

export type TextSearchMatch = {
  start: number;
  end: number;
  line: number;
  column: number;
};

// Human: Collect every non-overlapping match for find/replace navigation.
// Agent: SCANS source with RegExp; RETURNS ordered TextSearchMatch[] with 1-based line/col.
export function findTextMatches(
  source: string,
  query: string,
  caseSensitive: boolean,
): TextSearchMatch[] {
  if (!query) return [];

  const flags = caseSensitive ? "g" : "gi";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, flags);
  const matches: TextSearchMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = source.slice(0, start);
    const line = before.split("\n").length;
    const column = (before.split("\n").pop()?.length ?? 0) + 1;
    matches.push({ start, end, line, column });
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  return matches;
}

// Human: Replace the match at index, or all matches when replaceAll is true.
// Agent: WRITES new string; RETURNS { nextValue, replacedCount }.
export function applyTextReplacement(
  source: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
  matchIndex: number,
  replaceAll: boolean,
): { nextValue: string; replacedCount: number } {
  const matches = findTextMatches(source, query, caseSensitive);
  if (matches.length === 0) {
    return { nextValue: source, replacedCount: 0 };
  }

  if (replaceAll) {
    const flags = caseSensitive ? "g" : "gi";
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, flags);
    const nextValue = source.replace(regex, replacement);
    return { nextValue, replacedCount: matches.length };
  }

  const safeIndex = Math.min(Math.max(matchIndex, 0), matches.length - 1);
  const target = matches[safeIndex];
  const nextValue = source.slice(0, target.start) + replacement + source.slice(target.end);
  return { nextValue, replacedCount: 1 };
}

// Human: Convert absolute character offset to 1-based line/column for the status bar.
// Agent: READS source + caret index; RETURNS { line, column }.
export function caretPositionFromIndex(source: string, index: number): { line: number; column: number } {
  const clamped = Math.min(Math.max(index, 0), source.length);
  const before = source.slice(0, clamped);
  const line = before.split("\n").length;
  const column = (before.split("\n").pop()?.length ?? 0) + 1;
  return { line, column };
}
