// Human: Docs/Word-style lock highlights — colored bubbles around foreign locked sentences.
// Agent: APPLIES ephemeral mark spans via applyCollabLockMarks; NEVER marks current user.

import { useEffect, useMemo, useRef } from "react";
import type { DocumentCollabParticipant } from "@/api/client";
import {
  applyCollabLockMarks,
  stripCollabLockMarks,
  type CollabLockDecoration,
} from "@/lib/rtf/plain-offset-range";

export type RtfCollabLockBubblesProps = {
  getEditorElement: () => HTMLElement | null;
  participants: DocumentCollabParticipant[];
  currentUserId?: string | null;
  /** Human: Bump when document HTML changes so marks re-wrap after remote sync. */
  layoutKey?: string;
};

// Human: Drive ephemeral lock mark painting for foreign collaborators only.
// Agent: DERIVES decorations from participants; applyCollabLockMarks on layout/participant changes.
export function RtfCollabLockBubbles({
  getEditorElement,
  participants,
  currentUserId,
  layoutKey,
}: RtfCollabLockBubblesProps) {
  const frameRef = useRef<number | null>(null);

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
        start,
        end,
      });
    }
    return next;
  }, [currentUserId, participants]);

  useEffect(() => {
    const paint = () => {
      frameRef.current = null;
      const editor = getEditorElement();
      if (!editor) return;
      if (decorations.length === 0) {
        stripCollabLockMarks(editor);
        return;
      }
      applyCollabLockMarks(editor, decorations);
    };

    // Human: Defer until after React commits remote setHtml so ranges map to live text.
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    // Double-rAF: first after React commit, second after browser layout/paint.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(paint);
    });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [decorations, getEditorElement, layoutKey]);

  // Human: Clear marks when the collab layer unmounts so saved HTML stays clean.
  useEffect(() => {
    return () => {
      const editor = getEditorElement();
      if (editor) stripCollabLockMarks(editor);
    };
  }, [getEditorElement]);

  // Marks live inside the contenteditable DOM — no separate overlay layer.
  return null;
}
