// Human: Contenteditable RTF surface — fills the dialog body width and height.
// Agent: EXPOSES imperative getHtml/setHtml/exec; STRIPS collab decorations from serialized HTML.
// Agent: HOSTS RtfCollabLockBubbles overlay inside the scrollport for foreign locks.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import { RtfCollabLockBubbles } from "@/components/drive/rtf/RtfCollabLockBubbles";
import {
  getHtmlWithoutCollabMarks,
  stripCollabLockMarks,
} from "@/lib/rtf/plain-offset-range";
import { cn } from "@/lib/utils";

export type RtfEditorSurfaceHandle = {
  focus: () => void;
  getHtml: () => string;
  setHtml: (html: string) => void;
  getEditorElement: () => HTMLDivElement | null;
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
  /** Human: Live collab participants — foreign lock ranges draw colored bubbles. */
  collabParticipants?: DocumentCollabParticipant[];
  collabCurrentUserId?: string | null;
  /** Human: Bump when document HTML changes so lock geometry remeasures. */
  collabLayoutKey?: string;
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
    {
      initialHtml,
      documentKey,
      readOnly = false,
      disabled = false,
      onChange,
      className,
      collabParticipants,
      collabCurrentUserId,
      collabLayoutKey,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
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
          return getHtmlWithoutCollabMarks(el);
        },
        setHtml: (next) => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = next?.trim() ? next : "<p><br></p>";
        },
        getEditorElement: () => editorRef.current,
        exec: (command, value) => {
          const el = editorRef.current;
          if (!el || readOnly || disabled) return;
          el.focus();
          stripCollabLockMarks(el);
          if (command === "hiliteColor") {
            const ok = document.execCommand("hiliteColor", false, value);
            if (!ok) document.execCommand("backColor", false, value);
          } else {
            document.execCommand(command, false, value);
          }
          onChangeRef.current(getHtmlWithoutCollabMarks(el));
        },
      }),
      [disabled, readOnly],
    );

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      if (appliedKeyRef.current === documentKey) return;
      appliedKeyRef.current = documentKey;
      el.innerHTML = initialHtml?.trim() ? initialHtml : "<p><br></p>";
    }, [documentKey, initialHtml]);

    const getEditorElement = useCallback(() => editorRef.current, []);
    const getScrollContainer = useCallback(() => scrollRef.current, []);

    const emitChange = useCallback(() => {
      const el = editorRef.current;
      if (!el || readOnly) return;
      onChangeRef.current(getHtmlWithoutCollabMarks(el));
    }, [readOnly]);

    return (
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white",
          className,
        )}
      >
        <div ref={scrollRef} className="absolute inset-0 overflow-auto">
          <div className="relative min-h-full w-full">
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
                "box-border min-h-full w-full px-5 py-4 text-[15px] leading-relaxed text-[#1A1A1A] outline-none sm:px-6 sm:py-5",
                "[&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6",
                "[&_h1]:mb-3 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold",
                (readOnly || disabled) && "cursor-default opacity-95",
              )}
              onInput={emitChange}
              onBlur={emitChange}
            />
            {collabParticipants && collabParticipants.length > 0 ? (
              <RtfCollabLockBubbles
                getEditorElement={getEditorElement}
                getScrollContainer={getScrollContainer}
                participants={collabParticipants}
                currentUserId={collabCurrentUserId}
                layoutKey={collabLayoutKey}
              />
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);
