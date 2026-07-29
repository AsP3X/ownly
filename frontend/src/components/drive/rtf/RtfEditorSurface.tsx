// Human: Contenteditable RTF surface — uncontrolled while typing; parent only seeds content on load.
// Agent: EXPOSES imperative getHtml/setHtml/exec; EMITS onChange for dirty tracking only.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export type RtfEditorSurfaceHandle = {
  focus: () => void;
  getHtml: () => string;
  setHtml: (html: string) => void;
  exec: (command: string, value?: string) => void;
};

export type RtfEditorSurfaceProps = {
  /** Human: Document seed — applied only when documentKey changes (file open / explicit reload). */
  initialHtml: string;
  /** Human: Stable key for the loaded document version (e.g. file id + load generation). */
  documentKey: string;
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
  function RtfEditorSurface(
    { initialHtml, documentKey, readOnly = false, disabled = false, onChange, className },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const appliedKeyRef = useRef<string | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        getHtml: () => {
          const el = editorRef.current;
          if (!el) return "<p><br></p>";
          const html = el.innerHTML;
          return html.trim() ? html : "<p><br></p>";
        },
        setHtml: (next) => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = next?.trim() ? next : "<p><br></p>";
        },
        exec: (command, value) => {
          const el = editorRef.current;
          if (!el || readOnly || disabled) return;
          el.focus();
          if (command === "hiliteColor") {
            const ok = document.execCommand("hiliteColor", false, value);
            if (!ok) document.execCommand("backColor", false, value);
          } else {
            document.execCommand(command, false, value);
          }
          onChangeRef.current(el.innerHTML);
        },
      }),
      [disabled, readOnly],
    );

    // Human: Seed the editable DOM only when a new document version is loaded — never while typing.
    // Agent: WRITES innerHTML when documentKey changes; IGNORES initialHtml prop updates for the same key.
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      if (appliedKeyRef.current === documentKey) return;
      appliedKeyRef.current = documentKey;
      el.innerHTML = initialHtml?.trim() ? initialHtml : "<p><br></p>";
    }, [documentKey, initialHtml]);

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
              onChangeRef.current(el.innerHTML);
            }}
            onBlur={() => {
              const el = editorRef.current;
              if (!el || readOnly) return;
              onChangeRef.current(el.innerHTML);
            }}
          />
        </div>
      </div>
    );
  },
);
