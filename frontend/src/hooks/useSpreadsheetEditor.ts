// Human: Central spreadsheet editor state — selection, undo, clipboard, keyboard, mutations.
// Agent: OWNS workbook snapshot; PUSHES undo; RECALCULATES formulas after edits.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyStylePatchToCell, replaceCellStyleOnCell } from "@/lib/spreadsheet/cell-styles";
import {
  clearRangeInWorkbook,
  clipboardToTsv,
  copyRangeFromSheet,
  pasteRangeIntoWorkbook,
  tsvToClipboardPayload,
  type ClipboardPayload,
  type PasteMode,
} from "@/lib/spreadsheet/clipboard";
import { fillRangeInWorkbook, fillTargetRange } from "@/lib/spreadsheet/fill-handle";
import { validateCellInput } from "@/lib/spreadsheet/data-validation";
import { recalculateWorkbook } from "@/lib/spreadsheet/formulas";
import {
  applyGridColumnWidths,
  resolveColumnWidths,
  resolveRowHeights,
} from "@/lib/spreadsheet/dimensions";
import { applyFormulaBarEdit } from "@/lib/spreadsheet/parse";
import { normalizeRange, rangeAddressLabel, singleCellRange, fullSheetRange } from "@/lib/spreadsheet/selection";
import {
  canRedo,
  canUndo,
  cloneWorkbook,
  createUndoStack,
  pushUndo,
  redo,
  undo,
  workbookDirtyFingerprint,
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

export type WorkbookMutationOptions = {
  // Human: Allow protect/unprotect and other meta ops while the sheet is locked.
  // Agent: SKIPS isSheetProtected guard when true.
  bypassProtection?: boolean;
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
  const [viewFlagsBySheet, setViewFlagsBySheet] = useState<
    Record<number, Partial<SpreadsheetEditorViewFlags>>
  >({});
  const [formatPainterStyle, setFormatPainterStyle] = useState<CellStyle | null>(null);
  const [formatPainterActive, setFormatPainterActive] = useState(false);

  // Human: Latest workbook/sheet index for save-after-flush and stable empty-deps callbacks.
  // Agent: SYNCED in layout effect + inside setState updaters when save runs before re-render.
  const activeSheetIndexRef = useRef(activeSheetIndex);
  const workbookRef = useRef<SpreadsheetWorkbook | null>(null);

  useLayoutEffect(() => {
    activeSheetIndexRef.current = activeSheetIndex;
    workbookRef.current = workbook;
  }, [activeSheetIndex, workbook]);

  const selectionRange = useMemo(
    () => normalizeRange({ start: selectionAnchor, end: selectionEnd }),
    [selectionAnchor, selectionEnd],
  );

  const activeCellAddress = selectionEnd;
  const activeSheet = workbook?.sheets[activeSheetIndex] ?? null;

  // Human: Per-sheet view overrides merged with sheet-level defaults (no effect sync).
  // Agent: READS viewFlagsBySheet[activeSheetIndex]; FALLBACK to activeSheet flags.
  const viewFlags = useMemo((): SpreadsheetEditorViewFlags => {
    const overrides = viewFlagsBySheet[activeSheetIndex] ?? {};
    return {
      showFormulas: overrides.showFormulas ?? activeSheet?.showFormulas ?? false,
      showGridlines: overrides.showGridlines ?? activeSheet?.showGridlines ?? true,
    };
  }, [activeSheet, activeSheetIndex, viewFlagsBySheet]);

  const setViewFlags = useCallback(
    (
      updater:
        | SpreadsheetEditorViewFlags
        | ((current: SpreadsheetEditorViewFlags) => SpreadsheetEditorViewFlags),
    ) => {
      setViewFlagsBySheet((current) => {
        const sheet = workbookRef.current?.sheets[activeSheetIndexRef.current];
        const prevEffective: SpreadsheetEditorViewFlags = {
          showFormulas:
            current[activeSheetIndexRef.current]?.showFormulas ?? sheet?.showFormulas ?? false,
          showGridlines:
            current[activeSheetIndexRef.current]?.showGridlines ?? sheet?.showGridlines ?? true,
        };
        const next = typeof updater === "function" ? updater(prevEffective) : updater;
        return { ...current, [activeSheetIndexRef.current]: next };
      });
    },
    [],
  );
  const activeCell = activeSheet?.rows[activeCellAddress.row]?.[activeCellAddress.col];

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
        workbookRef.current = next;
        return next;
      });
    },
    [],
  );

  const getWorkbookForSave = useCallback((): SpreadsheetWorkbook | null => workbookRef.current, []);

  // Human: After a successful cloud save, point passthrough sourceBuffer at the uploaded bytes.
  // Agent: UPDATES workbook + saved snapshot; OPTIONAL preserveUndo for silent autosave.
  const commitSavedBuffer = useCallback(
    (buffer: ArrayBuffer, options?: { preserveUndo?: boolean }) => {
      setWorkbookState((current) => {
        if (!current) return current;
        const next = { ...current, sourceBuffer: buffer };
        setSavedWorkbook(cloneWorkbook(next));
        if (!options?.preserveUndo) {
          setUndoStack(createUndoStack(next));
        }
        return next;
      });
    },
    [],
  );

  const isWorkbookDirty = useCallback(
    (candidate?: SpreadsheetWorkbook | null) => {
      const current = candidate ?? workbookRef.current;
      if (!current || !savedWorkbook) return false;
      return workbookDirtyFingerprint(current) !== workbookDirtyFingerprint(savedWorkbook);
    },
    [savedWorkbook],
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
    setViewFlagsBySheet({});

    queueMicrotask(() => {
      setWorkbookState((current) => {
        if (!current) return current;
        try {
          const calculated = recalculateWorkbook(current);
          setSavedWorkbook(cloneWorkbook(calculated));
          setUndoStack(createUndoStack(calculated));
          return calculated;
        } catch {
          return current;
        }
      });
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
    setViewFlagsBySheet({});
  }, []);

  const isSheetProtected = useCallback(() => {
    const sheet = workbookRef.current?.sheets[activeSheetIndexRef.current];
    return Boolean(sheet?.protection?.locked);
  }, []);

  const commitWorkbookMutation = useCallback(
    (
      mutator: (current: SpreadsheetWorkbook) => SpreadsheetWorkbook,
      options?: WorkbookMutationOptions,
    ) => {
      if (readOnly || (!options?.bypassProtection && isSheetProtected())) return;
      setWorkbookState((current) => {
        if (!current) return current;
        try {
          const next = recalculateWorkbook(mutator(current));
          setUndoStack((stack) => pushUndo(stack, current));
          workbookRef.current = next;
          return next;
        } catch {
          const next = mutator(current);
          setUndoStack((stack) => pushUndo(stack, current));
          workbookRef.current = next;
          return next;
        }
      });
    },
    [isSheetProtected, readOnly],
  );

  // Human: Apply column width changes without formula recalc — uses latest workbook snapshot.
  // Agent: SYNCS workbookRef; REPLACES sparse storage from grid array (no merge with stale widths).
  const setSheetColumnWidths = useCallback(
    (widths: number[], options?: { recordUndo?: boolean }) => {
      if (readOnly || isSheetProtected()) return;
      setWorkbookState((current) => {
        if (!current) return current;
        const sheetIndex = activeSheetIndexRef.current;
        const existing = current.sheets[sheetIndex]?.columnWidths;
        const nextWidths = applyGridColumnWidths(undefined, widths);
        const resolvedBefore = resolveColumnWidths({ rows: [], columnWidths: existing }, widths.length);
        const resolvedAfter = resolveColumnWidths({ rows: [], columnWidths: nextWidths }, widths.length);
        if (resolvedBefore.every((width, index) => width === resolvedAfter[index])) return current;

        const next: SpreadsheetWorkbook = {
          ...current,
          sheets: current.sheets.map((sheet, index) =>
            index === sheetIndex ? { ...sheet, columnWidths: nextWidths } : sheet,
          ),
        };
        if (options?.recordUndo !== false) {
          setUndoStack((stack) => pushUndo(stack, current));
        }
        workbookRef.current = next;
        return next;
      });
    },
    [isSheetProtected, readOnly],
  );

  // Human: Apply row height changes without formula recalc — uses latest workbook snapshot.
  // Agent: SYNCS workbookRef immediately; COMPARES resolved heights so sparse arrays still update.
  const setSheetRowHeights = useCallback(
    (heights: number[], options?: { recordUndo?: boolean }) => {
      if (readOnly || isSheetProtected()) return;
      setWorkbookState((current) => {
        if (!current) return current;
        const sheetIndex = activeSheetIndexRef.current;
        const existing = current.sheets[sheetIndex]?.rowHeights;
        const resolvedExisting = resolveRowHeights({ rows: [], rowHeights: existing }, heights.length);
        const resolvedNext = resolveRowHeights({ rows: [], rowHeights: heights }, heights.length);
        if (resolvedExisting.every((height, index) => height === resolvedNext[index])) return current;

        const next: SpreadsheetWorkbook = {
          ...current,
          sheets: current.sheets.map((sheet, index) =>
            index === sheetIndex ? { ...sheet, rowHeights: [...heights] } : sheet,
          ),
        };
        if (options?.recordUndo !== false) {
          setUndoStack((stack) => pushUndo(stack, current));
        }
        workbookRef.current = next;
        return next;
      });
    },
    [isSheetProtected, readOnly],
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

  // Human: Select every cell on the active sheet (Excel top-left corner click).
  // Agent: SETS anchor A1 and end to last row/column; CLEARS in-cell edit.
  const selectAll = useCallback((rowCount: number, columnCount: number) => {
    const range = fullSheetRange(rowCount, columnCount);
    setSelectionAnchor(range.start);
    setSelectionEnd(range.end);
    setEditingCell(null);
  }, []);

  const startEditing = useCallback(
    (address: CellAddress, initialValue?: string) => {
      if (readOnly || isSheetProtected()) return;
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
    [activeSheetIndex, isSheetProtected, readOnly, workbook],
  );

  const commitEdit = useCallback(
    (input?: string) => {
      if (!workbook || !editingCell || readOnly || isSheetProtected()) {
        setEditingCell(null);
        return;
      }
      const value = input ?? editDraft;
      const sheet = workbook.sheets[activeSheetIndex];
      const validationRule = sheet?.columnValidations?.[editingCell.col];
      if (validationRule && !value.trim().startsWith("=")) {
        const result = validateCellInput(validationRule, value);
        if (!result.valid) {
          window.alert(result.message ?? "The value you entered is not valid for this cell.");
          return;
        }
      }
      commitWorkbookMutation((current) =>
        applyFormulaBarEdit(current, activeSheetIndex, editingCell.row, editingCell.col, value),
      );
      setEditingCell(null);
    },
    [activeSheetIndex, commitWorkbookMutation, editDraft, editingCell, isSheetProtected, readOnly, workbook],
  );

  const commitFormulaBar = useCallback(
    (input: string) => {
      if (!workbook || readOnly || isSheetProtected()) return;
      const validationRule = workbook.sheets[activeSheetIndex]?.columnValidations?.[activeCellAddress.col];
      if (validationRule && !input.trim().startsWith("=")) {
        const result = validateCellInput(validationRule, input);
        if (!result.valid) {
          window.alert(result.message ?? "The value you entered is not valid for this cell.");
          return;
        }
      }
      commitWorkbookMutation((current) =>
        applyFormulaBarEdit(
          current,
          activeSheetIndex,
          activeCellAddress.row,
          activeCellAddress.col,
          input,
        ),
      );
    },
    [
      activeCellAddress.col,
      activeCellAddress.row,
      activeSheetIndex,
      commitWorkbookMutation,
      isSheetProtected,
      readOnly,
      workbook,
    ],
  );

  const applyStyleToSelection = useCallback(
    (patch: Partial<CellStyle>) => {
      if (!workbook || readOnly || isSheetProtected()) return;
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
              return applyStylePatchToCell(cell, patch);
            }),
          );
          return { ...sheet, rows: nextRows };
        });
        return { ...current, sheets: nextSheets };
      });
    },
    [activeSheetIndex, commitWorkbookMutation, isSheetProtected, readOnly, selectionRange, workbook],
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
    if (!workbook || readOnly || isSheetProtected() || !activeSheet) return;
    await copySelection();
    commitWorkbookMutation((current) =>
      clearRangeInWorkbook(current, activeSheetIndex, selectionRange),
    );
  }, [activeSheet, activeSheetIndex, commitWorkbookMutation, copySelection, isSheetProtected, readOnly, selectionRange, workbook]);

  const pasteClipboard = useCallback(
    async (mode: PasteMode = "all", transpose = false) => {
      if (!workbook || readOnly || isSheetProtected()) return;
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
        pasteRangeIntoWorkbook(current, activeSheetIndex, activeCellAddress, payload!, mode, transpose),
      );
    },
    [activeCellAddress, activeSheetIndex, clipboard, commitWorkbookMutation, isSheetProtected, readOnly, workbook],
  );

  // Human: Copy style from active cell for Format Painter (double-click locks mode).
  // Agent: STORES CellStyle snapshot; ACTIVATES painter cursor until applied.
  const activateFormatPainter = useCallback(() => {
    if (readOnly || isSheetProtected() || !activeCell) return;
    if (activeCell.style) {
      setFormatPainterStyle({ ...activeCell.style });
      setFormatPainterActive(true);
    }
  }, [activeCell, isSheetProtected, readOnly]);

  // Human: Apply stored painter style to current selection and deactivate.
  // Agent: CALLS applyStyleToSelection with copied style patch.
  const applyFormatPainter = useCallback(() => {
    if (!formatPainterStyle || readOnly || isSheetProtected() || !workbook) return;
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
            return replaceCellStyleOnCell(cell, formatPainterStyle);
          }),
        );
        return { ...sheet, rows: nextRows };
      });
      return { ...current, sheets: nextSheets };
    });
    setFormatPainterActive(false);
    setFormatPainterStyle(null);
  }, [
    activeSheetIndex,
    commitWorkbookMutation,
    formatPainterStyle,
    isSheetProtected,
    readOnly,
    selectionRange,
    workbook,
  ]);

  // Human: Cancel Format Painter without applying copied style.
  // Agent: CLEARS painter state when user toggles off from ribbon.
  const cancelFormatPainter = useCallback(() => {
    setFormatPainterActive(false);
    setFormatPainterStyle(null);
  }, []);

  const performUndo = useCallback(() => {
    if (!workbook || readOnly || isSheetProtected()) return;
    const result = undo(undoStack, workbook);
    if (!result.workbook) return;
    const next = recalculateWorkbook(result.workbook);
    setUndoStack(result.stack);
    setWorkbookState(next);
    setEditingCell(null);
  }, [isSheetProtected, readOnly, undoStack, workbook]);

  const performRedo = useCallback(() => {
    if (!workbook || readOnly || isSheetProtected()) return;
    const result = redo(undoStack, workbook);
    if (!result.workbook) return;
    const next = recalculateWorkbook(result.workbook);
    setUndoStack(result.stack);
    setWorkbookState(next);
    setEditingCell(null);
  }, [isSheetProtected, readOnly, undoStack, workbook]);

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

  const performFill = useCallback(
    (dragEnd: CellAddress) => {
      if (!workbook || readOnly || isSheetProtected()) return;
      const target = fillTargetRange(selectionRange, dragEnd);
      if (!target) return;
      commitWorkbookMutation((current) =>
        fillRangeInWorkbook(current, activeSheetIndex, selectionRange, target),
      );
    },
    [activeSheetIndex, commitWorkbookMutation, isSheetProtected, readOnly, selectionRange, workbook],
  );

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
    selectAll,
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
    setSheetColumnWidths,
    setSheetRowHeights,
    getWorkbookForSave,
    commitSavedBuffer,
    isWorkbookDirty,
    performFill,
    handleGridKeyDown,
    filterHiddenRows,
    setFilterHiddenRows,
    viewFlags,
    setViewFlags,
    singleCellRange,
    formatPainterActive,
    activateFormatPainter,
    applyFormatPainter,
    cancelFormatPainter,
    isSheetProtected,
  };
}
