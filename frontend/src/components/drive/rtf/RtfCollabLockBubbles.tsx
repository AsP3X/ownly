// Human: Docs/Word-style lock bubbles for foreign collaborators' locked sentences.
// Agent: ALWAYS uses overlay rects (reliable); NEVER marks current user's own lock.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import {
  measureLockBubbleRects,
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
  const [bubbles, setBubbles] = useState<LockBubbleRect[]>([]);

  const decorations = useMemo(() => {
    const next: CollabLockDecoration[] = [];
    for (const person of participants) {
      if (currentUserId && person.user_id === currentUserId) continue;
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
  }, [currentUserId, participants]);

  const paint = useCallback(() => {
    const editor = getEditorElement();
    if (!editor) {
      setBubbles([]);
      return;
    }
    if (decorations.length === 0) {
      setBubbles([]);
      return;
    }
    const positionRoot = editor.parentElement ?? editor;
    setBubbles(measureLockBubbleRects(editor, positionRoot, decorations));
  }, [decorations, getEditorElement]);

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

    const interval =
      decorations.length > 0 ? window.setInterval(paint, 500) : null;

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      container?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [decorations, getScrollContainer, layoutKey, paint]);

  if (bubbles.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] overflow-visible"
      aria-hidden
    >
      {bubbles.map((bubble) => (
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
              {bubble.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
