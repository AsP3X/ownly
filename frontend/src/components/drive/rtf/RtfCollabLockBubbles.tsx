// Human: Remote collab overlays — lock bubbles, selection bands, and carets for other users.
// Agent: MEASURES plain offsets → absolute rects; NEVER draws current user's decorations.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import {
  measureCaretMarker,
  measureLockBubbleRects,
  measureSelectionRects,
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
  const [lockBubbles, setLockBubbles] = useState<LockBubbleRect[]>([]);
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

  const paint = useCallback(() => {
    const editor = getEditorElement();
    if (!editor) {
      setLockBubbles([]);
      setSelectionBubbles([]);
      setCarets([]);
      return;
    }
    const positionRoot = editor.parentElement ?? editor;

    setLockBubbles(measureLockBubbleRects(editor, positionRoot, lockDecorations));

    const nextSelections: LockBubbleRect[] = [];
    const nextCarets: CaretMarker[] = [];

    for (const person of others) {
      const color = person.color || "#2563EB";
      const label = person.display_name || "Collaborator";
      const selStart =
        person.selection_start != null ? Number(person.selection_start) : null;
      const selEnd =
        person.selection_end != null ? Number(person.selection_end) : null;

      // Prefer selection for caret; fall back to lock start so peers always see where they are.
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
  }, [getEditorElement, lockDecorations, others]);

  useEffect(() => {
    let frame: number | null = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        frame = null;
        paint();
      });
    });

    const container = getScrollContainer?.() ?? null;
    const onScrollOrResize = () => paint();
    container?.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    // Human: Presence updates often without layoutKey — keep overlays aligned while peers edit.
    const interval = window.setInterval(paint, 200);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      container?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      window.clearInterval(interval);
    };
  }, [getScrollContainer, layoutKey, paint]);

  if (lockBubbles.length === 0 && selectionBubbles.length === 0 && carets.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] overflow-visible"
      aria-hidden
    >
      {/* Soft remote selection bands */}
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

      {/* Locked sentence bubbles */}
      {lockBubbles.map((bubble) => (
        <div
          key={bubble.key}
          className="absolute rounded-lg border-2"
          style={{
            top: bubble.top,
            left: bubble.left,
            width: bubble.width,
            height: bubble.height,
            backgroundColor: bubble.backgroundColor,
            borderColor: bubble.borderColor,
            boxShadow: `0 0 0 1px ${bubble.borderColor}, 0 2px 10px ${bubble.backgroundColor}`,
          }}
          title={`${bubble.label} is editing this section`}
        >
          {bubble.isFirst ? (
            <span
              className="absolute -top-5 left-0 max-w-[12rem] truncate rounded-full px-2 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm"
              style={{ backgroundColor: bubble.color }}
            >
              {bubble.label} · locked
            </span>
          ) : null}
        </div>
      ))}

      {/* Remote carets */}
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
