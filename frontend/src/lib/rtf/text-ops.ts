// Human: DOM apply helpers for collab replace ops (OT lives in lib/collab/ot).
// Agent: USED by RtfEditorDialog; bridges collab TextReplace ↔ contenteditable.

import { rangeFromPlainOffsets, rootPlainText } from "@/lib/rtf/plain-offset-range";
import {
  diffPlainText as collabDiffPlainText,
  transformOffset,
  transformRange,
  type TextReplace,
} from "@/lib/collab/ot/text";

export type TextReplaceOp = {
  index: number;
  deleteCount: number;
  insertText: string;
};

function toCollab(op: TextReplaceOp): TextReplace {
  return { index: op.index, delete: op.deleteCount, insert: op.insertText };
}

// Human: Diff two plain strings into a single replace op (unicode-scalar safe via collab OT).
export function diffPlainText(before: string, after: string): TextReplaceOp | null {
  const diff = collabDiffPlainText(before, after);
  if (!diff) return null;
  return {
    index: diff.index,
    deleteCount: diff.delete,
    insertText: diff.insert,
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

// Human: Shift a caret/lock offset through a remote replace op (shared OT).
export function transformOffsetThroughReplace(
  offset: number,
  op: TextReplaceOp,
): number {
  return transformOffset(offset, toCollab(op));
}

export function transformRangeThroughReplace(
  start: number,
  end: number,
  op: TextReplaceOp,
): { start: number; end: number } {
  const next = transformRange(start, end, toCollab(op));
  if (!next) return { start, end: start };
  return next;
}
