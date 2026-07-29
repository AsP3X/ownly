// Human: Map plain-text offsets ↔ DOM ranges using the same model as selection offsets.
// Agent: WALKS text nodes (skips collab decoration chrome); USED by locks + highlights.

export const COLLAB_LOCK_MARK_ATTR = "data-rtf-collab-lock";

// Human: True when a text node is ephemeral collab chrome (name chips), not document text.
// Agent: SKIP in offset walks so lock highlights do not shift plain offsets.
function isCollabChromeText(node: Text): boolean {
  const el = node.parentElement;
  if (!el) return false;
  if (el.getAttribute(COLLAB_LOCK_MARK_ATTR) === "label") return true;
  if (el.closest?.(`[${COLLAB_LOCK_MARK_ATTR}="label"]`)) return true;
  return false;
}

// Human: Plain text under root matching selection offset walks (excludes collab chrome).
// Agent: Concatenate non-chrome text nodes; USED for sentence locks.
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

// Human: Offset of a caret point inside root (skips collab chrome text).
// Agent: WALKS text nodes until node; ADDS offset within node.
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
    // Element caret: measure via range but subtract chrome if needed
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, offset);
    // Fallback for non-text anchors
    return pre.toString().length;
  } catch {
    return 0;
  }
}

// Human: Build a Range covering [start, end) plain-text offsets under root.
// Agent: pointAtPlainOffset for both ends; RETURNS null when empty.
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

// Human: Locate the text-node caret for a plain offset (skips collab chrome).
// Agent: WALKS text nodes; cumulative lengths; CLAMPS to document end.
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

// Human: Remove legacy DOM lock marks if any remain (older clients / failed paints).
// Agent: UNWRAP [data-rtf-collab-lock]; USED before CSS-highlight paint and on unmount.
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
    if (parent instanceof HTMLElement) {
      parent.normalize();
    }
  });
}

// Human: Serialize editor HTML without ephemeral collab decorations.
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

function colorParts(color: string): {
  backgroundColor: string;
  borderColor: string;
  solid: string;
  r: number;
  g: number;
  b: number;
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
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.38)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.85)`,
    solid: `rgb(${r}, ${g}, ${b})`,
    r,
    g,
    b,
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

export type CollabPresenceDecoration = {
  userId: string;
  displayName: string;
  color: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  lockStart: number | null;
  lockEnd: number | null;
};

// Human: Measure Docs-style bubble rects for foreign locks.
// Agent: rangeFromPlainOffsets + getClientRects; coords relative to positioning container.
export function measureLockBubbleRects(
  root: HTMLElement,
  container: HTMLElement,
  locks: CollabLockDecoration[],
): LockBubbleRect[] {
  const containerRect = container.getBoundingClientRect();
  const next: LockBubbleRect[] = [];

  for (const lock of locks) {
    if (lock.end <= lock.start) continue;
    const range = rangeFromPlainOffsets(root, lock.start, lock.end);
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

// Human: Measure a remote caret (and optional selection band) at plain-text offsets.
// Agent: collapsed Range → getBoundingClientRect; FALLBACK expand one char when zero-size.
export function measureCaretMarker(
  root: HTMLElement,
  container: HTMLElement,
  offset: number,
  userId: string,
  label: string,
  color: string,
): CaretMarker | null {
  const point = rangeFromPlainOffsets(root, offset, offset + 1);
  const containerRect = container.getBoundingClientRect();
  let rect: DOMRect | null = null;

  if (point) {
    const clientRects = point.getClientRects();
    if (clientRects.length > 0) {
      rect = clientRects[0] ?? null;
    }
    if (!rect || rect.height < 1) {
      const br = point.getBoundingClientRect();
      if (br.height >= 1) rect = br;
    }
  }

  if (!rect || rect.height < 1) {
    // Collapsed caret at EOF / empty block — try exact collapse
    const collapsed = document.createRange();
    const endPoint = rangeFromPlainOffsets(
      root,
      Math.max(0, offset),
      Math.max(0, offset),
    );
    // rangeFromPlainOffsets rejects end<=start — use pointAt via one-char then collapse
    const probe = rangeFromPlainOffsets(root, Math.max(0, offset - 1), Math.max(1, offset));
    if (probe) {
      probe.collapse(false);
      const br = probe.getBoundingClientRect();
      if (br.height >= 1) rect = br;
    }
    void collapsed;
    void endPoint;
  }

  if (!rect || rect.height < 1) return null;
  const styles = colorParts(color);
  return {
    key: `caret-${userId}`,
    top: rect.top - containerRect.top,
    left: rect.left - containerRect.left,
    height: Math.max(rect.height, 14),
    color: styles.solid,
    label,
  };
}

// Human: Selection highlight rects for remote non-collapsed selections.
// Agent: SAME as lock bubbles but softer fill; USED when selection spans multiple chars.
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
    backgroundColor: colorParts(color).backgroundColor.replace("0.38", "0.22"),
    borderColor: "transparent",
    isFirst: false,
  }));
}

// Human: Prefer CSS Custom Highlight API (non-mutating, Docs-like text background).
// Agent: REGISTERS Highlight per user; INJECTS ::highlight rules; RETURNS false when unsupported.
export function applyCssLockHighlights(
  root: HTMLElement,
  locks: CollabLockDecoration[],
): boolean {
  const cssHighlights = (
    globalThis as unknown as {
      CSS?: { highlights?: Map<string, unknown> & { set: Function; delete: Function } };
      Highlight?: new (...ranges: Range[]) => unknown;
    }
  ).CSS?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
    .Highlight;

  if (!cssHighlights || !HighlightCtor) {
    return false;
  }

  ensureHighlightStyles(locks);

  const activeNames = new Set<string>();
  for (const lock of locks) {
    if (lock.end <= lock.start) continue;
    const range = rangeFromPlainOffsets(root, lock.start, lock.end);
    if (!range) continue;
    const name = highlightName(lock.userId);
    try {
      const highlight = new HighlightCtor(range);
      cssHighlights.set(name, highlight);
      activeNames.add(name);
    } catch {
      /* ignore single lock failure */
    }
  }

  pruneHighlightStyles(activeNames);
  void root;
  return activeNames.size > 0 || locks.length === 0;
}

export function clearCssLockHighlights(userIds?: string[]): void {
  const cssHighlights = (
    globalThis as unknown as {
      CSS?: { highlights?: { delete: (name: string) => void } };
    }
  ).CSS?.highlights;
  if (!cssHighlights) return;
  if (userIds) {
    for (const id of userIds) {
      try {
        cssHighlights.delete(highlightName(id));
      } catch {
        /* ignore */
      }
    }
    return;
  }
}

function highlightName(userId: string): string {
  // CSS highlight names must be valid <custom-ident>-ish; sanitize.
  return `ownly-collab-lock-${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

const STYLE_TAG_ID = "ownly-collab-lock-highlight-styles";

function ensureHighlightStyles(locks: CollabLockDecoration[]): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_TAG_ID;
    document.head.appendChild(style);
  }

  const rules: string[] = [];
  for (const lock of locks) {
    const name = highlightName(lock.userId);
    const { r, g, b } = colorParts(lock.color);
    rules.push(
      `::highlight(${name}) { background-color: rgba(${r}, ${g}, ${b}, 0.4); color: inherit; }`,
    );
  }
  // Merge with existing rules for other users still present
  const existing = style.textContent ?? "";
  const kept = existing
    .split("\n")
    .filter((line) => {
      if (!line.includes("::highlight(ownly-collab-lock-")) return false;
      const match = /::highlight\((ownly-collab-lock-[^)]+)\)/.exec(line);
      if (!match) return false;
      const name = match[1]!;
      return locks.some((l) => highlightName(l.userId) === name);
    });
  const byName = new Map<string, string>();
  for (const line of kept) {
    const match = /::highlight\((ownly-collab-lock-[^)]+)\)/.exec(line);
    if (match) byName.set(match[1]!, line);
  }
  for (const rule of rules) {
    const match = /::highlight\((ownly-collab-lock-[^)]+)\)/.exec(rule);
    if (match) byName.set(match[1]!, rule);
  }
  style.textContent = [...byName.values()].join("\n");
}

function pruneHighlightStyles(activeNames: Set<string>): void {
  if (typeof document === "undefined") return;
  const style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!style?.textContent) return;
  const kept = style.textContent.split("\n").filter((line) => {
    const match = /::highlight\((ownly-collab-lock-[^)]+)\)/.exec(line);
    if (!match) return false;
    return activeNames.has(match[1]!);
  });
  style.textContent = kept.join("\n");
}
