// Human: Map plain-text offsets to a live DOM Range inside the contenteditable surface.
// Agent: WALKS text nodes; USED by collab lock bubble overlays.

// Human: Build a Range covering [start, end) plain-text offsets under root.
// Agent: TreeWalker over text nodes; RETURNS null when offsets are empty or out of range.
export function rangeFromPlainOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (!root || end <= start) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + len;

    if (startNode === null && start >= nodeStart && start <= nodeEnd) {
      startNode = node;
      startOffset = start - nodeStart;
    }
    if (end >= nodeStart && end <= nodeEnd) {
      endNode = node;
      endOffset = end - nodeStart;
      break;
    }

    cursor = nodeEnd;
    node = walker.nextNode() as Text | null;
  }

  // Human: Clamp end to last text when the lock extends past the current document length.
  if (startNode && !endNode) {
    const last = lastTextNode(root);
    if (!last) return null;
    endNode = last;
    endOffset = last.data.length;
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startOffset, startNode.data.length));
    range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
    if (range.collapsed) return null;
    return range;
  } catch {
    return null;
  }
}

function lastTextNode(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    last = node;
    node = walker.nextNode() as Text | null;
  }
  return last;
}
