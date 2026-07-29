// Human: Plain-text insert/delete ops for concurrent RTF collab (avoids full-doc clobber).
// Agent: PURE diff + DOM apply at plain offsets; USED by RtfEditorDialog + useDocumentCollab.

import { rangeFromPlainOffsets, rootPlainText } from "@/lib/rtf/plain-offset-range";

export type TextReplaceOp = {
  index: number;
  deleteCount: number;
  insertText: string;
};

// Human: Diff two plain strings into a single replace op (common for typing bursts).
// Agent: Common prefix/suffix; RETURNS null when identical.
export function diffPlainText(before: string, after: string): TextReplaceOp | null {
  if (before === after) return null;
  let start = 0;
  const minLen = Math.min(before.length, after.length);
  while (start < minLen && before[start] === after[start]) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return {
    index: start,
    deleteCount: endBefore - start,
    insertText: after.slice(start, endAfter),
  };
}

// Human: Apply a plain-text replace inside contenteditable without replacing the whole document.
// Agent: rangeFromPlainOffsets delete/insert Text node; normalize; RETURNS new plain text.
export function applyPlainReplaceToEditor(
  root: HTMLElement,
  op: TextReplaceOp,
): string {
  const { index, deleteCount, insertText } = op;
  if (deleteCount > 0) {
    const del = rangeFromPlainOffsets(root, index, index + deleteCount);
    if (del) {
      del.deleteContents();
    }
  }
  if (insertText) {
    insertPlainTextAt(root, index, insertText);
  }
  root.normalize();
  return rootPlainText(root);
}

function insertPlainTextAt(root: HTMLElement, index: number, text: string): void {
  // Prefer a one-char range collapsed to start
  let range = rangeFromPlainOffsets(root, index, index + 1);
  if (range) {
    range.collapse(true);
  } else if (index > 0) {
    range = rangeFromPlainOffsets(root, index - 1, index);
    if (range) range.collapse(false);
  }
  if (!range) {
    // Empty editor
    const node = document.createTextNode(text);
    if (root.firstChild) {
      root.insertBefore(node, root.firstChild);
    } else {
      const p = document.createElement("p");
      p.appendChild(node);
      root.appendChild(p);
    }
    return;
  }
  range.insertNode(document.createTextNode(text));
}

// Human: Shift a caret/lock offset through a remote replace op (basic OT).
// Agent: BEFORE op → unchanged; AFTER deleted span → shift by insert-delete; INSIDE → clamp to index.
export function transformOffsetThroughReplace(
  offset: number,
  op: TextReplaceOp,
): number {
  const { index, deleteCount, insertText } = op;
  const insertLen = insertText.length;
  if (offset <= index) return offset;
  if (offset >= index + deleteCount) {
    return offset - deleteCount + insertLen;
  }
  // Inside deleted region → land at insert point
  return index + insertLen;
}

export function transformRangeThroughReplace(
  start: number,
  end: number,
  op: TextReplaceOp,
): { start: number; end: number } {
  const s = transformOffsetThroughReplace(start, op);
  const e = transformOffsetThroughReplace(end, op);
  return { start: Math.min(s, e), end: Math.max(s, e) };
}
