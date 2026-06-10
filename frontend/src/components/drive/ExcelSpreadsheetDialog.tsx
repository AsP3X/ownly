// Human: Full-screen Excel spreadsheet preview dialog — Pencil Excel Dialog Frame (sgOxg).
// Agent: FETCHES blob; PARSES xlsx; RENDERS ribbon/grid/copilot; SAVE replace upload on Save & Close.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  deleteFile,
  fetchFileBlobForPreview,
  fetchPublicShareBlobForPreview,
  getErrorMessage,
  uploadFileWithProgress,
} from "@/api/client";
import { ExcelAutoFilterDialog } from "@/components/drive/excel/ExcelAutoFilterDialog";
import { ExcelCellCommentDialog } from "@/components/drive/excel/ExcelCellCommentDialog";
import { ExcelChartDialog } from "@/components/drive/excel/ExcelChartDialog";
import { ExcelCopilotSidebar } from "@/components/drive/excel/ExcelCopilotSidebar";
import { ExcelDataValidationDialog } from "@/components/drive/excel/ExcelDataValidationDialog";
import { ExcelDialogHeader } from "@/components/drive/excel/ExcelDialogHeader";
import { ExcelFindReplaceDialog } from "@/components/drive/excel/ExcelFindReplaceDialog";
import { ExcelInsertFunctionDialog } from "@/components/drive/excel/ExcelInsertFunctionDialog";
import { ExcelPageSetupDialog } from "@/components/drive/excel/ExcelPageSetupDialog";
import { ExcelPasteSpecialDialog } from "@/components/drive/excel/ExcelPasteSpecialDialog";
import { ExcelProtectSheetDialog } from "@/components/drive/excel/ExcelProtectSheetDialog";
import { ExcelTextToColumnsDialog } from "@/components/drive/excel/ExcelTextToColumnsDialog";
import { ExcelNamedRangeDialog } from "@/components/drive/excel/ExcelNamedRangeDialog";
import { ExcelPageMarginsDialog } from "@/components/drive/excel/ExcelPageMarginsDialog";
import { ExcelPivotTableDialog } from "@/components/drive/excel/ExcelPivotTableDialog";
import { ExcelPrintPreviewDialog } from "@/components/drive/excel/ExcelPrintPreviewDialog";
import { ExcelFormulaBar } from "@/components/drive/excel/ExcelFormulaBar";
import { ExcelSheetTabsBar } from "@/components/drive/excel/ExcelSheetTabsBar";
import {
  ExcelSpreadsheetRibbon,
  type RibbonTabId,
} from "@/components/drive/excel/ExcelSpreadsheetRibbon";
import { ExcelSpreadsheetGrid } from "@/components/drive/excel/ExcelSpreadsheetGrid";
import { ExcelStatusBar } from "@/components/drive/excel/ExcelStatusBar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  excelDialogContentClass,
  excelDialogShellClass,
} from "@/components/drive/excel/excel-dialog-scale";
import { useIsDesktopExcelViewport } from "@/hooks/useIsDesktopExcelViewport";
import { useSpreadsheetEditor } from "@/hooks/useSpreadsheetEditor";
import { buildCopilotAnalysis } from "@/lib/spreadsheet/copilot";
import { cellAddressLabel, columnIndexToLetters, formulaBarValue } from "@/lib/spreadsheet/cells";
import type { DataValidationRule } from "@/lib/spreadsheet/data-validation";
import type { PageMargins } from "@/lib/spreadsheet/types";
import {
  distinctColumnValues,
  hiddenRowsForColumnFilter,
  type ColumnFilterConfig,
} from "@/lib/spreadsheet/filter-values";
import {
  columnRangeFromSelection,
  statusBadgePresetRules,
} from "@/lib/spreadsheet/conditional-formatting";
import { buildAutoSumFormula } from "@/lib/spreadsheet/formulas";
import { chartBarsFromSelection, chartDataBoundsFromSelection } from "@/lib/spreadsheet/chart-data";
import { normalizeRange } from "@/lib/spreadsheet/selection";
import type { SheetChartType } from "@/lib/spreadsheet/types";
import { clearCellStylePatch } from "@/lib/spreadsheet/cell-styles";
import {
  readExcelAutoSaveEnabled,
  writeExcelAutoSaveEnabled,
} from "@/lib/spreadsheet/excel-editor-preferences";
import { parseSpreadsheetBuffer, serializeSpreadsheetWorkbook } from "@/lib/spreadsheet/parse";
import { computeSelectionStats, formatSelectionStatsLine } from "@/lib/spreadsheet/stats";
import { precedentCellKey, precedentCellsFromFormula } from "@/lib/spreadsheet/trace-precedents";
import {
  addSheet,
  activeSheetIndexAfterMove,
  deleteColumn,
  deleteRow,
  findInSheet,
  formatRangeAsTable,
  freezePanesAt,
  importCsvAsNewSheet,
  insertChartOnSheet,
  insertColumn,
  insertPivotSummaryAsNewSheet,
  insertRow,
  mergeCellsInRange,
  moveSheet,
  removeNamedRange,
  removeDuplicateRows,
  removeSheet,
  renameSheet,
  replaceInWorkbook,
  setCellComment,
  setColumnValidation,
  setNamedRange,
  setPageMargins,
  setPageSetup,
  setPrintArea,
  clearPrintArea,
  setSheetProtection,
  setSheetZoom,
  setTrackChangesEnabled,
  sortSheetByColumn,
  textToColumns,
  toggleColumnHidden,
  toggleRowHidden,
  unfreezePanes,
} from "@/lib/spreadsheet/workbook-ops";
import {
  rulesFromPreset,
  type ConditionalFormatPreset,
} from "@/components/drive/excel/ExcelConditionalFormatMenu";

export type ExcelSpreadsheetDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSaved?: (previousId: string, file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  shareToken?: string;
  sharePassword?: string | null;
};

const DEFAULT_PAGE_MARGINS: PageMargins = {
  top: 0.75,
  bottom: 0.75,
  left: 0.7,
  right: 0.7,
  header: 0.3,
  footer: 0.3,
};

export function ExcelSpreadsheetDialog({
  file,
  open,
  onOpenChange,
  onFileSaved,
  onShare,
  shareToken,
  sharePassword,
}: ExcelSpreadsheetDialogProps) {
  const readOnly = Boolean(shareToken);
  const isDesktopViewport = useIsDesktopExcelViewport(open);
  const editor = useSpreadsheetEditor({ readOnly });
  const { loadWorkbook: loadEditorWorkbook, resetEditor } = editor;
  const flushGridDimensionsRef = useRef<(() => void) | null>(null);
  // Human: Track which file id was loaded so replace-on-save does not re-fetch the workbook.
  // Agent: SET after load/save; READ in open effect to skip disruptive reload.
  const loadedFileIdRef = useRef<string | null>(null);
  const skipReloadAfterSaveRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [ribbonTab, setRibbonTab] = useState<RibbonTabId>("home");
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [nameManagerOpen, setNameManagerOpen] = useState(false);
  const [marginsOpen, setMarginsOpen] = useState(false);
  const [pivotOpen, setPivotOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [columnFilter, setColumnFilter] = useState<ColumnFilterConfig>({
    textQuery: "",
    selectedValues: null,
  });
  const [precedentHighlight, setPrecedentHighlight] = useState<Set<string>>(new Set());
  const [insertFunctionOpen, setInsertFunctionOpen] = useState(false);
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => readExcelAutoSaveEnabled());
  const [textToColumnsOpen, setTextToColumnsOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<"pen" | "eraser" | null>(null);
  const [drawColor, setDrawColor] = useState("#2563EB");

  const activeSheet = editor.activeSheet;
  const activeCell =
    activeSheet?.rows[editor.activeCellAddress.row]?.[editor.activeCellAddress.col];

  const cellStyle = activeCell?.style ?? {};

  const copilotAnalysis = useMemo(
    () => (activeSheet ? buildCopilotAnalysis(activeSheet.rows, editor.activeCellAddress) : null),
    [activeSheet, editor.activeCellAddress],
  );

  const metricsLine = useMemo(() => {
    const stats = computeSelectionStats(activeSheet?.rows ?? [], editor.activeCellAddress);
    return formatSelectionStatsLine(stats);
  }, [activeSheet?.rows, editor.activeCellAddress]);

  const chartSeries = useMemo(() => {
    if (!activeSheet) return [];
    return chartBarsFromSelection(activeSheet, editor.selectionRange);
  }, [activeSheet, editor.selectionRange]);

  const handleInsertChart = useCallback(
    (type: SheetChartType) => {
      if (readOnly || !activeSheet) return;
      const range = normalizeRange(editor.selectionRange);
      const dataBounds = chartDataBoundsFromSelection(activeSheet, range);
      editor.commitWorkbookMutation((current) =>
        insertChartOnSheet(current, editor.activeSheetIndex, {
          id: `ownly-chart-${Date.now()}`,
          type,
          title: "Chart",
          anchorRow: Math.min(range.end.row + 2, activeSheet.rows.length),
          anchorCol: range.start.col,
          anchorEndRow: Math.min(range.end.row + 14, activeSheet.rows.length + 12),
          anchorEndCol: range.start.col + 7,
          dataStartRow: dataBounds.start.row,
          dataStartCol: dataBounds.start.col,
          dataEndRow: dataBounds.end.row,
          dataEndCol: dataBounds.end.col,
          imported: false,
        }),
      );
    },
    [activeSheet, editor, readOnly],
  );

  const filterColumnValues = useMemo(() => {
    if (!activeSheet) return [];
    return distinctColumnValues(activeSheet, editor.activeCellAddress.col);
  }, [activeSheet, editor.activeCellAddress.col]);

  const activeColumnLabel = columnIndexToLetters(editor.activeCellAddress.col);

  const handleSelectCell = useCallback(
    (address: Parameters<typeof editor.selectCell>[0], extend?: boolean) => {
      setPrecedentHighlight(new Set());
      editor.selectCell(address, extend);
    },
    [editor],
  );

  const handleSelectAll = useCallback(() => {
    if (!activeSheet) return;
    setPrecedentHighlight(new Set());
    const columnCount = Math.max(...activeSheet.rows.map((row) => row.length), 1);
    editor.selectAll(activeSheet.rows.length, columnCount);
  }, [activeSheet, editor]);

  const loadFile = useCallback(
    async (target: FileItem) => {
      setLoading(true);
      setLoadError("");
      try {
        const blob = shareToken
          ? await fetchPublicShareBlobForPreview(shareToken, target.id, sharePassword)
          : await fetchFileBlobForPreview(target);
        const buffer = await blob.arrayBuffer();
        const workbook = await parseSpreadsheetBuffer(buffer);
        loadEditorWorkbook(workbook);
      } catch (error) {
        setLoadError(getErrorMessage(error));
        resetEditor();
      } finally {
        setLoading(false);
      }
    },
    [loadEditorWorkbook, resetEditor, sharePassword, shareToken],
  );

  // Human: Load workbook when the dialog opens or user picks a different file — not after autosave.
  // Agent: SKIPS reload when parent swaps file id after replace-on-save upload.
  useEffect(() => {
    if (!open || !file) return;

    if (skipReloadAfterSaveRef.current) {
      skipReloadAfterSaveRef.current = false;
      loadedFileIdRef.current = file.id;
      return;
    }

    if (loadedFileIdRef.current === file.id) return;

    loadedFileIdRef.current = file.id;
    queueMicrotask(() => {
      void loadFile(file);
    });
  }, [file, loadFile, open]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        loadedFileIdRef.current = null;
        skipReloadAfterSaveRef.current = false;
        resetEditor();
        setLoadError("");
        setSaving(false);
        setSaveError("");
        setRibbonTab("home");
        setCopilotCollapsed(false);
        setFindOpen(false);
        setChartOpen(false);
        setFilterOpen(false);
        setValidationOpen(false);
        setCommentOpen(false);
        setNameManagerOpen(false);
        setMarginsOpen(false);
        setPivotOpen(false);
        setPrintPreviewOpen(false);
        setColumnFilter({ textQuery: "", selectedValues: null });
        setPrecedentHighlight(new Set());
        setInsertFunctionOpen(false);
        setPasteSpecialOpen(false);
        setPageSetupOpen(false);
        setProtectOpen(false);
        setTextToColumnsOpen(false);
        setDrawMode(null);
        setDrawColor("#2563EB");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetEditor],
  );

  const handleConditionalFormatPreset = useCallback(
    (preset: ConditionalFormatPreset) => {
      if (!editor.workbook || !activeSheet || readOnly) return;

      const range = columnRangeFromSelection(editor.activeCellAddress, activeSheet.rows.length);
      const existing = activeSheet.conditionalFormats ?? [];
      const nextPriority =
        existing.reduce((max, rule) => Math.max(max, rule.priority), 0) + 1;

      let nextRules = [...existing];
      if (preset.kind === "clear") {
        nextRules = existing.filter((rule) => rule.range.startCol !== range.startCol);
      } else if (preset.kind === "statusPresets") {
        nextRules = [
          ...existing.filter((rule) => rule.range.startCol !== range.startCol),
          ...statusBadgePresetRules(range, nextPriority),
        ];
      } else {
        nextRules = [...existing, ...rulesFromPreset(preset, range, nextPriority)];
      }

      editor.commitWorkbookMutation((current) => ({
        sheets: current.sheets.map((sheet, index) =>
          index === editor.activeSheetIndex ? { ...sheet, conditionalFormats: nextRules } : sheet,
        ),
      }));
    },
    [activeSheet, editor, readOnly],
  );

  // Human: Title-bar Save — persist workbook without closing the dialog.
  // Agent: Same upload path as Save & Close; silent mode for autosave (no reload, no saving banner).
  const handleSave = useCallback(
    async (options?: { silent?: boolean }) => {
      flushGridDimensionsRef.current?.();
      const workbook = editor.getWorkbookForSave();
      if (!file || !workbook || readOnly || !editor.isWorkbookDirty(workbook)) return;

      const silent = options?.silent ?? false;
      if (!silent) setSaving(true);
      setSaveError("");
      try {
        const blob = await serializeSpreadsheetWorkbook(workbook);
        const savedBuffer = await blob.arrayBuffer();
        editor.commitSavedBuffer(savedBuffer, { preserveUndo: silent });
        const nextFileObject = new File([blob], file.name, {
          type: file.mime_type ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        await deleteFile(file.id, { permanent: true });
        const result = await uploadFileWithProgress(nextFileObject, undefined, {
          folderId: file.folder_id,
        });
        skipReloadAfterSaveRef.current = true;
        onFileSaved?.(file.id, result.file);
      } catch (error) {
        setSaveError(getErrorMessage(error));
      } finally {
        if (!silent) setSaving(false);
      }
    },
    [editor, file, onFileSaved, readOnly],
  );

  // Human: When AutoSave is on, debounce cloud save after dirty edits (title bar toggle).
  // Agent: READS autoSaveEnabled + editor.dirty; CALLS handleSave after 2s idle; SKIPS read-only.
  useEffect(() => {
    if (!autoSaveEnabled || readOnly || !editor.dirty || !open) return;
    const timer = window.setTimeout(() => {
      void handleSave({ silent: true });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, editor.dirty, handleSave, open, readOnly]);

  const handleSaveCopy = useCallback(async () => {
    flushGridDimensionsRef.current?.();
    const workbook = editor.getWorkbookForSave();
    if (!workbook || !file) return;
    const blob = await serializeSpreadsheetWorkbook(workbook);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name.replace(/\.xlsx?$/i, "") + "-copy.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [editor, file]);

  const handleRegisterDimensionFlush = useCallback((flush: (() => void) | null) => {
    flushGridDimensionsRef.current = flush;
  }, []);

  // Human: Persist AutoSave toggle so manual-save chrome stays hidden on next open.
  // Agent: WRITES localStorage; UPDATES React state for ribbon/header visibility.
  const handleAutoSaveChange = useCallback((enabled: boolean) => {
    setAutoSaveEnabled(enabled);
    writeExcelAutoSaveEnabled(enabled);
  }, []);

  const handleFindNext = useCallback(
    (query: string) => {
      if (!activeSheet) return;
      const match = findInSheet(activeSheet, query, editor.activeCellAddress);
      if (match) editor.selectCell(match);
    },
    [activeSheet, editor],
  );

  const handleReplace = useCallback(
    (findText: string, replaceText: string) => {
      if (!editor.workbook || readOnly) return;
      editor.commitWorkbookMutation((current) =>
        replaceInWorkbook(
          current,
          editor.activeSheetIndex,
          editor.selectionRange,
          findText,
          replaceText,
          false,
        ),
      );
    },
    [editor, readOnly],
  );

  const handleReplaceAll = useCallback(
    (findText: string, replaceText: string) => {
      if (!editor.workbook || readOnly) return;
      editor.commitWorkbookMutation((current) =>
        replaceInWorkbook(current, editor.activeSheetIndex, null, findText, replaceText, true),
      );
    },
    [editor, readOnly],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      editor.handleGridKeyDown(event);
    },
    [editor],
  );

  const handleApplyFilter = useCallback(
    (filter: ColumnFilterConfig) => {
      setColumnFilter(filter);
      if (!activeSheet) return;
      editor.setFilterHiddenRows(
        hiddenRowsForColumnFilter(activeSheet, editor.activeCellAddress.col, filter),
      );
    },
    [activeSheet, editor],
  );

  const handleClearFilter = useCallback(() => {
    setColumnFilter({ textQuery: "", selectedValues: null });
    editor.setFilterHiddenRows(new Set());
  }, [editor]);

  const formulaValue = formulaBarValue(activeCell);

  // Human: Narrow viewports get read-only grid (no ribbon) instead of a hard block.
  // Agent: LOADS workbook on mobile; RENDERS scaled grid when activeSheet is ready.
  if (!isDesktopViewport) {
    return (
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="gap-2 border border-[#E5E7EB] bg-white p-3 sm:max-w-full" overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{file?.name ?? "Spreadsheet"}</DialogTitle>
            <DialogDescription>Read-only mobile view. Use a desktop browser to edit.</DialogDescription>
          </DialogHeader>
          {loading ? <p className="text-sm text-[#666666]">Loading…</p> : null}
          {loadError ? <p className="text-sm text-[#EF4444]">{loadError}</p> : null}
          {activeSheet ? (
            <div className="max-h-[70vh] overflow-auto">
              <ExcelSpreadsheetGrid
                sheetKey={activeSheet.name}
                rows={activeSheet.rows}
                conditionalFormats={activeSheet.conditionalFormats}
                columnWidths={activeSheet.columnWidths}
                rowHeights={activeSheet.rowHeights}
                readOnly
                selectionRange={editor.selectionRange}
                editingCell={null}
                editDraft=""
                showFormulas={false}
                showGridlines
                filterHiddenRows={editor.filterHiddenRows}
                frozenRows={activeSheet.frozenRows ?? 0}
                frozenCols={activeSheet.frozenCols ?? 0}
                mergedRegions={activeSheet.mergedRegions}
                hiddenRows={activeSheet.hiddenRows}
                hiddenCols={activeSheet.hiddenCols}
                zoomPercent={activeSheet.zoomPercent ?? 100}
                onSelectCell={handleSelectCell}
                onStartEditing={() => undefined}
                onEditDraftChange={() => undefined}
                onCommitEdit={() => undefined}
                onGridKeyDown={() => undefined}
              />
            </div>
          ) : null}
          <DialogFooter className="border-0 bg-transparent px-0 py-0">
            <Button type="button" onClick={() => handleDialogOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        motionlessPopup
        className={excelDialogContentClass}
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Spreadsheet preview"}</DialogTitle>
          <DialogDescription>View and edit spreadsheet files in the browser.</DialogDescription>
        </DialogHeader>

        <div className={excelDialogShellClass}>
          <ExcelDialogHeader
            file={file}
            dirty={editor.dirty}
            saving={saving}
            loading={loading}
            loaded={editor.isLoaded}
            readOnly={readOnly}
            autoSaveEnabled={autoSaveEnabled}
            onShare={file && onShare ? () => onShare(file) : undefined}
            onSave={() => void handleSave()}
            onClose={() => handleDialogOpenChange(false)}
          />

          {saveError ? (
            <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-5 py-2 text-xs text-[#B91C1C]" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ExcelSpreadsheetRibbon
                activeTab={ribbonTab}
                fileName={file?.name}
                cellStyle={cellStyle}
                readOnly={readOnly}
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                onSave={() => void handleSave()}
                autoSaveEnabled={autoSaveEnabled}
                onAutoSaveChange={handleAutoSaveChange}
                onShare={file && onShare ? () => onShare(file) : undefined}
                onFillDown={() => {
                  if (readOnly) return;
                  const end = editor.selectionRange.end;
                  editor.performFill({ row: end.row + 1, col: end.col });
                }}
                onFormatAsTable={() => {
                  if (readOnly || !editor.workbook) return;
                  const name =
                    window.prompt("Table name", `Table${(activeSheet?.tables?.length ?? 0) + 1}`) ?? "";
                  if (!name.trim()) return;
                  editor.commitWorkbookMutation((current) =>
                    formatRangeAsTable(current, editor.activeSheetIndex, editor.selectionRange, name),
                  );
                }}
                onClearFormatting={() => editor.applyStyleToSelection(clearCellStylePatch())}
                showGridlines={editor.viewFlags.showGridlines}
                showFormulas={editor.viewFlags.showFormulas || activeSheet?.showFormulas}
                onTabChange={setRibbonTab}
                onStyleChange={editor.applyStyleToSelection}
                onConditionalFormatPreset={handleConditionalFormatPreset}
                onCopy={() => void editor.copySelection()}
                onCut={() => void editor.cutSelection()}
                onPaste={() => void editor.pasteClipboard()}
                onPasteSpecial={() => setPasteSpecialOpen(true)}
                onFormatPainter={() => {
                  if (editor.formatPainterActive) editor.cancelFormatPainter();
                  else editor.activateFormatPainter();
                }}
                formatPainterActive={editor.formatPainterActive}
                onUndo={() => editor.performUndo()}
                onRedo={() => editor.performRedo()}
                onSaveCopy={() => void handleSaveCopy()}
                onPrint={() => setPrintPreviewOpen(true)}
                onExportPdf={() => setPrintPreviewOpen(true)}
                onToggleGridlines={() =>
                  editor.setViewFlags((current) => ({ ...current, showGridlines: !current.showGridlines }))
                }
                onToggleShowFormulas={() =>
                  editor.setViewFlags((current) => ({ ...current, showFormulas: !current.showFormulas }))
                }
                onAutoSum={() => {
                  if (readOnly) return;
                  const formula = buildAutoSumFormula(editor.selectionRange);
                  editor.commitFormulaBar(formula);
                }}
                onInsertFunction={() => {
                  if (readOnly) return;
                  setInsertFunctionOpen(true);
                }}
                onPageSetup={() => setPageSetupOpen(true)}
                onTextToColumns={() => setTextToColumnsOpen(true)}
                onProtectSheet={() => setProtectOpen(true)}
                onTrackChanges={() =>
                  editor.commitWorkbookMutation(
                    (current) => setTrackChangesEnabled(current, !current.trackChangesEnabled),
                    { bypassProtection: true },
                  )
                }
                onHideRow={() =>
                  editor.commitWorkbookMutation((current) =>
                    toggleRowHidden(current, editor.activeSheetIndex, editor.activeCellAddress.row),
                  )
                }
                onHideColumn={() =>
                  editor.commitWorkbookMutation((current) =>
                    toggleColumnHidden(current, editor.activeSheetIndex, editor.activeCellAddress.col),
                  )
                }
                zoomPercent={activeSheet?.zoomPercent ?? 100}
                onZoomChange={(percent) =>
                  editor.commitWorkbookMutation(
                    (current) => setSheetZoom(current, editor.activeSheetIndex, percent),
                    { bypassProtection: true },
                  )
                }
                drawMode={drawMode}
                drawColor={drawColor}
                onDrawModeChange={setDrawMode}
                onDrawColorChange={setDrawColor}
                onClearDrawings={() =>
                  editor.commitWorkbookMutation((current) => ({
                    sheets: current.sheets.map((sheet, index) =>
                      index === editor.activeSheetIndex ? { ...sheet, drawings: undefined } : sheet,
                    ),
                  }))
                }
                onSortAsc={() =>
                  editor.commitWorkbookMutation((current) =>
                    sortSheetByColumn(current, editor.activeSheetIndex, editor.activeCellAddress.col, "asc"),
                  )
                }
                onSortDesc={() =>
                  editor.commitWorkbookMutation((current) =>
                    sortSheetByColumn(current, editor.activeSheetIndex, editor.activeCellAddress.col, "desc"),
                  )
                }
                onFilter={() => setFilterOpen(true)}
                onClearFilter={handleClearFilter}
                onInsertRow={() =>
                  editor.commitWorkbookMutation((current) =>
                    insertRow(current, editor.activeSheetIndex, editor.activeCellAddress.row),
                  )
                }
                onDeleteRow={() =>
                  editor.commitWorkbookMutation((current) =>
                    deleteRow(current, editor.activeSheetIndex, editor.activeCellAddress.row),
                  )
                }
                onInsertColumn={() =>
                  editor.commitWorkbookMutation((current) =>
                    insertColumn(current, editor.activeSheetIndex, editor.activeCellAddress.col),
                  )
                }
                onDeleteColumn={() =>
                  editor.commitWorkbookMutation((current) =>
                    deleteColumn(current, editor.activeSheetIndex, editor.activeCellAddress.col),
                  )
                }
                onMergeCells={() =>
                  editor.commitWorkbookMutation((current) =>
                    mergeCellsInRange(current, editor.activeSheetIndex, editor.selectionRange),
                  )
                }
                onFindReplace={() => setFindOpen(true)}
                onFreezePanes={() =>
                  editor.commitWorkbookMutation((current) =>
                    freezePanesAt(
                      current,
                      editor.activeSheetIndex,
                      editor.activeCellAddress.row,
                      editor.activeCellAddress.col,
                    ),
                  )
                }
                onUnfreezePanes={() =>
                  editor.commitWorkbookMutation((current) =>
                    unfreezePanes(current, editor.activeSheetIndex),
                  )
                }
                onSetPrintArea={() => {
                  if (readOnly) return;
                  editor.commitWorkbookMutation((current) =>
                    setPrintArea(current, editor.activeSheetIndex, editor.selectionRange),
                  );
                }}
                onClearPrintArea={() => {
                  if (readOnly) return;
                  editor.commitWorkbookMutation((current) =>
                    clearPrintArea(current, editor.activeSheetIndex),
                  );
                }}
                onPageMargins={() => setMarginsOpen(true)}
                onPrintPreview={() => setPrintPreviewOpen(true)}
                onRemoveDuplicates={() =>
                  editor.commitWorkbookMutation((current) =>
                    removeDuplicateRows(current, editor.activeSheetIndex, editor.activeCellAddress.col),
                  )
                }
                onImportCsv={() => {
                  const csvText = window.prompt("Paste CSV or TSV data") ?? "";
                  if (!csvText.trim() || !editor.workbook) return;
                  const name = window.prompt("Sheet name", `Import${editor.workbook.sheets.length + 1}`) ?? "Import";
                  const next = importCsvAsNewSheet(editor.workbook, csvText, name);
                  editor.setWorkbook(next);
                  editor.setActiveSheetIndex(next.sheets.length - 1);
                }}
                onInsertChart={() => setChartOpen(true)}
                onInsertPivot={() => setPivotOpen(true)}
                onInsertTable={() => {
                  if (readOnly || !editor.workbook) return;
                  const name =
                    window.prompt("Table name", `Table${(activeSheet?.tables?.length ?? 0) + 1}`) ?? "";
                  if (!name.trim()) return;
                  editor.commitWorkbookMutation((current) =>
                    formatRangeAsTable(current, editor.activeSheetIndex, editor.selectionRange, name),
                  );
                }}
                onTracePrecedents={() => {
                  const refs = precedentCellsFromFormula(activeCell?.formula);
                  setPrecedentHighlight(new Set(refs.map(precedentCellKey)));
                }}
                onNameManager={() => setNameManagerOpen(true)}
                onDataValidation={() => setValidationOpen(true)}
                onEditComment={() => setCommentOpen(true)}
              />

              <ExcelFormulaBar
                cellLabel={editor.rangeAddressLabel}
                value={formulaValue}
                readOnly={readOnly}
                onCommit={editor.commitFormulaBar}
              />

              {loading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#666666]">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  Loading spreadsheet…
                </div>
              ) : null}

              {loadError ? (
                <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#EF4444]" role="alert">
                  {loadError}
                </p>
              ) : null}

              {!loading && !loadError && activeSheet ? (
                <>
                  <ExcelSpreadsheetGrid
                    sheetKey={activeSheet.name}
                    rows={activeSheet.rows}
                    conditionalFormats={activeSheet.conditionalFormats}
                    columnWidths={activeSheet.columnWidths}
                    rowHeights={activeSheet.rowHeights}
                    readOnly={readOnly}
                    selectionRange={editor.selectionRange}
                    editingCell={editor.editingCell}
                    editDraft={editor.editDraft}
                    showFormulas={editor.viewFlags.showFormulas || activeSheet.showFormulas}
                    showGridlines={editor.viewFlags.showGridlines}
                    filterHiddenRows={editor.filterHiddenRows}
                    frozenRows={activeSheet.frozenRows ?? 0}
                    frozenCols={activeSheet.frozenCols ?? 0}
                    precedentHighlight={precedentHighlight}
                    printArea={activeSheet.printArea ?? null}
                    mergedRegions={activeSheet.mergedRegions}
                    hiddenRows={activeSheet.hiddenRows}
                    hiddenCols={activeSheet.hiddenCols}
                    zoomPercent={activeSheet.zoomPercent ?? 100}
                    charts={activeSheet.charts}
                    drawings={activeSheet.drawings}
                    drawMode={drawMode}
                    drawColor={drawColor}
                    onSelectCell={(address, extend) => {
                      if (editor.formatPainterActive) {
                        editor.selectCell(address, extend);
                        editor.applyFormatPainter();
                        return;
                      }
                      handleSelectCell(address, extend);
                    }}
                    onSelectAll={handleSelectAll}
                    onStartEditing={editor.startEditing}
                    onEditDraftChange={editor.setEditDraft}
                    onCommitEdit={editor.commitEdit}
                    onGridKeyDown={handleGridKeyDown}
                    onFillDragEnd={editor.performFill}
                    onColumnWidthsChange={editor.setSheetColumnWidths}
                    onRowHeightsChange={editor.setSheetRowHeights}
                    onRegisterDimensionFlush={handleRegisterDimensionFlush}
                  />
                  <ExcelSheetTabsBar
                    sheets={editor.workbook?.sheets.map((sheet) => sheet.name) ?? []}
                    activeIndex={editor.activeSheetIndex}
                    readOnly={readOnly}
                    onSelectSheet={editor.setActiveSheetIndex}
                    onAddSheet={() => {
                      if (readOnly || !editor.workbook) return;
                      const next = addSheet(editor.workbook);
                      editor.setWorkbook(next);
                      editor.setActiveSheetIndex(next.sheets.length - 1);
                    }}
                    onRenameSheet={(index, name) => {
                      if (readOnly) return;
                      editor.commitWorkbookMutation((current) => renameSheet(current, index, name));
                    }}
                    onDeleteSheet={(index) => {
                      if (readOnly) return;
                      editor.commitWorkbookMutation((current) => removeSheet(current, index));
                      editor.setActiveSheetIndex(Math.max(0, index - 1));
                    }}
                    onMoveSheet={(fromIndex, toIndex) => {
                      if (readOnly) return;
                      const nextActive = activeSheetIndexAfterMove(
                        editor.activeSheetIndex,
                        fromIndex,
                        toIndex,
                      );
                      editor.commitWorkbookMutation((current) => moveSheet(current, fromIndex, toIndex));
                      editor.setActiveSheetIndex(nextActive);
                    }}
                  />
                  <ExcelStatusBar
                    metricsLine={metricsLine}
                    undoAvailable={editor.canUndo}
                    redoAvailable={editor.canRedo}
                    zoomPercent={activeSheet.zoomPercent ?? 100}
                    onZoomChange={(percent) =>
                      editor.commitWorkbookMutation(
                        (current) => setSheetZoom(current, editor.activeSheetIndex, percent),
                        { bypassProtection: true },
                      )
                    }
                  />
                </>
              ) : null}

              {!loading && !loadError && !activeSheet ? (
                <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#666666]">
                  Spreadsheet data could not be displayed. Try closing and reopening the file.
                </p>
              ) : null}
            </div>

            <ExcelCopilotSidebar
              analysis={copilotAnalysis}
              collapsed={copilotCollapsed}
              onCollapsedChange={setCopilotCollapsed}
              onNavigateToCell={(address) => editor.selectCell(address)}
            />
            </div>
          </div>
        </div>

        <ExcelInsertFunctionDialog
          open={insertFunctionOpen}
          onOpenChange={setInsertFunctionOpen}
          onInsert={(formula) => editor.commitFormulaBar(formula)}
        />

        <ExcelPasteSpecialDialog
          open={pasteSpecialOpen}
          onOpenChange={setPasteSpecialOpen}
          onPaste={({ mode, transpose }) => void editor.pasteClipboard(mode, transpose)}
        />

        <ExcelPageSetupDialog
          open={pageSetupOpen}
          onOpenChange={setPageSetupOpen}
          initial={activeSheet?.pageSetup}
          onApply={(setup) =>
            editor.commitWorkbookMutation((current) =>
              setPageSetup(current, editor.activeSheetIndex, setup),
            )
          }
        />

        <ExcelProtectSheetDialog
          open={protectOpen}
          onOpenChange={setProtectOpen}
          currentlyProtected={Boolean(activeSheet?.protection?.locked)}
          onApply={(protection) =>
            editor.commitWorkbookMutation(
              (current) => setSheetProtection(current, editor.activeSheetIndex, protection),
              { bypassProtection: true },
            )
          }
        />

        <ExcelTextToColumnsDialog
          open={textToColumnsOpen}
          onOpenChange={setTextToColumnsOpen}
          columnLabel={activeColumnLabel}
          onApply={(delimiter) =>
            editor.commitWorkbookMutation((current) =>
              textToColumns(current, editor.activeSheetIndex, editor.activeCellAddress.col, delimiter),
            )
          }
        />

        <ExcelFindReplaceDialog
          open={findOpen}
          onOpenChange={setFindOpen}
          onFindNext={handleFindNext}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
        />

        <ExcelChartDialog
          open={chartOpen}
          onOpenChange={setChartOpen}
          title={`Chart — ${file?.name ?? "Spreadsheet"}`}
          series={chartSeries}
          onInsert={handleInsertChart}
        />

        <ExcelAutoFilterDialog
          key={`filter-${editor.activeCellAddress.col}-${filterOpen ? "open" : "closed"}`}
          open={filterOpen}
          onOpenChange={setFilterOpen}
          columnLabel={activeColumnLabel}
          values={filterColumnValues}
          initialFilter={columnFilter}
          onApply={handleApplyFilter}
          onClear={handleClearFilter}
        />

        <ExcelDataValidationDialog
          key={`validation-${editor.activeCellAddress.col}-${validationOpen ? "open" : "closed"}`}
          open={validationOpen}
          onOpenChange={setValidationOpen}
          columnLabel={activeColumnLabel}
          initialRule={
            activeSheet?.columnValidations?.[editor.activeCellAddress.col] ?? null
          }
          onApply={(rule: DataValidationRule | null) => {
            editor.commitWorkbookMutation((current) =>
              setColumnValidation(current, editor.activeSheetIndex, editor.activeCellAddress.col, rule),
            );
          }}
        />

        <ExcelCellCommentDialog
          key={`comment-${cellAddressLabel(editor.activeCellAddress)}-${commentOpen ? "open" : "closed"}`}
          open={commentOpen}
          onOpenChange={setCommentOpen}
          cellLabel={cellAddressLabel(editor.activeCellAddress)}
          initialComment={activeCell?.comment ?? ""}
          readOnly={readOnly}
          onSave={(comment) => {
            editor.commitWorkbookMutation((current) =>
              setCellComment(
                current,
                editor.activeSheetIndex,
                editor.activeCellAddress.row,
                editor.activeCellAddress.col,
                comment,
              ),
            );
          }}
          onDelete={() => {
            editor.commitWorkbookMutation((current) =>
              setCellComment(
                current,
                editor.activeSheetIndex,
                editor.activeCellAddress.row,
                editor.activeCellAddress.col,
                null,
              ),
            );
          }}
        />

        <ExcelNamedRangeDialog
          key={`names-${nameManagerOpen ? "open" : "closed"}-${editor.workbook?.namedRanges?.length ?? 0}`}
          open={nameManagerOpen}
          onOpenChange={setNameManagerOpen}
          ranges={editor.workbook?.namedRanges ?? []}
          selectionLabel={editor.rangeAddressLabel}
          onAddRange={(name) => {
            if (!activeSheet) return;
            const range = editor.selectionRange;
            editor.commitWorkbookMutation((current) =>
              setNamedRange(current, {
                name,
                sheetName: activeSheet.name,
                startRow: range.start.row,
                startCol: range.start.col,
                endRow: range.end.row,
                endCol: range.end.col,
              }),
            );
          }}
          onRemoveRange={(name) => {
            editor.commitWorkbookMutation((current) => removeNamedRange(current, name));
          }}
        />

        <ExcelPageMarginsDialog
          key={`margins-${marginsOpen ? "open" : "closed"}-${editor.activeSheetIndex}`}
          open={marginsOpen}
          onOpenChange={setMarginsOpen}
          initialMargins={activeSheet?.pageMargins ?? DEFAULT_PAGE_MARGINS}
          onApply={(margins) => {
            editor.commitWorkbookMutation((current) =>
              setPageMargins(current, editor.activeSheetIndex, margins),
            );
          }}
        />

        {activeSheet ? (
          <ExcelPivotTableDialog
            key={`pivot-${pivotOpen ? "open" : "closed"}-${editor.rangeAddressLabel}`}
            open={pivotOpen}
            onOpenChange={setPivotOpen}
            sheet={activeSheet}
            selectionRange={editor.selectionRange}
            onInsertSheet={(sheetName, summary) => {
              if (readOnly || !editor.workbook) return;
              const nextIndex = editor.workbook.sheets.length;
              editor.commitWorkbookMutation((current) =>
                insertPivotSummaryAsNewSheet(current, sheetName, summary),
              );
              editor.setActiveSheetIndex(nextIndex);
            }}
          />
        ) : null}

        {activeSheet ? (
          <ExcelPrintPreviewDialog
            key={`print-${printPreviewOpen ? "open" : "closed"}-${activeSheet.name}`}
            open={printPreviewOpen}
            onOpenChange={setPrintPreviewOpen}
            sheet={activeSheet}
            sheetName={activeSheet.name}
            margins={activeSheet.pageMargins ?? DEFAULT_PAGE_MARGINS}
            showFormulas={editor.viewFlags.showFormulas || activeSheet.showFormulas}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
