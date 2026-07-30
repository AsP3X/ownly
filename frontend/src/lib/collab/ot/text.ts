// Human: Client OT for plain-text replace ops — must stay in parity with backend collab/ot/text.rs.
// Agent: PURE; USED by document adapter + CollabClient pending rebase.

export type TextReplace = {
  index: number;
  delete: number;
  insert: string;
};

export function insertLen(op: TextReplace): number {
  return [...op.insert].length;
}

export function applyReplace(text: string, op: TextReplace): string {
  const chars = [...text];
  const len = chars.length;
  const index = Math.min(op.index, len);
  const end = Math.min(index + op.delete, len);
  return (
    chars.slice(0, index).join("") + op.insert + chars.slice(end).join("")
  );
}

/** Transform `op` so it can be applied after `against` has already been applied. */
export function transformReplace(op: TextReplace, against: TextReplace): TextReplace {
  const aIdx = op.index;
  const aDel = op.delete;
  const aEnd = aIdx + aDel;

  const bIdx = against.index;
  const bDel = against.delete;
  const bEnd = bIdx + bDel;
  const bIns = insertLen(against);

  if (bEnd <= aIdx) {
    return {
      index: Math.max(0, aIdx - bDel + bIns),
      delete: op.delete,
      insert: op.insert,
    };
  }

  if (bIdx >= aEnd) {
    return {
      index: op.index,
      delete: op.delete,
      insert: op.insert,
    };
  }

  if (bIdx <= aIdx) {
    const overlap = Math.min(aEnd, bEnd) - aIdx;
    const newDel = Math.max(0, aDel - overlap);
    return {
      index: Math.max(0, bIdx + bIns),
      delete: newDel,
      insert: op.insert,
    };
  }

  const before = bIdx - aIdx;
  const after = Math.max(0, aEnd - bEnd);
  return {
    index: op.index,
    delete: before + after,
    insert: op.insert,
  };
}

export function transformReplaceThrough(
  op: TextReplace,
  against: TextReplace[],
): TextReplace {
  let current = op;
  for (const other of against) {
    current = transformReplace(current, other);
  }
  return current;
}

export function transformOffset(offset: number, op: TextReplace): number {
  const idx = op.index;
  const del = op.delete;
  const ins = insertLen(op);
  if (offset <= idx) return offset;
  if (offset >= idx + del) return offset - del + ins;
  return idx + ins;
}

export function transformRange(
  start: number,
  end: number,
  op: TextReplace,
): { start: number; end: number } | null {
  if (end <= start) return null;
  const s = transformOffset(start, op);
  const e = transformOffset(end, op);
  if (e > s) return { start: s, end: e };
  return null;
}

/** Diff two plain strings into a single replace (common-prefix/suffix). */
export function diffPlainText(before: string, after: string): TextReplace | null {
  if (before === after) return null;
  const beforeChars = [...before];
  const afterChars = [...after];
  let start = 0;
  const minLen = Math.min(beforeChars.length, afterChars.length);
  while (start < minLen && beforeChars[start] === afterChars[start]) {
    start += 1;
  }
  let endBefore = beforeChars.length;
  let endAfter = afterChars.length;
  while (
    endBefore > start &&
    endAfter > start &&
    beforeChars[endBefore - 1] === afterChars[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return {
    index: start,
    delete: endBefore - start,
    insert: afterChars.slice(start, endAfter).join(""),
  };
}
