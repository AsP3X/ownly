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

export const RtfEditorSurface = forwardRef<RtfEditorSurfaceHandle, RtfEditorSurfaceProps>(
  function RtfEditorSurface({ html, readOnly = false, disabled = false, onChange, className }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const lastHtmlRef = useRef(html);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        getHtml: () => editorRef.current?.innerHTML ?? "",
        setHtml: (next) => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = next || "<p><br></p>";
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
          onChange(next);
        },
      }),
      [disabled, onChange, readOnly],
    );

    // Human: Sync external HTML when a new file loads — avoid clobbering while typing.
    // Agent: WRITES innerHTML only when prop html differs from last emitted value.
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      if (html === lastHtmlRef.current) return;
      el.innerHTML = html || "<p><br></p>";
      lastHtmlRef.current = el.innerHTML;
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
              onChange(next);
            }}
            onBlur={() => {
              const el = editorRef.current;
              if (!el || readOnly) return;
              const next = el.innerHTML;
              lastHtmlRef.current = next;
              onChange(next);
            }}
          />
        </div>
      </div>
    );
  },
);
