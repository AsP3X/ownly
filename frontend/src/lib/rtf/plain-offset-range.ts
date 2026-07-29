// Human: Map plain-text offsets ↔ DOM ranges using the same model as selection offsets.
// Agent: Range.toString() lengths; USED by collab locks + Docs-style lock mark wrapping.

export const COLLAB_LOCK_MARK_ATTR = "data-rtf-collab-lock";

// Human: Plain text length/model matching getSelectionPlainOffsets (Range.toString).
// Agent: selectNodeContents(root).toString(); USED for sentence locks.
export function rootPlainText(root: HTMLElement): string {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range.toString();
}

// Human: Offset of a caret point inside root using Range.toString (matches selection API).
// Agent: setEnd(node, offset); RETURNS length of prefix string.
export function plainOffsetAt(root: HTMLElement, node: Node, offset: number): number {
  try {
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, offset);
    return pre.toString().length;
  } catch {
    return 0;
  }
}

// Human: Build a Range covering [start, end) plain-text offsets under root.
// Agent: WALKS text nodes with cumulative Range.toString offsets; RETURNS null when empty.
export function rangeFromPlainOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (!root || end <= start) return null;

  const startPoint = pointAtPlainOffset(root, start);
  const endPoint = pointAtPlainOffset(root, end);
  if (!startPoint || !endPoint) return null;

  try {
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    if (range.collapsed) return null;
    return range;
  } catch {
    return null;
  }
}

type TextPoint = { node: Text; offset: number };

// Human: Locate the text-node caret for a plain offset (clamps to end of document).
// Agent: WALKS text nodes; USES cumulative data lengths (aligned with Range.toString for text).
function pointAtPlainOffset(root: HTMLElement, target: number): TextPoint | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Human: Skip ephemeral collab decoration wrappers' structure by still counting their text.
      // Agent: ACCEPT all text nodes under root (marks contain the same text).
      return node.nodeType === Node.TEXT_NODE
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let remaining = Math.max(0, target);
  let last: TextPoint | null = null;
  let node = walker.nextNode() as Text | null;

  while (node) {
    const len = node.data.length;
    last = { node, offset: len };
    if (remaining <= len) {
      return { node, offset: remaining };
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }

  return last;
}

// Human: Remove all collab lock decoration marks, preserving text content.
// Agent: UNWRAP [data-rtf-collab-lock]; normalize parents; USED before save/collab publish.
export function stripCollabLockMarks(root: HTMLElement): void {
  // Human: Remove name chips first (they are not real document text).
  root.querySelectorAll(`[${COLLAB_LOCK_MARK_ATTR}="label"]`).forEach((chip) => {
    chip.remove();
  });

  const marks = root.querySelectorAll(`[${COLLAB_LOCK_MARK_ATTR}="1"]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    if (parent instanceof HTMLElement) {
      parent.normalize();
    }
  });
}

// Human: Serialize editor HTML without ephemeral collab lock decorations.
// Agent: CLONE root; strip marks; RETURN innerHTML.
export function getHtmlWithoutCollabMarks(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  stripCollabLockMarks(clone);
  const html = clone.innerHTML;
  return html.trim() ? html : "<p><br></p>";
}

export type CollabLockDecoration = {
  userId: string;
  displayName: string;
  color: string;
  start: number;
  end: number;
};

// Human: Paint Docs/Word-style highlight marks for foreign locked ranges (ephemeral DOM only).
// Agent: STRIP previous marks; WRAP text slices in span[data-rtf-collab-lock]; box-decoration-break.
export function applyCollabLockMarks(
  root: HTMLElement,
  locks: CollabLockDecoration[],
): void {
  // Preserve selection if possible
  const selection = window.getSelection();
  const hadFocus = root.contains(document.activeElement);
  let saved: { start: number; end: number } | null = null;
  if (selection && selection.rangeCount > 0 && root.contains(selection.anchorNode)) {
    try {
      const start = plainOffsetAt(
        root,
        selection.anchorNode!,
        selection.anchorOffset,
      );
      const end = plainOffsetAt(root, selection.focusNode!, selection.focusOffset);
      saved = { start: Math.min(start, end), end: Math.max(start, end) };
    } catch {
      saved = null;
    }
  }

  stripCollabLockMarks(root);

  // Apply from end → start so earlier offsets stay valid while wrapping later ranges.
  const ordered = [...locks]
    .filter((lock) => lock.end > lock.start)
    .sort((a, b) => b.start - a.start);

  for (const lock of ordered) {
    wrapPlainOffsetRange(root, lock.start, lock.end, lock);
  }

  if (saved && hadFocus) {
    const range = rangeFromPlainOffsets(root, saved.start, saved.end);
    if (range && selection) {
      try {
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        /* ignore restore failures */
      }
    }
  }
}

// Human: Wrap every text slice in [start,end) with a colored collab mark span.
// Agent: SPLIT text nodes at boundaries; WRAP middle; styles inline for user color.
function wrapPlainOffsetRange(
  root: HTMLElement,
  start: number,
  end: number,
  lock: CollabLockDecoration,
): void {
  if (end <= start) return;

  const slices = collectTextSlices(root, start, end);
  let isFirstSlice = true;
  for (const slice of slices) {
    if (!slice.node.parentNode) continue;
    if (slice.end <= slice.start) continue;

    let textNode = slice.node;
    // Split end first so start indices stay valid on this node.
    if (slice.end < textNode.data.length) {
      textNode.splitText(slice.end);
    }
    if (slice.start > 0) {
      textNode = textNode.splitText(slice.start);
    }

    if (!textNode.data) continue;

    const mark = document.createElement("span");
    mark.setAttribute(COLLAB_LOCK_MARK_ATTR, "1");
    mark.setAttribute("data-collab-user", lock.userId);
    mark.setAttribute("data-collab-name", lock.displayName);
    mark.setAttribute("title", `${lock.displayName} is editing this section`);
    // Human: Keep text selectable but block typing via key handlers + contenteditable=false.
    mark.setAttribute("contenteditable", "false");
    if (isFirstSlice) {
      mark.setAttribute("data-collab-first", "1");
      isFirstSlice = false;
    }

    const { backgroundColor, borderColor, color } = colorParts(lock.color);
    mark.style.backgroundColor = backgroundColor;
    mark.style.boxShadow = `inset 0 0 0 1.5px ${borderColor}`;
    mark.style.borderRadius = "0.35em";
    mark.style.padding = "0.1em 0.22em";
    mark.style.margin = "0 -0.04em";
    mark.style.boxDecorationBreak = "clone";
    (mark.style as CSSStyleDeclaration & { webkitBoxDecorationBreak?: string }).webkitBoxDecorationBreak =
      "clone";
    mark.style.color = "inherit";
    mark.style.position = "relative";
    mark.dataset.collabColor = color;

    if (mark.getAttribute("data-collab-first") === "1") {
      // Human: Name chip above the first line of a foreign lock (Docs-style authorship cue).
      const chip = document.createElement("span");
      chip.setAttribute(COLLAB_LOCK_MARK_ATTR, "label");
      chip.setAttribute("contenteditable", "false");
      chip.textContent = lock.displayName;
      chip.style.cssText = [
        "position:absolute",
        "left:0",
        "bottom:100%",
        "margin-bottom:2px",
        "max-width:12rem",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "white-space:nowrap",
        "border-radius:999px",
        "padding:2px 7px",
        "font-size:9px",
        "font-weight:700",
        "line-height:1.2",
        "color:#fff",
        `background:${color}`,
        "box-shadow:0 1px 3px rgba(0,0,0,0.18)",
        "pointer-events:none",
        "z-index:2",
      ].join(";");
      mark.appendChild(chip);
    }

    const parent = textNode.parentNode;
    if (!parent) continue;
    parent.insertBefore(mark, textNode);
    mark.appendChild(textNode);
  }
}

type TextSlice = { node: Text; start: number; end: number };

// Human: List text-node slices overlapping [start, end) in plain-offset space.
// Agent: WALKS text nodes; cumulative lengths; RETURNS local start/end within each node.
function collectTextSlices(
  root: HTMLElement,
  start: number,
  end: number,
): TextSlice[] {
  const slices: TextSlice[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node = walker.nextNode() as Text | null;

  while (node) {
    const len = node.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + len;

    const overlapStart = Math.max(start, nodeStart);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapEnd > overlapStart) {
      // Skip text already inside a mark from a previous lock application this pass
      // (we strip first, so shouldn't happen) — still skip nested re-wrap.
      if (!node.parentElement?.hasAttribute(COLLAB_LOCK_MARK_ATTR)) {
        slices.push({
          node,
          start: overlapStart - nodeStart,
          end: overlapEnd - nodeStart,
        });
      }
    }

    cursor = nodeEnd;
    if (cursor >= end) break;
    node = walker.nextNode() as Text | null;
  }

  return slices;
}

function colorParts(color: string): {
  backgroundColor: string;
  borderColor: string;
  color: string;
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
    // Stronger fill so the lock reads like Docs/Word selection highlights
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.32)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.75)`,
    color: `rgb(${r}, ${g}, ${b})`,
  };
}
