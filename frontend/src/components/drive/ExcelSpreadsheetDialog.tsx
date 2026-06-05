// Human: Full-screen Excel spreadsheet preview dialog — Pencil Excel Dialog Frame (sgOxg).
// Agent: FETCHES blob; PARSES xlsx; RENDERS ribbon/grid/copilot; SAVE replace upload on Save & Close.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildCopilotAnalysis } from "@/lib/spreadsheet/copilot";
import { cellAddressLabel, formatCellDisplay, formulaBarValue } from "@/lib/spreadsheet/cells";
import {
  applyFormulaBarEdit,
  parseSpreadsheetBuffer,
  serializeSpreadsheetWorkbook,
} from "@/lib/spreadsheet/parse";
import { computeSelectionStats, formatSelectionStatsLine } from "@/lib/spreadsheet/stats";
import type { CellAddress, CellStyle, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

export type ExcelSpreadsheetDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSaved?: (previousId: string, file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  shareToken?: string;
  sharePassword?: string | null;
};

type LoadState = {
  loading: boolean;
  error: string;
  savedWorkbook: SpreadsheetWorkbook | null;
  workbook: SpreadsheetWorkbook | null;
};

function emptyLoadState(): LoadState {
  return { loading: false, error: "", savedWorkbook: null, workbook: null };
}

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
  const [loadState, setLoadState] = useState<LoadState>(emptyLoadState);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [selection, setSelection] = useState<CellAddress | null>({ row: 3, col: 3 });
  const [ribbonTab, setRibbonTab] = useState<RibbonTabId>("home");
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const activeSheet = loadState.workbook?.sheets[activeSheetIndex] ?? null;
  const activeCell =
    selection && activeSheet ? activeSheet.rows[selection.row]?.[selection.col] : undefined;

  const cellStyle: CellStyle = activeCell?.style ?? {};

  const dirty = useMemo(() => {
    if (!loadState.workbook || !loadState.savedWorkbook) return false;
    return JSON.stringify(loadState.workbook) !== JSON.stringify(loadState.savedWorkbook);
  }, [loadState.savedWorkbook, loadState.workbook]);

  const copilotAnalysis = useMemo(
    () => (activeSheet ? buildCopilotAnalysis(activeSheet.rows, selection) : null),
    [activeSheet, selection],
  );

  const metricsLine = useMemo(() => {
    const stats = computeSelectionStats(activeSheet?.rows ?? [], selection);
    return formatSelectionStatsLine(stats);
  }, [activeSheet?.rows, selection]);

  const loadWorkbook = useCallback(async (target: FileItem) => {
    setLoadState({ loading: true, error: "", savedWorkbook: null, workbook: null });
    try {
      const blob = shareToken
        ? await fetchPublicShareBlobForPreview(shareToken, target.id, sharePassword)
        : await fetchFileBlobForPreview(target);
      const buffer = await blob.arrayBuffer();
      const workbook = parseSpreadsheetBuffer(buffer);
      setLoadState({
        loading: false,
        error: "",
        savedWorkbook: workbook,
        workbook,
      });
      setActiveSheetIndex(0);
      setSelection({ row: Math.min(3, Math.max(workbook.sheets[0]?.rows.length ?? 1, 1) - 1), col: 3 });
    } catch (error) {
      setLoadState({
        loading: false,
        error: getErrorMessage(error),
        savedWorkbook: null,
        workbook: null,
      });
    }
  }, [sharePassword, shareToken]);

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void loadWorkbook(file);
    });
    return () => {
      cancelled = true;
    };
  }, [file, loadWorkbook, open]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setLoadState(emptyLoadState());
        setSaveError("");
        setSaving(false);
        setRibbonTab("home");
        setCopilotOpen(true);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleFormulaCommit = useCallback(
    (input: string) => {
      if (!loadState.workbook || !selection || readOnly) return;
      const nextWorkbook = applyFormulaBarEdit(
        loadState.workbook,
        activeSheetIndex,
        selection.row,
        selection.col,
        input,
      );
      setLoadState((current) => ({ ...current, workbook: nextWorkbook }));
    },
    [activeSheetIndex, loadState.workbook, readOnly, selection],
  );

  const handleStyleChange = useCallback(
    (patch: Partial<CellStyle>) => {
      if (!loadState.workbook || !selection || !activeSheet || readOnly) return;
      const nextSheets = loadState.workbook.sheets.map((sheet, index) => {
        if (index !== activeSheetIndex) return sheet;
        const nextRows = sheet.rows.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            if (rowIndex !== selection.row || colIndex !== selection.col) return cell;
            const style = { ...cell.style, ...patch };
            return {
              ...cell,
              style,
              display: formatCellDisplay(cell.value, style.numberFormat ?? "general"),
            };
          }),
        );
        return { ...sheet, rows: nextRows };
      });
      setLoadState((current) => ({
        ...current,
        workbook: { sheets: nextSheets },
      }));
    },
    [activeSheet, activeSheetIndex, loadState.workbook, readOnly, selection],
  );

  const handleSaveAndClose = useCallback(async () => {
    if (!file || !loadState.workbook) {
      handleDialogOpenChange(false);
      return;
    }

    if (readOnly || !dirty) {
      handleDialogOpenChange(false);
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const blob = serializeSpreadsheetWorkbook(loadState.workbook);
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
  }, [dirty, file, handleDialogOpenChange, loadState.workbook, onFileSaved, readOnly]);

  const cellLabel = selection ? cellAddressLabel(selection) : "A1";
  const formulaValue = formulaBarValue(activeCell);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="flex w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden border-0 bg-transparent p-4 shadow-none ring-0 sm:max-w-[75rem]"
        overlayClassName="bg-[#0A0A10]/80 backdrop-blur-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Spreadsheet preview"}</DialogTitle>
          <DialogDescription>View and edit spreadsheet files in the browser.</DialogDescription>
        </DialogHeader>

        {/* Human: Viewer card — 1200×850 Pencil frame scaled to viewport via max width/height. */}
        <div className="flex h-[min(850px,90dvh)] w-full flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
          <ExcelDialogHeader
            file={file}
            dirty={dirty}
            saving={saving}
            readOnly={readOnly}
            copilotOpen={copilotOpen}
            onToggleCopilot={() => setCopilotOpen((current) => !current)}
            onShare={file && onShare ? () => onShare(file) : undefined}
            onSaveAndClose={() => void handleSaveAndClose()}
          />

          {saveError ? (
            <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-5 py-2 text-xs text-[#B91C1C]" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <ExcelSpreadsheetRibbon
                activeTab={ribbonTab}
                cellStyle={cellStyle}
                onTabChange={setRibbonTab}
                onStyleChange={handleStyleChange}
              />

              <ExcelFormulaBar
                cellLabel={cellLabel}
                value={formulaValue}
                readOnly={readOnly}
                onCommit={handleFormulaCommit}
              />

              {loadState.loading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#666666]">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  Loading spreadsheet…
                </div>
              ) : null}

              {loadState.error ? (
                <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#EF4444]" role="alert">
                  {loadState.error}
                </p>
              ) : null}

              {!loadState.loading && !loadState.error && activeSheet ? (
                <>
                  <ExcelSpreadsheetGrid
                    rows={activeSheet.rows}
                    selection={selection}
                    onSelectCell={setSelection}
                  />
                  <ExcelSheetTabsBar
                    sheets={loadState.workbook?.sheets.map((sheet) => sheet.name) ?? []}
                    activeIndex={activeSheetIndex}
                    onSelectSheet={setActiveSheetIndex}
                  />
                  <ExcelStatusBar metricsLine={metricsLine} />
                </>
              ) : null}
            </div>

            {copilotOpen ? (
              <ExcelCopilotSidebar
                analysis={copilotAnalysis}
                onCollapse={() => setCopilotOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
