// Human: Docs/Word-style lock highlights for foreign collaborators' locked sentences.
// Agent: CSS Highlight API first; absolute bubble overlay fallback; NEVER marks current user.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import {
  applyCssLockHighlights,
  clearCssLockHighlights,
  measureLockBubbleRects,
  stripCollabLockMarks,
  type CollabLockDecoration,
  type LockBubbleRect,
} from "@/lib/rtf/plain-offset-range";
import { cn } from "@/lib/utils";

export type RtfCollabLockBubblesProps = {
  getEditorElement: () => HTMLElement | null;
  /** Human: Scroll/position container for overlay fallback (usually the scrollport). */
  getScrollContainer?: () => HTMLElement | null;
  participants: DocumentCollabParticipant[];
  currentUserId?: string | null;
  /** Human: Bump when document HTML changes so highlights remeasure. */
  layoutKey?: string;
};

function supportsCssHighlights(): boolean {
  try {
    const g = globalThis as unknown as {
      CSS?: { highlights?: unknown };
      Highlight?: unknown;
    };
    return Boolean(g.CSS?.highlights && g.Highlight);
  } catch {
    return false;
  }
}

// Human: Drive lock painting for foreign collaborators only.
// Agent: DERIVES decorations; CSS highlights or overlay rects; repaints on presence/layout.
export function RtfCollabLockBubbles({
  getEditorElement,
  getScrollContainer,
  participants,
  currentUserId,
  layoutKey,
}: RtfCollabLockBubblesProps) {
  const [bubbles, setBubbles] = useState<LockBubbleRect[]>([]);
  const [mode, setMode] = useState<"css" | "overlay" | "none">("none");

  const decorations = useMemo(() => {
    const next: CollabLockDecoration[] = [];
    for (const person of participants) {
      if (currentUserId && person.user_id === currentUserId) continue;
      const start = person.lock_start;
      const end = person.lock_end;
      if (start == null || end == null || end <= start) continue;
      next.push({
        userId: person.user_id,
        displayName: person.display_name || "Collaborator",
        color: person.color || "#2563EB",
        start: Number(start),
        end: Number(end),
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

    // Human: Drop any legacy mark-based decorations that pollute offsets.
    stripCollabLockMarks(editor);

    if (decorations.length === 0) {
      clearCssLockHighlights();
      setBubbles([]);
      setMode("none");
      return;
    }

    // Human: Positioning ancestor is the relative wrapper around editor + overlay (not scrollport).
    const positionRoot = editor.parentElement ?? editor;

    if (supportsCssHighlights() && applyCssLockHighlights(editor, decorations)) {
      setMode("css");
      // Still paint name chips via overlay (CSS highlights cannot show labels).
      const rects = measureLockBubbleRects(editor, positionRoot, decorations);
      const labels = rects.filter((r) => r.isFirst);
      setBubbles(labels.map((r) => ({ ...r, height: 0, width: 0 })));
      return;
    }

    // Overlay fallback: full bubble rects around the locked text
    setMode("overlay");
    clearCssLockHighlights();
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

    // Human: Presence can update without layoutKey — light remeasure while locks active.
    const interval =
      decorations.length > 0 ? window.setInterval(paint, 700) : null;

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      container?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [decorations, getScrollContainer, layoutKey, paint]);

  useEffect(() => {
    return () => {
      const editor = getEditorElement();
      if (editor) stripCollabLockMarks(editor);
      clearCssLockHighlights(decorations.map((d) => d.userId));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup once on unmount
  }, []);

  if (mode === "none" && bubbles.length === 0) return null;

  // CSS mode: only name chips. Overlay mode: full bubbles + chips.
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] overflow-visible"
      aria-hidden
    >
      {bubbles.map((bubble) =>
        mode === "css" ? (
          <span
            key={bubble.key}
            className="absolute max-w-[12rem] truncate rounded-full px-2 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm"
            style={{
              top: Math.max(0, bubble.top - 18),
              left: bubble.left,
              backgroundColor: bubble.color,
            }}
            title={`${bubble.label} is editing this section`}
          >
            {bubble.label}
          </span>
        ) : (
          <div
            key={bubble.key}
            className={cn(
              "absolute rounded-lg border-2 transition-[top,left,width,height] duration-100 ease-out",
            )}
            style={{
              top: bubble.top,
              left: bubble.left,
              width: bubble.width,
              height: bubble.height,
              backgroundColor: bubble.backgroundColor,
              borderColor: bubble.borderColor,
              boxShadow: `0 0 0 1px ${bubble.borderColor}, 0 2px 8px ${bubble.backgroundColor}`,
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
        ),
      )}
    </div>
  );
}
