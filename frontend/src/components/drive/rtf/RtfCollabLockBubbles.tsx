// Human: Remote collab overlays — DOM lock marks + carets + selection bands for other users.
// Agent: applyCollabLockMarks only when lock ranges change; caret/selection absolute overlays.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import {
  applyCollabLockMarks,
  measureCaretMarker,
  measureSelectionRects,
  stripCollabLockMarks,
  type CaretMarker,
  type CollabLockDecoration,
  type LockBubbleRect,
} from "@/lib/rtf/plain-offset-range";

export type RtfCollabLockBubblesProps = {
  getEditorElement: () => HTMLElement | null;
  getScrollContainer?: () => HTMLElement | null;
  participants: DocumentCollabParticipant[];
  currentUserId?: string | null;
  layoutKey?: string;
};

export function RtfCollabLockBubbles({
  getEditorElement,
  getScrollContainer,
  participants,
  currentUserId,
  layoutKey,
}: RtfCollabLockBubblesProps) {
  const [selectionBubbles, setSelectionBubbles] = useState<LockBubbleRect[]>([]);
  const [carets, setCarets] = useState<CaretMarker[]>([]);

  const others = useMemo(
    () =>
      participants.filter(
        (person) => !currentUserId || person.user_id !== currentUserId,
      ),
    [currentUserId, participants],
  );

  const lockDecorations = useMemo(() => {
    const next: CollabLockDecoration[] = [];
    for (const person of others) {
      const start = person.lock_start;
      const end = person.lock_end;
      if (start == null || end == null) continue;
      const s = Number(start);
      const e = Number(end);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      next.push({
        userId: person.user_id,
        displayName: person.display_name || "Collaborator",
        color: person.color || "#2563EB",
        start: s,
        end: e,
      });
    }
    return next;
  }, [others]);

  // Human: Re-wrap lock marks only when ranges change or the document DOM was replaced.
  useEffect(() => {
    const editor = getEditorElement();
    if (!editor) return;
    if (lockDecorations.length === 0) {
      stripCollabLockMarks(editor);
      return;
    }
    applyCollabLockMarks(editor, lockDecorations);
  }, [getEditorElement, layoutKey, lockDecorations]);

  // Human: Strip marks only when the overlay unmounts (not on every presence tick).
  useEffect(() => {
    return () => {
      const editor = getEditorElement();
      if (editor) stripCollabLockMarks(editor);
    };
  }, [getEditorElement]);

  const paintCarets = useCallback(() => {
    const editor = getEditorElement();
    if (!editor) {
      setSelectionBubbles([]);
      setCarets([]);
      return;
    }

    const positionRoot = editor.parentElement ?? editor;
    const nextSelections: LockBubbleRect[] = [];
    const nextCarets: CaretMarker[] = [];

    for (const person of others) {
      const color = person.color || "#2563EB";
      const label = person.display_name || "Collaborator";
      const selStart =
        person.selection_start != null ? Number(person.selection_start) : null;
      const selEnd =
        person.selection_end != null ? Number(person.selection_end) : null;

      let caretOffset: number | null = null;
      if (selStart != null && Number.isFinite(selStart)) {
        caretOffset = selStart;
        if (selEnd != null && Number.isFinite(selEnd) && selEnd > selStart) {
          nextSelections.push(
            ...measureSelectionRects(
              editor,
              positionRoot,
              selStart,
              selEnd,
              person.user_id,
              label,
              color,
            ),
          );
        }
      } else if (
        person.lock_start != null &&
        Number.isFinite(Number(person.lock_start))
      ) {
        caretOffset = Number(person.lock_start);
      }

      if (caretOffset != null) {
        const caret = measureCaretMarker(
          editor,
          positionRoot,
          caretOffset,
          person.user_id,
          label,
          color,
        );
        if (caret) nextCarets.push(caret);
      }
    }

    setSelectionBubbles(nextSelections);
    setCarets(nextCarets);
  }, [getEditorElement, others]);

  useEffect(() => {
    let frame: number | null = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        frame = null;
        paintCarets();
      });
    });

    const container = getScrollContainer?.() ?? null;
    const onScrollOrResize = () => paintCarets();
    container?.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    const interval = window.setInterval(paintCarets, 150);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      container?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      window.clearInterval(interval);
    };
  }, [getScrollContainer, paintCarets]);

  if (selectionBubbles.length === 0 && carets.length === 0 && lockDecorations.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] overflow-visible"
      aria-hidden
    >
      {selectionBubbles.map((bubble) => (
        <div
          key={bubble.key}
          className="absolute rounded-sm"
          style={{
            top: bubble.top,
            left: bubble.left,
            width: bubble.width,
            height: bubble.height,
            backgroundColor: bubble.backgroundColor,
          }}
        />
      ))}

      {carets.map((caret) => (
        <div
          key={caret.key}
          className="absolute"
          style={{
            top: caret.top,
            left: caret.left,
            width: 2,
            height: caret.height,
            backgroundColor: caret.color,
            boxShadow: `0 0 0 1px ${caret.color}`,
            zIndex: 4,
          }}
          title={caret.label}
        >
          <span
            className="absolute -top-4 left-0 max-w-[10rem] truncate rounded-sm px-1 py-px text-[9px] font-bold leading-none text-white whitespace-nowrap"
            style={{ backgroundColor: caret.color }}
          >
            {caret.label}
          </span>
        </div>
      ))}
    </div>
  );
}
