// Human: Collab helpers for Monaco — OT uses unicode scalar indices; Monaco uses UTF-16.
// Agent: PURE; USED by TextCodeEditorDialog / CodeEditorSurface.

import { applyReplace, type TextReplace } from "@/lib/collab/ot/text";

/**
 * Convert a UTF-16 code-unit offset (Monaco model) to a unicode scalar index (collab OT).
 * Mid-surrogate offsets land on the scalar that started before the cut (emoji-safe).
 */
export function utf16ToScalarIndex(text: string, utf16Index: number): number {
  const clamped = Math.max(0, Math.min(Math.floor(utf16Index), text.length));
  let scalar = 0;
  let i = 0;
  while (i < clamped) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (i + width > clamped) {
      // Offset sits inside a surrogate pair — count the incomplete scalar.
      scalar += 1;
      break;
    }
    i += width;
    scalar += 1;
  }
  return scalar;
}

/**
 * Convert a unicode scalar index (collab OT) to a UTF-16 code-unit offset (Monaco model).
 */
export function scalarToUtf16Index(text: string, scalarIndex: number): number {
  const target = Math.max(0, Math.floor(scalarIndex));
  let scalar = 0;
  let i = 0;
  while (i < text.length && scalar < target) {
    const cp = text.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    scalar += 1;
  }
  return i;
}

/** Apply a collab OT replace to a plain string (unicode-scalar semantics). */
export function applyTextReplace(text: string, op: TextReplace): string {
  return applyReplace(text, op);
}

export type RemotePresenceRange = {
  userId: string;
  color: string;
  /** Inclusive scalar start. */
  start: number;
  /** Exclusive scalar end (caret when equal to start after normalize). */
  end: number;
  label?: string;
};

/**
 * Map a scalar range to UTF-16 offsets for Monaco decorations.
 * Collapsed caret: start === end after clamp.
 */
export function scalarRangeToUtf16(
  text: string,
  start: number,
  end: number,
): { startUtf16: number; endUtf16: number } {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  return {
    startUtf16: scalarToUtf16Index(text, s),
    endUtf16: scalarToUtf16Index(text, e),
  };
}
