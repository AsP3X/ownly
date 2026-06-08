// Human: Central spreadsheet editor state — selection, undo, clipboard, keyboard, mutations.
// Agent: OWNS workbook snapshot; PUSHES undo; RECALCULATES formulas after edits.

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import {
  clearRangeInWorkbook,
  clipboardToTsv,
  copyRangeFromSheet,
  pasteRangeIntoWorkbook,
  tsvToClipboardPayload,
  type ClipboardPayload,
  type PasteMode,
} from "@/lib/spreadsheet/clipboard";
import { recalculateWorkbook } from "@/lib/spreadsheet/formulas";
import { applyFormulaBarEdit } from "@/lib/spreadsheet/parse";
import { normalizeRange, rangeAddressLabel, singleCellRange } from "@/lib/spreadsheet/selection";
import {
  canRedo,
  canUndo,
  cloneWorkbook,
  createUndoStack,
  pushUndo,
  redo,
  undo,
  type UndoStack,
} from "@/lib/spreadsheet/undo";
import type { CellAddress, CellStyle, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

type UseSpreadsheetEditorOptions = {
  readOnly: boolean;
};

export type SpreadsheetEditorViewFlags = {
  showFormulas: boolean;
  showGridlines: boolean;
};

export function useSpreadsheetEditor({ readOnly }: UseSpreadsheetEditorOptions) {
  const [workbook, setWorkbookState] = useState<SpreadsheetWorkbook | null>(null);
  const [savedWorkbook, setSavedWorkbook] = useState<SpreadsheetWorkbook | null>(null);
  const [undoStack, setUndoStack] = useState<UndoStack>(createUndoStack(null));
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [selectionAnchor, setSelectionAnchor] = useState<CellAddress>({ row: 3, col: 3 });
  const [selectionEnd, setSelectionEnd] = useState<CellAddress>({ row: 3, col: 3 });
  const [editingCell, setEditingCell] = useState<CellAddress | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [filterHiddenRows, setFilterHiddenRows] = useState<Set<number>>(new Set());
  const [viewFlags, setViewFlags] = useState<SpreadsheetEditorViewFlags>({
    showFormulas: false,
    showGridlines: true,
  });

  const selectionRange = useMemo(
    () => normalizeRange({ start: selectionAnchor, end: selectionEnd }),
    [selectionAnchor, selectionEnd],
  );

  const activeCellAddress = selectionEnd;
  const activeSheet = workbook?.sheets[activeSheetIndex] ?? null;

  const dirty = useMemo(() => {
    if (!workbook || !savedWorkbook) return false;
    return JSON.stringify(workbook) !== JSON.stringify(savedWorkbook);
  }, [savedWorkbook, workbook]);

  const isLoaded = workbook !== null;

  const setWorkbook = useCallback(
    (next: SpreadsheetWorkbook | null, options?: { recordUndo?: boolean }) => {
      setWorkbookState((current) => {
        if (options?.recordUndo !== false && current && next) {
          setUndoStack((stack) => pushUndo(stack, current));
        }
        return next;
      });
    },
    [],
  );

  const loadWorkbook = useCallback((parsed: SpreadsheetWorkbook) => {
    // Human: Show parsed sheet immediately; recalc in a follow-up tick so open stays responsive.
    // Agent: FALLBACK to parsed workbook when formula evaluation throws on complex sheets.
    setWorkbookState(parsed);
    setSavedWorkbook(cloneWorkbook(parsed));
    setUndoStack(createUndoStack(parsed));
    setActiveSheetIndex(0);
    setSelectionAnchor({ row: 3, col: 3 });
    setSelectionEnd({ row: 3, col: 3 });
    setEditingCell(null);
    setFilterHiddenRows(new Set());
    setViewFlags({ showFormulas: false, showGridlines: true });

    queueMicrotask(() => {
      try {
        const calculated = recalculateWorkbook(parsed);
        setWorkbookState(calculated);
        setSavedWorkbook(cloneWorkbook(calculated));
        setUndoStack(createUndoStack(calculated));
      } catch {
        // Keep parsed workbook when recalc fails — grid still renders imported values.
      }
    });
  }, []);

  const resetEditor = useCallback(() => {
    setWorkbookState(null);
    setSavedWorkbook(null);
    setUndoStack(createUndoStack(null));
    setActiveSheetIndex(0);
    setSelectionAnchor({ row: 3, col: 3 });
    setSelectionEnd({ row: 3, col: 3 });
    setEditingCell(null);
    setClipboard(null);
    setFilterHiddenRows(new Set());
    setViewFlags({ showFormulas: false, showGridlines: true });
  }, []);

  const commitWorkbookMutation = useCallback(
    (mutator: (current: SpreadsheetWorkbook) => SpreadsheetWorkbook) => {
      if (!workbook || readOnly) return;
      try {
        const next = recalculateWorkbook(mutator(workbook));
        setWorkbook(next);
      } catch {
        setWorkbook(mutator(workbook));
      }
    },
    [readOnly, setWorkbook, workbook],
  );

  const selectCell = useCallback((address: CellAddress, extend = false) => {
    if (extend) {
      setSelectionEnd(address);
      return;
    }
    setSelectionAnchor(address);
    setSelectionEnd(address);
    setEditingCell(null);
  }, []);

  const startEditing = useCallback(
    (address: CellAddress, initialValue?: string) => {
      if (readOnly) return;
      setSelectionAnchor(address);
      setSelectionEnd(address);
      setEditingCell(address);
      if (initialValue !== undefined) {
        setEditDraft(initialValue);
        return;
      }
      const cell = workbook?.sheets[activeSheetIndex]?.rows[address.row]?.[address.col];
      if (cell?.formula) setEditDraft(cell.formula);
      else if (cell?.value === null || cell?.value === undefined) setEditDraft("");
      else setEditDraft(String(cell.value));
    },
    [activeSheetIndex, readOnly, workbook],
  );

  const commitEdit = useCallback(
    (input?: string) => {
      if (!workbook || !editingCell || readOnly) {
        setEditingCell(null);
        return;
      }
      const value = input ?? editDraft;
      const next = applyFormulaBarEdit(
        workbook,
        activeSheetIndex,
        editingCell.row,
        editingCell.col,
        value,
      );
      setWorkbook(next);
      setEditingCell(null);
    },
    [activeSheetIndex, editDraft, editingCell, readOnly, setWorkbook, workbook],
  );

  const commitFormulaBar = useCallback(
    (input: string) => {
      if (!workbook || readOnly) return;
      const next = applyFormulaBarEdit(
        workbook,
        activeSheetIndex,
        activeCellAddress.row,
        activeCellAddress.col,
        input,
      );
      setWorkbook(next);
    },
    [activeCellAddress.col, activeCellAddress.row, activeSheetIndex, readOnly, setWorkbook, workbook],
  );

  const applyStyleToSelection = useCallback(
    (patch: Partial<CellStyle>) => {
      if (!workbook || readOnly) return;
      commitWorkbookMutation((current) => {
        const range = selectionRange;
        const nextSheets = current.sheets.map((sheet, index) => {
          if (index !== activeSheetIndex) return sheet;
          const nextRows = sheet.rows.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const inRange =
                rowIndex >= range.start.row &&
                rowIndex <= range.end.row &&
                colIndex >= range.start.col &&
                colIndex <= range.end.col;
              if (!inRange) return cell;
              const style = { ...cell.style, ...patch };
              return {
                ...cell,
                style,
                display: cell.formula
                  ? cell.display
                  : formatCellDisplay(cell.value, style.numberFormat ?? "general"),
              };
            }),
          );
          return { ...sheet, rows: nextRows };
        });
        return { sheets: nextSheets };
      });
    },
    [activeSheetIndex, commitWorkbookMutation, readOnly, selectionRange, workbook],
  );

  const copySelection = useCallback(async () => {
    if (!activeSheet) return;
    const payload = copyRangeFromSheet(activeSheet, selectionRange);
    setClipboard(payload);
    try {
      await navigator.clipboard.writeText(clipboardToTsv(payload));
    } catch {
      // Internal clipboard still works when system clipboard denied.
    }
  }, [activeSheet, selectionRange]);

  const cutSelection = useCallback(async () => {
    if (!workbook || readOnly || !activeSheet) return;
    await copySelection();
    commitWorkbookMutation((current) =>
      clearRangeInWorkbook(current, activeSheetIndex, selectionRange),
    );
  }, [activeSheet, activeSheetIndex, commitWorkbookMutation, copySelection, readOnly, selectionRange, workbook]);

  const pasteClipboard = useCallback(
    async (mode: PasteMode = "all") => {
      if (!workbook || readOnly) return;
      let payload = clipboard;
      if (!payload) {
        try {
          const text = await navigator.clipboard.readText();
          payload = tsvToClipboardPayload(text);
        } catch {
          return;
        }
      }
      commitWorkbookMutation((current) =>
        pasteRangeIntoWorkbook(current, activeSheetIndex, activeCellAddress, payload!, mode),
      );
    },
    [activeCellAddress, activeSheetIndex, clipboard, commitWorkbookMutation, readOnly, workbook],
  );

  const performUndo = useCallback(() => {
    if (!workbook) return;
    const result = undo(undoStack, workbook);
    if (!result.workbook) return;
    setUndoStack(result.stack);
    setWorkbookState(recalculateWorkbook(result.workbook));
    setEditingCell(null);
  }, [undoStack, workbook]);

  const performRedo = useCallback(() => {
    if (!workbook) return;
    const result = redo(undoStack, workbook);
    if (!result.workbook) return;
    setUndoStack(result.stack);
    setWorkbookState(recalculateWorkbook(result.workbook));
    setEditingCell(null);
  }, [undoStack, workbook]);

  const moveSelection = useCallback(
    (deltaRow: number, deltaCol: number, extend: boolean) => {
      if (!activeSheet) return;
      const maxRow = Math.max(activeSheet.rows.length - 1, 0);
      const maxCol = Math.max(...activeSheet.rows.map((row) => row.length), 1) - 1;
      const next = {
        row: Math.max(0, Math.min(maxRow, activeCellAddress.row + deltaRow)),
        col: Math.max(0, Math.min(maxCol, activeCellAddress.col + deltaCol)),
      };
      if (extend) {
        setSelectionEnd(next);
      } else {
        setSelectionAnchor(next);
        setSelectionEnd(next);
      }
      setEditingCell(null);
    },
    [activeCellAddress.col, activeCellAddress.row, activeSheet],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (readOnly) return;

      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) performRedo();
        else performUndo();
        return;
      }
      if (isMeta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        performRedo();
        return;
      }
      if (isMeta && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copySelection();
        return;
      }
      if (isMeta && event.key.toLowerCase() === "x") {
        event.preventDefault();
        void cutSelection();
        return;
      }
      if (isMeta && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void pasteClipboard(event.shiftKey ? "values" : "all");
        return;
      }
      if (isMeta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        return;
      }

      if (editingCell) {
        if (event.key === "Enter") {
          event.preventDefault();
          commitEdit();
          moveSelection(event.shiftKey ? -1 : 1, 0, false);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setEditingCell(null);
        } else if (event.key === "Tab") {
          event.preventDefault();
          commitEdit();
          moveSelection(0, event.shiftKey ? -1 : 1, false);
        }
        return;
      }

      const extend = event.shiftKey;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          moveSelection(-1, 0, extend);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveSelection(1, 0, extend);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveSelection(0, -1, extend);
          break;
        case "ArrowRight":
          event.preventDefault();
          moveSelection(0, 1, extend);
          break;
        case "Tab":
          event.preventDefault();
          moveSelection(0, event.shiftKey ? -1 : 1, false);
          break;
        case "Enter":
          event.preventDefault();
          if (event.shiftKey) moveSelection(-1, 0, false);
          else moveSelection(1, 0, false);
          break;
        case "F2":
          event.preventDefault();
          startEditing(activeCellAddress);
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          commitWorkbookMutation((current) => {
            const range = selectionRange;
            const nextSheets = current.sheets.map((sheet, index) => {
              if (index !== activeSheetIndex) return sheet;
              const nextRows = sheet.rows.map((row, rowIndex) =>
                row.map((cell, colIndex) => {
                  const inRange =
                    rowIndex >= range.start.row &&
                    rowIndex <= range.end.row &&
                    colIndex >= range.start.col &&
                    colIndex <= range.end.col;
                  if (!inRange) return cell;
                  return { ...cell, value: null, formula: undefined, display: "" };
                }),
              );
              return { ...sheet, rows: nextRows };
            });
            return { sheets: nextSheets };
          });
          break;
        default:
          if (event.key.length === 1 && !isMeta) {
            startEditing(activeCellAddress, event.key);
          }
          break;
      }
    },
    [
      activeCellAddress,
      activeSheetIndex,
      commitEdit,
      commitWorkbookMutation,
      copySelection,
      cutSelection,
      editingCell,
      moveSelection,
      pasteClipboard,
      performRedo,
      performUndo,
      readOnly,
      selectionRange,
      startEditing,
    ],
  );

  useEffect(() => {
    if (!activeSheet) return;
    setViewFlags((current) => ({
      showFormulas: activeSheet.showFormulas ?? current.showFormulas,
      showGridlines: activeSheet.showGridlines ?? current.showGridlines,
    }));
  }, [activeSheet]);

  return {
    workbook,
    savedWorkbook,
    dirty,
    isLoaded,
    activeSheetIndex,
    setActiveSheetIndex,
    activeSheet,
    selectionRange,
    selectionAnchor,
    selectionEnd,
    activeCellAddress,
    selectCell,
    rangeAddressLabel: rangeAddressLabel(selectionRange),
    editingCell,
    editDraft,
    setEditDraft,
    startEditing,
    commitEdit,
    commitFormulaBar,
    applyStyleToSelection,
    copySelection,
    cutSelection,
    pasteClipboard,
    performUndo,
    performRedo,
    canUndo: canUndo(undoStack),
    canRedo: canRedo(undoStack),
    loadWorkbook,
    resetEditor,
    setWorkbook,
    commitWorkbookMutation,
    handleGridKeyDown,
    filterHiddenRows,
    setFilterHiddenRows,
    viewFlags,
    setViewFlags,
    singleCellRange,
  };
}
