// Human: Bubble highlights over sentences locked by other collaborators.
// Agent: MAPS plain offsets → client rects; RENDERS colored bubbles (never for current user).

import { useCallback, useEffect, useState } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import { rangeFromPlainOffsets } from "@/lib/rtf/plain-offset-range";
import { cn } from "@/lib/utils";

export type RtfCollabLockBubblesProps = {
  /** Human: The contenteditable root whose text offsets match lock_start/lock_end. */
  getEditorElement: () => HTMLElement | null;
  /** Human: Scrollport that contains the editor (listens for scroll/resize). */
  getScrollContainer: () => HTMLElement | null;
  participants: DocumentCollabParticipant[];
  currentUserId?: string | null;
  /** Human: Bump when document HTML changes so bubble geometry refreshes. */
  layoutKey?: string;
};

type BubbleRect = {
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
  color: string;
  label: string;
  isFirst: boolean;
  backgroundColor: string;
  borderColor: string;
  boxShadow: string;
};

// Human: Soft fill + ring using the collaborator's assigned presence color.
// Agent: PARSES #rrggbb / rgb(); RETURNS rgba background + solid border.
function colorStyles(color: string): {
  backgroundColor: string;
  borderColor: string;
  boxShadow: string;
} {
  const hex = color.trim();
  let r = 37;
  let g = 99;
  let b = 235;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (match) {
    const n = Number.parseInt(match[1]!, 16);
    r = (n >> 16) & 0xff;
    g = (n >> 8) & 0xff;
    b = n & 0xff;
  } else {
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(hex);
    if (rgb) {
      r = Number(rgb[1]);
      g = Number(rgb[2]);
      b = Number(rgb[3]);
    }
  }
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.18)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.7)`,
    boxShadow: `0 0 0 1px rgba(${r}, ${g}, ${b}, 0.28), 0 2px 10px rgba(${r}, ${g}, ${b}, 0.2)`,
  };
}

export function RtfCollabLockBubbles({
  getEditorElement,
  getScrollContainer,
  participants,
  currentUserId,
  layoutKey,
}: RtfCollabLockBubblesProps) {
  const [bubbles, setBubbles] = useState<BubbleRect[]>([]);

  const recompute = useCallback(() => {
    const editor = getEditorElement();
    if (!editor) {
      setBubbles([]);
      return;
    }

    // Human: Overlay is a sibling of the editor inside the same relative content root.
    // Agent: POSITION relative to that parent (scrolls with content — do not add scrollTop).
    const contentRoot = editor.parentElement;
    if (!contentRoot) {
      setBubbles([]);
      return;
    }

    const rootRect = contentRoot.getBoundingClientRect();
    const next: BubbleRect[] = [];

    for (const person of participants) {
      if (currentUserId && person.user_id === currentUserId) continue;
      const start = person.lock_start;
      const end = person.lock_end;
      if (start == null || end == null || end <= start) continue;

      const range = rangeFromPlainOffsets(editor, start, end);
      if (!range) continue;

      const styles = colorStyles(person.color);
      let index = 0;
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        next.push({
          key: `${person.user_id}-${start}-${end}-${index}`,
          // Padding so the bubble feels like a soft pill around the line box
          top: rect.top - rootRect.top - 2,
          left: rect.left - rootRect.left - 4,
          width: rect.width + 8,
          height: rect.height + 4,
          color: person.color,
          label: person.display_name,
          isFirst: index === 0,
          backgroundColor: styles.backgroundColor,
          borderColor: styles.borderColor,
          boxShadow: styles.boxShadow,
        });
        index += 1;
      }
    }

    setBubbles(next);
  }, [currentUserId, getEditorElement, participants]);

  useEffect(() => {
    recompute();
  }, [recompute, layoutKey, participants]);

  useEffect(() => {
    const container = getScrollContainer();
    const editor = getEditorElement();
    if (!container) return;

    const onScrollOrResize = () => recompute();
    container.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScrollOrResize) : null;
    ro?.observe(container);
    if (editor) ro?.observe(editor);

    // Human: Geometry drifts as remote HTML applies — poll lightly while locks are active.
    const hasLocks = participants.some(
      (p) =>
        (!currentUserId || p.user_id !== currentUserId) &&
        p.lock_start != null &&
        p.lock_end != null &&
        (p.lock_end ?? 0) > (p.lock_start ?? 0),
    );
    const interval = hasLocks ? window.setInterval(recompute, 350) : null;

    return () => {
      container.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      ro?.disconnect();
      if (interval !== null) window.clearInterval(interval);
    };
  }, [currentUserId, getEditorElement, getScrollContainer, participants, recompute]);

  if (bubbles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-visible" aria-hidden>
      {bubbles.map((bubble) => (
        <div
          key={bubble.key}
          className={cn(
            "absolute rounded-xl border-2 transition-[top,left,width,height] duration-150 ease-out",
          )}
          style={{
            top: bubble.top,
            left: bubble.left,
            width: bubble.width,
            height: bubble.height,
            backgroundColor: bubble.backgroundColor,
            borderColor: bubble.borderColor,
            boxShadow: bubble.boxShadow,
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
