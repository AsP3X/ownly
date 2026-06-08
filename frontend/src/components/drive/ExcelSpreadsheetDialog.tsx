// Human: Full-screen Excel spreadsheet preview dialog — Pencil Excel Dialog Frame (sgOxg).
// Agent: FETCHES blob; PARSES xlsx; RENDERS ribbon/grid/copilot; SAVE replace upload on Save & Close.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  deleteFile,
  fetchFileBlobForPreview,
  fetchPublicShareBlobForPreview,
  getErrorMessage,
  uploadFileWithProgress,
} from "@/api/client";
import { ExcelCopilotSidebar } from "@/components/drive/excel/ExcelCopilotSidebar";
import { ExcelDialogHeader } from "@/components/drive/excel/ExcelDialogHeader";
import { ExcelFindReplaceDialog } from "@/components/drive/excel/ExcelFindReplaceDialog";
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
  EXCEL_DIALOG_SHELL_MAX_HEIGHT_PX,
  EXCEL_DIALOG_VIEWPORT_INSET_CSS,
} from "@/components/drive/excel/excel-dialog-scale";
import { useIsDesktopExcelViewport } from "@/hooks/useIsDesktopExcelViewport";
import { useSpreadsheetEditor } from "@/hooks/useSpreadsheetEditor";
import { buildCopilotAnalysis } from "@/lib/spreadsheet/copilot";
import { formulaBarValue } from "@/lib/spreadsheet/cells";
import {
  columnRangeFromSelection,
  statusBadgePresetRules,
} from "@/lib/spreadsheet/conditional-formatting";
import { buildAutoSumFormula } from "@/lib/spreadsheet/formulas";
import { parseSpreadsheetBuffer, serializeSpreadsheetWorkbook } from "@/lib/spreadsheet/parse";
import { computeSelectionStats, formatSelectionStatsLine } from "@/lib/spreadsheet/stats";
import {
  addSheet,
  deleteColumn,
  deleteRow,
  findInSheet,
  insertColumn,
  insertRow,
  mergeCellsInRange,
  removeSheet,
  renameSheet,
  replaceInWorkbook,
  sortSheetByColumn,
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
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [ribbonTab, setRibbonTab] = useState<RibbonTabId>("home");
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

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

  useEffect(() => {
    if (!open || !file || !isDesktopViewport) return;
    void loadFile(file);
  }, [file, isDesktopViewport, loadFile, open]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetEditor();
        setLoadError("");
        setSaving(false);
        setSaveError("");
        setRibbonTab("home");
        setCopilotCollapsed(false);
        setFindOpen(false);
        setFilterQuery("");
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

  const handleSaveAndClose = useCallback(async () => {
    if (!file || !editor.workbook) {
      handleDialogOpenChange(false);
      return;
    }

    if (readOnly || !editor.dirty) {
      handleDialogOpenChange(false);
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const blob = await serializeSpreadsheetWorkbook(editor.workbook);
      const nextFileObject = new File([blob], file.name, {
        type: file.mime_type ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      await deleteFile(file.id, { permanent: true });
      const result = await uploadFileWithProgress(nextFileObject, undefined, {
        folderId: file.folder_id,
      });
      onFileSaved?.(file.id, result.file);
      handleDialogOpenChange(false);
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [editor.dirty, editor.workbook, file, handleDialogOpenChange, onFileSaved, readOnly]);

  const handleSaveCopy = useCallback(async () => {
    if (!editor.workbook || !file) return;
    const blob = await serializeSpreadsheetWorkbook(editor.workbook);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name.replace(/\.xlsx?$/i, "") + "-copy.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [editor.workbook, file]);

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
    (query: string) => {
      setFilterQuery(query);
      if (!activeSheet) return;
      const hidden = new Set<number>();
      activeSheet.rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) return;
        const display = String(row[editor.activeCellAddress.col]?.display ?? "").toLowerCase();
        if (query.trim() && !display.includes(query.trim().toLowerCase())) hidden.add(rowIndex);
      });
      editor.setFilterHiddenRows(hidden);
    },
    [activeSheet, editor],
  );

  const formulaValue = formulaBarValue(activeCell);

  if (!isDesktopViewport) {
    return (
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="gap-4 border border-[#E5E7EB] bg-white p-6 sm:max-w-md"
          overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        >
          <DialogHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB]">
              <FileSpreadsheet className="size-6" aria-hidden />
            </div>
            <DialogTitle className="text-center">{file?.name ?? "Spreadsheet preview"}</DialogTitle>
            <DialogDescription className="text-center">
              Spreadsheet preview is not supported on mobile. Open this file on a desktop browser to view and edit it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-0 bg-transparent px-0 py-0 sm:justify-center">
            <Button type="button" className="w-full sm:w-auto" onClick={() => handleDialogOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="!flex h-[min(1063px,calc(100dvh-2rem))] max-h-[calc(100dvh-1rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[calc(100vw-2rem)]"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Spreadsheet preview"}</DialogTitle>
          <DialogDescription>View and edit spreadsheet files in the browser.</DialogDescription>
        </DialogHeader>

        <div
          className="flex w-full flex-1 flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]"
          style={{
            height: `min(${EXCEL_DIALOG_SHELL_MAX_HEIGHT_PX}px, calc(100dvh - ${EXCEL_DIALOG_VIEWPORT_INSET_CSS}))`,
            minHeight: `min(${EXCEL_DIALOG_SHELL_MAX_HEIGHT_PX}px, calc(100dvh - ${EXCEL_DIALOG_VIEWPORT_INSET_CSS}))`,
          }}
        >
          <ExcelDialogHeader
            file={file}
            dirty={editor.dirty}
            saving={saving}
            loading={loading}
            loaded={editor.isLoaded}
            readOnly={readOnly}
            onShare={file && onShare ? () => onShare(file) : undefined}
            onSaveAndClose={() => void handleSaveAndClose()}
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
                cellStyle={cellStyle}
                readOnly={readOnly}
                onTabChange={setRibbonTab}
                onStyleChange={editor.applyStyleToSelection}
                onConditionalFormatPreset={handleConditionalFormatPreset}
                onSaveCopy={() => void handleSaveCopy()}
                onPrint={() => window.print()}
                onToggleGridlines={() =>
                  editor.setViewFlags((current) => ({ ...current, showGridlines: !current.showGridlines }))
                }
                onToggleShowFormulas={() => {
                  editor.commitWorkbookMutation((current) => ({
                    sheets: current.sheets.map((sheet, index) =>
                      index === editor.activeSheetIndex
                        ? { ...sheet, showFormulas: !sheet.showFormulas }
                        : sheet,
                    ),
                  }));
                  editor.setViewFlags((current) => ({ ...current, showFormulas: !current.showFormulas }));
                }}
                onAutoSum={() => {
                  if (readOnly) return;
                  const formula = buildAutoSumFormula(editor.selectionRange);
                  editor.commitFormulaBar(formula);
                }}
                onInsertFunction={() => {
                  if (readOnly) return;
                  const fn = window.prompt("Enter function (e.g. SUM(A1:A5))", "SUM()");
                  if (fn) editor.commitFormulaBar(fn.startsWith("=") ? fn : `=${fn}`);
                }}
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
                onFilter={() => {
                  const query = window.prompt("Filter column by text", filterQuery) ?? "";
                  handleApplyFilter(query);
                }}
                onClearFilter={() => handleApplyFilter("")}
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
                    onSelectCell={editor.selectCell}
                    onStartEditing={editor.startEditing}
                    onEditDraftChange={editor.setEditDraft}
                    onCommitEdit={editor.commitEdit}
                    onGridKeyDown={handleGridKeyDown}
                    onColumnWidthsChange={(widths) =>
                      editor.commitWorkbookMutation((current) => ({
                        sheets: current.sheets.map((sheet, index) =>
                          index === editor.activeSheetIndex ? { ...sheet, columnWidths: widths } : sheet,
                        ),
                      }))
                    }
                    onRowHeightsChange={(heights) =>
                      editor.commitWorkbookMutation((current) => ({
                        sheets: current.sheets.map((sheet, index) =>
                          index === editor.activeSheetIndex ? { ...sheet, rowHeights: heights } : sheet,
                        ),
                      }))
                    }
                  />
                  <ExcelSheetTabsBar
                    sheets={editor.workbook?.sheets.map((sheet) => sheet.name) ?? []}
                    activeIndex={editor.activeSheetIndex}
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
                  />
                  <ExcelStatusBar
                    metricsLine={metricsLine}
                    undoAvailable={editor.canUndo}
                    redoAvailable={editor.canRedo}
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

        <ExcelFindReplaceDialog
          open={findOpen}
          onOpenChange={setFindOpen}
          onFindNext={handleFindNext}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
        />
      </DialogContent>
    </Dialog>
  );
}
