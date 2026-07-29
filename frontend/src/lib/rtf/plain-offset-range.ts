// Human: Map plain-text offsets ↔ DOM ranges; lock mark helpers for collab highlights.
// Agent: WALKS text nodes (skips collab chrome); USED by locks, carets, text ops.

export const COLLAB_LOCK_MARK_ATTR = "data-rtf-collab-lock";

function isCollabChromeText(node: Text): boolean {
  const el = node.parentElement;
  if (!el) return false;
  if (el.getAttribute(COLLAB_LOCK_MARK_ATTR) === "label") return true;
  if (el.closest?.(`[${COLLAB_LOCK_MARK_ATTR}="label"]`)) return true;
  return false;
}

// Human: Plain text in the same coordinate system as locks/carets/text ops.
// Agent: Concatenates text nodes only (no virtual newlines — offsets must match DOM points).
export function rootPlainText(root: HTMLElement): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (!isCollabChromeText(node)) {
      parts.push(node.data);
    }
    node = walker.nextNode() as Text | null;
  }
  return parts.join("");
}

export function plainOffsetAt(root: HTMLElement, node: Node, offset: number): number {
  try {
    if (node.nodeType === Node.TEXT_NODE) {
      let total = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode() as Text | null;
      while (current) {
        if (current === node) {
          if (!isCollabChromeText(current)) {
            total += Math.min(offset, current.data.length);
          }
          return total;
        }
        if (!isCollabChromeText(current)) {
          total += current.data.length;
        }
        current = walker.nextNode() as Text | null;
      }
      return total;
    }
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, offset);
    return pre.toString().length;
  } catch {
    return 0;
  }
}

export function rangeFromPlainOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (!root || end < start) return null;
  if (end === start) {
    // Collapsed: use a one-char range when possible
    const probe = rangeFromPlainOffsets(root, start, start + 1);
    if (probe) {
      probe.collapse(true);
      return probe;
    }
    if (start > 0) {
      const prev = rangeFromPlainOffsetsNonCollapsed(root, start - 1, start);
      if (prev) {
        prev.collapse(false);
        return prev;
      }
    }
    return null;
  }
  return rangeFromPlainOffsetsNonCollapsed(root, start, end);
}

function rangeFromPlainOffsetsNonCollapsed(
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

function pointAtPlainOffset(root: HTMLElement, target: number): TextPoint | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, target);
  let last: TextPoint | null = null;
  let node = walker.nextNode() as Text | null;

  while (node) {
    if (isCollabChromeText(node)) {
      node = walker.nextNode() as Text | null;
      continue;
    }
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

export function stripCollabLockMarks(root: HTMLElement): void {
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
    if (parent instanceof HTMLElement) parent.normalize();
  });
}

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

function colorParts(color: string): {
  backgroundColor: string;
  borderColor: string;
  solid: string;
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
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.35)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.9)`,
    solid: `rgb(${r}, ${g}, ${b})`,
  };
}

export type LockBubbleRect = {
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
};

export type CaretMarker = {
  key: string;
  top: number;
  left: number;
  height: number;
  color: string;
  label: string;
};

// Human: Paint lock ranges as real DOM marks (visible background) — labels via CSS attr only.
// Agent: STRIP prior marks; WRAP text slices; data-collab-name for ::before chip.
export function applyCollabLockMarks(
  root: HTMLElement,
  locks: CollabLockDecoration[],
): void {
  ensureLockMarkStyles();
  stripCollabLockMarks(root);

  const ordered = [...locks]
    .filter((lock) => lock.end > lock.start)
    .sort((a, b) => b.start - a.start);

  for (const lock of ordered) {
    wrapPlainOffsetRange(root, lock.start, lock.end, lock);
  }
}

function ensureLockMarkStyles(): void {
  if (typeof document === "undefined") return;
  const id = "ownly-rtf-collab-lock-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    [${COLLAB_LOCK_MARK_ATTR}="1"] {
      border-radius: 0.35em;
      padding: 0.05em 0.12em;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      position: relative;
    }
    [${COLLAB_LOCK_MARK_ATTR}="1"][data-collab-first="1"]::before {
      content: attr(data-collab-name) " · locked";
      position: absolute;
      left: 0;
      bottom: calc(100% + 2px);
      max-width: 12rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 9px;
      font-weight: 700;
      line-height: 1.2;
      color: #fff;
      background: var(--collab-lock-color, #2563eb);
      box-shadow: 0 1px 3px rgba(0,0,0,0.18);
      pointer-events: none;
      z-index: 3;
    }
  `;
  document.head.appendChild(style);
}

function wrapPlainOffsetRange(
  root: HTMLElement,
  start: number,
  end: number,
  lock: CollabLockDecoration,
): void {
  const slices = collectTextSlices(root, start, end);
  let isFirst = true;
  for (const slice of slices) {
    if (!slice.node.parentNode || slice.end <= slice.start) continue;
    let textNode = slice.node;
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
    // Human: Do not set contenteditable=false — it blocks remote text-op DOM applies and caret moves.
    // Agent: UI keydown still rejects typing in foreign locks; marks are visual only.
    if (isFirst) {
      mark.setAttribute("data-collab-first", "1");
      isFirst = false;
    }
    const styles = colorParts(lock.color);
    mark.style.backgroundColor = styles.backgroundColor;
    mark.style.boxShadow = `inset 0 0 0 1.5px ${styles.borderColor}`;
    mark.style.setProperty("--collab-lock-color", styles.solid);
    mark.title = `${lock.displayName} is editing this section`;

    const parent = textNode.parentNode;
    if (!parent) continue;
    parent.insertBefore(mark, textNode);
    mark.appendChild(textNode);
  }
}

type TextSlice = { node: Text; start: number; end: number };

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
    if (isCollabChromeText(node)) {
      node = walker.nextNode() as Text | null;
      continue;
    }
    const len = node.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + len;
    const overlapStart = Math.max(start, nodeStart);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapEnd > overlapStart && !node.parentElement?.hasAttribute(COLLAB_LOCK_MARK_ATTR)) {
      slices.push({
        node,
        start: overlapStart - nodeStart,
        end: overlapEnd - nodeStart,
      });
    }
    cursor = nodeEnd;
    if (cursor >= end) break;
    node = walker.nextNode() as Text | null;
  }
  return slices;
}

export function measureLockBubbleRects(
  root: HTMLElement,
  container: HTMLElement,
  locks: CollabLockDecoration[],
): LockBubbleRect[] {
  const containerRect = container.getBoundingClientRect();
  const next: LockBubbleRect[] = [];
  for (const lock of locks) {
    if (lock.end <= lock.start) continue;
    const range = rangeFromPlainOffsetsNonCollapsed(root, lock.start, lock.end);
    if (!range) continue;
    const styles = colorParts(lock.color);
    let index = 0;
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 0.5 || rect.height < 1) continue;
      next.push({
        key: `${lock.userId}-${lock.start}-${lock.end}-${index}`,
        top: rect.top - containerRect.top - 2,
        left: rect.left - containerRect.left - 3,
        width: Math.max(rect.width + 6, 4),
        height: rect.height + 4,
        color: styles.solid,
        label: lock.displayName,
        isFirst: index === 0,
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
      });
      index += 1;
    }
  }
  return next;
}

export function measureCaretMarker(
  root: HTMLElement,
  container: HTMLElement,
  offset: number,
  userId: string,
  label: string,
  color: string,
): CaretMarker | null {
  const containerRect = container.getBoundingClientRect();
  const styles = colorParts(color);
  const start = Math.max(0, Math.floor(offset));

  const nextRange = rangeFromPlainOffsetsNonCollapsed(root, start, start + 1);
  if (nextRange) {
    const rect = nextRange.getClientRects()[0] ?? nextRange.getBoundingClientRect();
    if (rect && rect.height >= 1) {
      return {
        key: `caret-${userId}`,
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        height: Math.max(rect.height, 16),
        color: styles.solid,
        label,
      };
    }
  }

  if (start > 0) {
    const prevRange = rangeFromPlainOffsetsNonCollapsed(root, start - 1, start);
    if (prevRange) {
      const rects = prevRange.getClientRects();
      const rect = rects[rects.length - 1] ?? prevRange.getBoundingClientRect();
      if (rect && rect.height >= 1) {
        return {
          key: `caret-${userId}`,
          top: rect.top - containerRect.top,
          left: rect.right - containerRect.left,
          height: Math.max(rect.height, 16),
          color: styles.solid,
          label,
        };
      }
    }
  }

  const rootRect = root.getBoundingClientRect();
  const style = window.getComputedStyle(root);
  const padTop = Number.parseFloat(style.paddingTop || "0") || 0;
  const padLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
  return {
    key: `caret-${userId}`,
    top: rootRect.top - containerRect.top + padTop,
    left: rootRect.left - containerRect.left + padLeft,
    height: 18,
    color: styles.solid,
    label,
  };
}

export function measureSelectionRects(
  root: HTMLElement,
  container: HTMLElement,
  start: number,
  end: number,
  userId: string,
  label: string,
  color: string,
): LockBubbleRect[] {
  if (end <= start) return [];
  return measureLockBubbleRects(root, container, [
    {
      userId: `${userId}-sel`,
      displayName: label,
      color,
      start,
      end,
    },
  ]).map((r) => ({
    ...r,
    key: `sel-${userId}-${r.key}`,
    backgroundColor: colorParts(color).backgroundColor.replace("0.35", "0.2"),
    borderColor: "transparent",
    isFirst: false,
  }));
}
