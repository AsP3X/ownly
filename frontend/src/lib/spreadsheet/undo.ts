// Human: Undo/redo stack for spreadsheet workbook snapshots.
// Agent: PUSHES deep-cloned workbooks; CAPS history depth to limit memory.

import type { SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

const MAX_UNDO_DEPTH = 50;

export type UndoStack = {
  past: SpreadsheetWorkbook[];
  future: SpreadsheetWorkbook[];
};

export function createUndoStack(initial: SpreadsheetWorkbook | null): UndoStack {
  return {
    past: initial ? [cloneWorkbook(initial)] : [],
    future: [],
  };
}

export function cloneWorkbook(workbook: SpreadsheetWorkbook): SpreadsheetWorkbook {
  const { sourceBuffer, ...serializable } = workbook;
  const cloned = JSON.parse(JSON.stringify(serializable)) as SpreadsheetWorkbook;
  if (sourceBuffer) cloned.sourceBuffer = sourceBuffer;
  return cloned;
}

// Human: Stable JSON fingerprint for dirty detection — excludes non-serializable sourceBuffer.
// Agent: USED by useSpreadsheetEditor isWorkbookDirty.
export function workbookDirtyFingerprint(workbook: SpreadsheetWorkbook): string {
  const { sourceBuffer, ...serializable } = workbook;
  void sourceBuffer;
  return JSON.stringify(serializable);
}

export function pushUndo(stack: UndoStack, workbook: SpreadsheetWorkbook): UndoStack {
  const snapshot = cloneWorkbook(workbook);
  const past = [...stack.past, snapshot];
  if (past.length > MAX_UNDO_DEPTH) past.shift();
  return { past, future: [] };
}

export function undo(stack: UndoStack, current: SpreadsheetWorkbook): {
  stack: UndoStack;
  workbook: SpreadsheetWorkbook | null;
} {
  if (stack.past.length <= 1) return { stack, workbook: null };
  const past = [...stack.past];
  past.pop();
  const previous = past[past.length - 1];
  return {
    stack: {
      past,
      future: [cloneWorkbook(current), ...stack.future],
    },
    workbook: cloneWorkbook(previous),
  };
}

export function redo(stack: UndoStack, current: SpreadsheetWorkbook): {
  stack: UndoStack;
  workbook: SpreadsheetWorkbook | null;
} {
  if (stack.future.length === 0) return { stack, workbook: null };
  const [next, ...future] = stack.future;
  return {
    stack: {
      past: [...stack.past, cloneWorkbook(current)],
      future,
    },
    workbook: cloneWorkbook(next),
  };
}

export function canUndo(stack: UndoStack): boolean {
  return stack.past.length > 1;
}

export function canRedo(stack: UndoStack): boolean {
  return stack.future.length > 0;
}
