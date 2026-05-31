// Human: Lightweight One Dark syntax tokens for the in-browser code editor overlay.
// Agent: READS source + highlight mode; RETURNS React spans with Pencil token colors.

import type { ReactNode } from "react";
import type { EditorHighlightMode } from "@/lib/text-code-editor/language";

export type SyntaxTokenStyle =
  | "keyword"
  | "plain"
  | "function"
  | "string"
  | "class"
  | "variable"
  | "property"
  | "number"
  | "comment"
  | "punctuation";

export type SyntaxToken = {
  text: string;
  style: SyntaxTokenStyle;
};

const TOKEN_CLASS: Record<SyntaxTokenStyle, string> = {
  keyword: "text-[#C678DD]",
  plain: "text-[#ABB2BF]",
  function: "text-[#61AFEF]",
  string: "text-[#98C379]",
  class: "text-[#E5C07B]",
  variable: "text-[#E06C75]",
  property: "text-[#D19A66]",
  number: "text-[#D19A66]",
  comment: "text-[#5C6370]",
  punctuation: "text-[#ABB2BF]",
};

const JS_KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "default",
  "function",
  "const",
  "let",
  "var",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "async",
  "await",
  "try",
  "catch",
  "finally",
  "throw",
  "class",
  "extends",
  "interface",
  "type",
  "enum",
  "public",
  "private",
  "protected",
  "static",
  "readonly",
  "void",
  "null",
  "undefined",
  "true",
  "false",
  "this",
  "super",
  "typeof",
  "instanceof",
  "in",
  "of",
  "as",
]);

function tokenizeLine(line: string, mode: EditorHighlightMode): SyntaxToken[] {
  if (!line) return [{ text: " ", style: "plain" }];

  if (mode === "plain" || mode === "markdown") {
    return [{ text: line, style: "plain" }];
  }

  if (mode === "json") return tokenizeJsonLine(line);
  if (mode === "css") return tokenizeCssLine(line);
  if (mode === "html") return tokenizeHtmlLine(line);

  return tokenizeScriptLine(line, mode === "typescript");
}

function pushPlain(tokens: SyntaxToken[], text: string) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.style === "plain") {
    last.text += text;
    return;
  }
  tokens.push({ text, style: "plain" });
}

function tokenizeScriptLine(line: string, isTypeScript: boolean): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("//")) {
      tokens.push({ text: rest, style: "comment" });
      break;
    }

    const stringMatch = rest.match(/^(['"`])(?:\\.|(?!\1)[^\\])*\1/);
    if (stringMatch) {
      tokens.push({ text: stringMatch[0], style: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const wordMatch = rest.match(/^[A-Za-z_$][\w$]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (JS_KEYWORDS.has(word)) {
        tokens.push({ text: word, style: "keyword" });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ text: word, style: "class" });
      } else if (word.endsWith("Status") || word.startsWith("set") || word.startsWith("use")) {
        tokens.push({ text: word, style: "function" });
      } else if (isTypeScript && /^I[A-Z]/.test(word)) {
        tokens.push({ text: word, style: "class" });
      } else {
        tokens.push({ text: word, style: "variable" });
      }
      index += word.length;
      continue;
    }

    const numberMatch = rest.match(/^\d+(?:\.\d+)?/);
    if (numberMatch) {
      tokens.push({ text: numberMatch[0], style: "number" });
      index += numberMatch[0].length;
      continue;
    }

    if (/^[{}()[\];,:.]/.test(rest[0] ?? "")) {
      tokens.push({ text: rest[0], style: "punctuation" });
      index += 1;
      continue;
    }

    pushPlain(tokens, rest[0] ?? "");
    index += 1;
  }

  return tokens.length > 0 ? tokens : [{ text: line, style: "plain" }];
}

function tokenizeJsonLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const regex =
    /("(?:\\.|[^"\\])*")\s*(?=:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|-?\d+(?:\.\d+)?|[{[\]},:]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    pushPlain(tokens, line.slice(lastIndex, match.index));
    const value = match[0];
    if (/^"/.test(value) && line.slice(match.index + value.length).trimStart().startsWith(":")) {
      tokens.push({ text: value, style: "property" });
    } else if (/^"/.test(value)) {
      tokens.push({ text: value, style: "string" });
    } else if (/^(true|false|null)$/.test(value)) {
      tokens.push({ text: value, style: "keyword" });
    } else if (/^\d/.test(value)) {
      tokens.push({ text: value, style: "number" });
    } else {
      tokens.push({ text: value, style: "punctuation" });
    }
    lastIndex = match.index + value.length;
  }

  pushPlain(tokens, line.slice(lastIndex));
  return tokens.length > 0 ? tokens : [{ text: line, style: "plain" }];
}

function tokenizeCssLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const regex =
    /(\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*')|([.#][\w-]+)|(-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?)|([{}:;,])|([a-z-]+)(?=\s*:)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    pushPlain(tokens, line.slice(lastIndex, match.index));
    const value = match[0];
    if (value.startsWith("/*")) tokens.push({ text: value, style: "comment" });
    else if (/^["']/.test(value)) tokens.push({ text: value, style: "string" });
    else if (/^[.#]/.test(value)) tokens.push({ text: value, style: "class" });
    else if (/^\d/.test(value)) tokens.push({ text: value, style: "number" });
    else if (/^[{}:;,]$/.test(value)) tokens.push({ text: value, style: "punctuation" });
    else tokens.push({ text: value, style: "property" });
    lastIndex = match.index + value.length;
  }

  pushPlain(tokens, line.slice(lastIndex));
  return tokens.length > 0 ? tokens : [{ text: line, style: "plain" }];
}

function tokenizeHtmlLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const regex =
    /(<!--[\s\S]*?-->)|(<\/?[\w-]+)|(\/?>)|("[^"]*"|'[^']*')|([{}()[\];])|([\w:-]+(?==))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    pushPlain(tokens, line.slice(lastIndex, match.index));
    const value = match[0];
    if (value.startsWith("<!--")) tokens.push({ text: value, style: "comment" });
    else if (value.startsWith("<")) tokens.push({ text: value, style: "keyword" });
    else if (/^["']/.test(value)) tokens.push({ text: value, style: "string" });
    else if (/=$/.test(value)) tokens.push({ text: value, style: "property" });
    else tokens.push({ text: value, style: "plain" });
    lastIndex = match.index + value.length;
  }

  pushPlain(tokens, line.slice(lastIndex));
  return tokens.length > 0 ? tokens : [{ text: line, style: "plain" }];
}

export type HighlightSegment = {
  text: string;
  className: string;
  searchState?: "inactive" | "active";
};

// Human: Build per-line highlight segments including optional find-match overlays.
// Agent: READS full source; MERGES syntax tokens with search match ranges per line.
export function buildHighlightedLines(
  source: string,
  mode: EditorHighlightMode,
  matches: Array<{ start: number; end: number }>,
  activeMatchIndex: number,
): HighlightSegment[][] {
  const lines = source.split("\n");
  let offset = 0;
  const matchStates = matches.map((match, index) => ({
    ...match,
    state: (index === activeMatchIndex ? "active" : "inactive") as "active" | "inactive",
  }));

  return lines.map((line) => {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    const lineMatches = matchStates.filter((match) => match.start < lineEnd && match.end > lineStart);
    const tokens = tokenizeLine(line, mode);
    const segments: HighlightSegment[] = [];

    if (lineMatches.length === 0) {
      for (const token of tokens) {
        segments.push({ text: token.text, className: TOKEN_CLASS[token.style] });
      }
      if (segments.length === 0) {
        segments.push({ text: line || " ", className: TOKEN_CLASS.plain });
      }
      return segments;
    }

    let cursor = 0;
    for (const token of tokens) {
      const tokenStart = lineStart + cursor;
      const tokenEnd = tokenStart + token.text.length;
      cursor += token.text.length;

      let localOffset = 0;
      const localSegments: HighlightSegment[] = [];

      const relevantMatches = lineMatches.filter(
        (match) => match.start < tokenEnd && match.end > tokenStart,
      );

      if (relevantMatches.length === 0) {
        segments.push({ text: token.text, className: TOKEN_CLASS[token.style] });
        continue;
      }

      for (const searchMatch of relevantMatches) {
        const overlapStart = Math.max(searchMatch.start, tokenStart);
        const overlapEnd = Math.min(searchMatch.end, tokenEnd);
        if (overlapStart >= overlapEnd) continue;

        const localStart = overlapStart - tokenStart;
        const localEnd = overlapEnd - tokenStart;

        if (localStart > localOffset) {
          localSegments.push({
            text: token.text.slice(localOffset, localStart),
            className: TOKEN_CLASS[token.style],
          });
        }

        localSegments.push({
          text: token.text.slice(localStart, localEnd),
          className:
            searchMatch.state === "active"
              ? "rounded-sm bg-[#FF9100]/50 text-[#FFE082] ring-1 ring-[#FF9100]/75"
              : "rounded-sm bg-[#FFE082]/33 text-[#FFE082] ring-1 ring-[#FFE082]/55",
          searchState: searchMatch.state,
        });
        localOffset = localEnd;
      }

      if (localOffset < token.text.length) {
        localSegments.push({
          text: token.text.slice(localOffset),
          className: TOKEN_CLASS[token.style],
        });
      }

      segments.push(...localSegments);
    }

    if (segments.length === 0) {
      segments.push({ text: line || " ", className: TOKEN_CLASS.plain });
    }

    return segments;
  });
}

export function renderHighlightedSegments(segments: HighlightSegment[]): ReactNode {
  return segments.map((segment, index) => (
    <span key={`${index}-${segment.text}`} className={segment.className}>
      {segment.text}
    </span>
  ));
}
