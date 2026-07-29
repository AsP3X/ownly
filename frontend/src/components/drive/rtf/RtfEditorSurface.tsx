// Human: Contenteditable RTF surface — shows rendered rich text, not raw RTF source.
// Agent: APPLIES execCommand from toolbar; EMITS html change events for dirty/save state.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export type RtfEditorSurfaceHandle = {
  focus: () => void;
  getHtml: () => string;
  setHtml: (html: string) => void;
  exec: (command: string, value?: string) => void;
};

export type RtfEditorSurfaceProps = {
  html: string;
  readOnly?: boolean;
  disabled?: boolean;
  onChange: (html: string) => void;
  className?: string;
};

// Human: True when the editor DOM has no visible text (empty save would wipe the file).
// Agent: STRIPS tags/whitespace; RETURNS true for blank / <br>-only documents.
export function isEffectivelyEmptyHtml(html: string): boolean {
  const text = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\u200B/g, "")
    .trim();
  return text.length === 0;
}

export const RtfEditorSurface = forwardRef<RtfEditorSurfaceHandle, RtfEditorSurfaceProps>(
  function RtfEditorSurface({ html, readOnly = false, disabled = false, onChange, className }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    /** Human: Last HTML we either wrote to the DOM or emitted via onChange. */
    const lastHtmlRef = useRef<string>("");
    /** Human: Ignore prop echoes while the user is actively typing. */
    const typingRef = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        getHtml: () => editorRef.current?.innerHTML ?? "",
        setHtml: (next) => {
          const el = editorRef.current;
          if (!el) return;
          const value = next || "<p><br></p>";
          el.innerHTML = value;
          lastHtmlRef.current = el.innerHTML;
        },
        exec: (command, value) => {
          const el = editorRef.current;
          if (!el || readOnly || disabled) return;
          el.focus();
          // Human: hiliteColor is non-standard; backColor is the wider-supported fallback.
          if (command === "hiliteColor") {
            const ok = document.execCommand("hiliteColor", false, value);
            if (!ok) document.execCommand("backColor", false, value);
          } else {
            document.execCommand(command, false, value);
          }
          const next = el.innerHTML;
          lastHtmlRef.current = next;
          typingRef.current = true;
          onChange(next);
        },
      }),
      [disabled, onChange, readOnly],
    );

    // Human: Always push prop HTML into the contenteditable — including the first mount after load.
    // Agent: WRITES innerHTML when prop differs from last known; SKIPS while focused+typing to avoid caret jumps.
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      if (typingRef.current && html === lastHtmlRef.current) {
        typingRef.current = false;
        return;
      }

      // Human: External load/save path — replace DOM when the document HTML changed.
      if (html !== lastHtmlRef.current || el.innerHTML !== html) {
        // Don't clobber mid-edit when parent re-renders with the same logical value.
        if (
          document.activeElement === el &&
          html === lastHtmlRef.current &&
          el.innerHTML.length > 0
        ) {
          return;
        }
        el.innerHTML = html || "<p><br></p>";
        lastHtmlRef.current = el.innerHTML;
      }
      typingRef.current = false;
    }, [html]);

    return (
      <div className={cn("relative min-h-0 flex-1 overflow-auto bg-[#F3F4F6]", className)}>
        <div className="mx-auto min-h-full max-w-4xl px-4 py-6 sm:px-8">
          <div
            ref={editorRef}
            role="textbox"
            aria-multiline="true"
            aria-label="Rich text document"
            aria-readonly={readOnly || undefined}
            contentEditable={!readOnly && !disabled}
            suppressContentEditableWarning
            spellCheck
            className={cn(
              "min-h-[min(70dvh,52rem)] rounded-xl border border-[#E5E7EB] bg-white px-8 py-10 text-[15px] leading-relaxed text-[#1A1A1A] shadow-[0_8px_24px_rgba(0,0,0,0.06)] outline-none",
              "[&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6",
              "[&_h1]:mb-3 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold",
              (readOnly || disabled) && "cursor-default opacity-95",
            )}
            onInput={() => {
              const el = editorRef.current;
              if (!el || readOnly) return;
              const next = el.innerHTML;
              lastHtmlRef.current = next;
              typingRef.current = true;
              onChange(next);
            }}
            onBlur={() => {
              const el = editorRef.current;
              if (!el || readOnly) return;
              const next = el.innerHTML;
              lastHtmlRef.current = next;
              typingRef.current = false;
              onChange(next);
            }}
          />
        </div>
      </div>
    );
  },
);
