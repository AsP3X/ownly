// Human: Map contenteditable caret ↔ plain-text offsets for collab locks.
// Agent: WALKS text nodes under root; USED by RtfEditorDialog selection handlers.

// Human: Plain-text offset of the current selection anchor within the editor root.
// Agent: USES Range + TreeWalker; RETURNS 0 when selection is outside root.
export function getSelectionPlainOffsets(root: HTMLElement): {
  start: number;
  end: number;
} | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const offsetInRoot = (node: Node, offset: number): number => {
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };

  const start = offsetInRoot(range.startContainer, range.startOffset);
  const end = offsetInRoot(range.endContainer, range.endOffset);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

// Human: Whether a key event would mutate text inside a foreign lock (block it).
// Agent: READS key; RETURNS true for printable / delete / backspace style keys.
export function isTextMutatingKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    // Allow shortcuts like copy; block cut/paste/formatting that mutate
    const key = event.key.toLowerCase();
    return key === "v" || key === "x" || key === "backspace" || key === "delete";
  }
  if (event.key === "Backspace" || event.key === "Delete" || event.key === "Enter") {
    return true;
  }
  if (event.key.length === 1) return true;
  return false;
}
