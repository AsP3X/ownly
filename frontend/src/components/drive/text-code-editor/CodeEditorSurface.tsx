// Human: Editable code surface with line numbers and One Dark syntax overlay per Pencil panel.
// Agent: SYNC scroll/caret between textarea and highlight layer; EMITS value + selection changes.

import { useCallback, useEffect, useMemo, useRef } from "react";
import "@fontsource/inconsolata/400.css";
import { buildHighlightedLines, renderHighlightedSegments } from "@/lib/text-code-editor/highlight";
import { detectEditorLanguage } from "@/lib/text-code-editor/language";
import type { TextSearchMatch } from "@/lib/text-code-editor/search";
import { cn } from "@/lib/utils";

export type CodeEditorSurfaceProps = {
  filename: string;
  mimeType: string | null;
  value: string;
  readOnly?: boolean;
  wordWrap: boolean;
  tabSize: number;
  searchMatches: TextSearchMatch[];
  activeSearchMatchIndex: number;
  onChange: (value: string) => void;
  onSelectionChange: (selectionStart: number, selectionEnd: number) => void;
};

// Human: Fixed metrics shared by gutter, highlight, and textarea — must match exactly or lines drift.
// Agent: 13px Inconsolata + 20px line box mirrors Pencil Code Editor Panel row height.
const EDITOR_FONT_SIZE_PX = 13;
const EDITOR_LINE_HEIGHT_PX = 20;

export function CodeEditorSurface({
  filename,
  mimeType,
  value,
  readOnly = false,
  wordWrap,
  tabSize,
  searchMatches,
  activeSearchMatchIndex,
  onChange,
  onSelectionChange,
}: CodeEditorSurfaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const language = useMemo(() => detectEditorLanguage(filename, mimeType), [filename, mimeType]);

  const highlightedLines = useMemo(
    () =>
      buildHighlightedLines(
        value,
        language.id,
        searchMatches,
        activeSearchMatchIndex,
      ),
    [value, language.id, searchMatches, activeSearchMatchIndex],
  );

  const lineNumbers = useMemo(() => {
    const count = Math.max(value.split("\n").length, 1);
    return Array.from({ length: count }, (_, index) => index + 1);
  }, [value]);

  const editorHeightPx = lineNumbers.length * EDITOR_LINE_HEIGHT_PX;

  const typographyStyle = useMemo(
    () => ({
      fontSize: EDITOR_FONT_SIZE_PX,
      lineHeight: `${EDITOR_LINE_HEIGHT_PX}px`,
      tabSize,
    }),
    [tabSize],
  );

  const emitSelection = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    onSelectionChange(node.selectionStart, node.selectionEnd);
  }, [onSelectionChange]);

  useEffect(() => {
    emitSelection();
  }, [value, emitSelection]);

  // Human: Keep caret visible when typing near the bottom — scroll the shared container, not the textarea.
  // Agent: READS textarea selection + scrollRef; ADJUSTS scrollTop when caret moves outside viewport.
  const keepCaretVisible = useCallback(() => {
    const textarea = textareaRef.current;
    const scrollContainer = scrollRef.current;
    if (!textarea || !scrollContainer) return;

    const style = window.getComputedStyle(textarea);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const lineIndex = value.slice(0, textarea.selectionStart).split("\n").length - 1;
    const caretTop = paddingTop + lineIndex * EDITOR_LINE_HEIGHT_PX;
    const caretBottom = caretTop + EDITOR_LINE_HEIGHT_PX;
    const viewTop = scrollContainer.scrollTop;
    const viewBottom = viewTop + scrollContainer.clientHeight;

    if (caretTop < viewTop) {
      scrollContainer.scrollTop = caretTop;
    } else if (caretBottom > viewBottom) {
      scrollContainer.scrollTop = caretBottom - scrollContainer.clientHeight;
    }
  }, [value]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#1E1E2E]">
      {/* Human: One scroll container for gutter + code so line numbers stay locked to rows. */}
      {/* Agent: overflow-auto on parent; textarea has overflow-hidden and grows with line count. */}
      <div ref={scrollRef} className="absolute inset-0 overflow-auto p-6">
        <div
          className={cn("flex gap-4", wordWrap ? "min-w-0 w-full" : "min-w-max w-max min-w-full")}
          style={{ minHeight: editorHeightPx }}
        >
          <div
            aria-hidden
            className="w-6 shrink-0 select-none text-right font-[Inconsolata] text-[#565F89]"
            style={typographyStyle}
          >
            {lineNumbers.map((lineNumber) => (
              <div
                key={`line-${lineNumber}`}
                style={{ height: EDITOR_LINE_HEIGHT_PX, lineHeight: `${EDITOR_LINE_HEIGHT_PX}px` }}
              >
                {lineNumber}
              </div>
            ))}
          </div>

          <div
            className="relative min-w-0 flex-1"
            style={{ height: editorHeightPx, minWidth: wordWrap ? undefined : "max-content" }}
          >
            <pre
              aria-hidden
              className={cn(
                "pointer-events-none m-0 font-[Inconsolata] text-[#ABB2BF]",
                wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}
              style={typographyStyle}
            >
              {highlightedLines.map((segments, lineIndex) => (
                <div
                  key={`code-line-${lineIndex}`}
                  style={{ height: EDITOR_LINE_HEIGHT_PX, lineHeight: `${EDITOR_LINE_HEIGHT_PX}px` }}
                >
                  {renderHighlightedSegments(segments)}
                </div>
              ))}
            </pre>

            <textarea
              ref={textareaRef}
              value={value}
              readOnly={readOnly}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              wrap={wordWrap ? "soft" : "off"}
              onChange={(event) => onChange(event.target.value)}
              onSelect={() => {
                emitSelection();
                keepCaretVisible();
              }}
              onKeyUp={() => {
                emitSelection();
                keepCaretVisible();
              }}
              onClick={() => {
                emitSelection();
                keepCaretVisible();
              }}
              aria-label={`Edit ${filename}`}
              className={cn(
                "absolute inset-0 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 font-[Inconsolata] text-transparent caret-[#CDD6F4] outline-none",
                wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}
              style={{
                ...typographyStyle,
                height: editorHeightPx,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
