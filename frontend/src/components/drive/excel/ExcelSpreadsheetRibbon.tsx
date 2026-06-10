// Human: macOS Excel toolbar — title bar, tab strip, and ribbon content per excel-editor-dialog.pen.
// Agent: READS activeRibbonTab + cellStyle; EMITS callbacks; COMPOSES ExcelToolbarTitleBar + ribbon primitives.

import { useState } from "react";
import type { ReactNode } from "react";
import {
  AlignCenter,
  AlignCenterVertical,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  ArrowDown,
  ArrowDownAZ,
  ArrowUpAZ,
  BarChart3,
  Bold,
  Calculator,
  ClipboardPaste,
  Copy,
  Eraser,
  Eye,
  FileText,
  Filter,
  FunctionSquare,
  Grid3X3,
  Italic,
  MessageSquare,
  Paintbrush,
  Palette,
  PanelTop,
  Printer,
  Scissors,
  Search,
  Sheet,
  Sigma,
  Table2,
  Underline,
  WrapText,
} from "lucide-react";
import type {
  CellStyle,
  HorizontalAlign,
  NumberFormat,
  VerticalAlign,
} from "@/lib/spreadsheet/types";
import {
  ribbonFontSizeOptions,
  ribbonFontSizeSelectValue,
} from "@/lib/spreadsheet/cell-styles";
import { RIBBON_NUMBER_FORMAT_OPTIONS } from "@/lib/spreadsheet/number-formats";
import {
  ExcelConditionalFormatMenu,
  type ConditionalFormatPreset,
} from "@/components/drive/excel/ExcelConditionalFormatMenu";
import { ExcelDrawPanel } from "@/components/drive/excel/ExcelDrawPanel";
import { ExcelHelpPanel } from "@/components/drive/excel/ExcelHelpPanel";
import {
  ExcelToolbarTitleBar,
  spreadsheetDisplayTitle,
} from "@/components/drive/excel/ExcelToolbarTitleBar";
import {
  RibbonColorButton,
  RibbonCompactButton,
  RibbonContent,
  RibbonGroup,
  RibbonGroupDivider,
  RibbonIconButton,
  RibbonIconStack,
  RibbonLargeButton,
  RibbonSelect,
  RibbonSquareIconButton,
  RibbonTabStrip,
  RibbonToggleButton,
} from "@/components/drive/excel/excel-ribbon-primitives";
import { EXCEL_RIBBON_FONT } from "@/components/drive/excel/excel-ribbon-tokens";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";

export type RibbonTabId =
  | "file"
  | "home"
  | "insert"
  | "draw"
  | "page-layout"
  | "formulas"
  | "data"
  | "review"
  | "view"
  | "help"
  | "automate";

/** Human: Primary tabs from excel-editor-dialog.pen (macOS toolbar). */
const RIBBON_PRIMARY_TABS: { id: Exclude<RibbonTabId, "file" | "draw" | "help" | "automate">; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "page-layout", label: "Page Layout" },
  { id: "formulas", label: "Formulas" },
  { id: "data", label: "Data" },
  { id: "review", label: "Review" },
  { id: "view", label: "View" },
];

/** Human: Extra tabs reachable via overflow select (preserves prior functionality). */
const RIBBON_OVERFLOW_TABS: { id: RibbonTabId; label: string }[] = [
  { id: "file", label: "File" },
  { id: "draw", label: "Draw" },
  { id: "help", label: "Help" },
  { id: "automate", label: "Automate" },
];

type BorderPreset = "all" | "outline" | "top" | "bottom" | "left" | "right" | "clear";

type ExcelSpreadsheetRibbonProps = {
  activeTab: RibbonTabId;
  cellStyle: CellStyle;
  readOnly?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  showGridlines?: boolean;
  showFormulas?: boolean;
  onTabChange: (tab: RibbonTabId) => void;
  onStyleChange: (patch: Partial<CellStyle>) => void;
  onConditionalFormatPreset?: (preset: ConditionalFormatPreset) => void;
  onSaveCopy?: () => void;
  onPrint?: () => void;
  onExportPdf?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onPasteSpecial?: () => void;
  onFormatPainter?: () => void;
  formatPainterActive?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleGridlines?: () => void;
  onToggleShowFormulas?: () => void;
  onAutoSum?: () => void;
  onInsertFunction?: () => void;
  onSortAsc?: () => void;
  onSortDesc?: () => void;
  onFilter?: () => void;
  onClearFilter?: () => void;
  onInsertRow?: () => void;
  onDeleteRow?: () => void;
  onInsertColumn?: () => void;
  onDeleteColumn?: () => void;
  onMergeCells?: () => void;
  onFindReplace?: () => void;
  onFreezePanes?: () => void;
  onUnfreezePanes?: () => void;
  onSetPrintArea?: () => void;
  onClearPrintArea?: () => void;
  onPageMargins?: () => void;
  onPrintPreview?: () => void;
  onRemoveDuplicates?: () => void;
  onImportCsv?: () => void;
  onInsertChart?: () => void;
  onInsertTable?: () => void;
  onInsertPivot?: () => void;
  onTracePrecedents?: () => void;
  onNameManager?: () => void;
  onDataValidation?: () => void;
  onEditComment?: () => void;
  onProtectSheet?: () => void;
  onTrackChanges?: () => void;
  onPageSetup?: () => void;
  onTextToColumns?: () => void;
  onHideRow?: () => void;
  onHideColumn?: () => void;
  onInsertLink?: () => void;
  drawMode?: "pen" | "eraser" | null;
  drawColor?: string;
  onDrawModeChange?: (mode: "pen" | "eraser" | null) => void;
  onDrawColorChange?: (color: string) => void;
  onClearDrawings?: () => void;
  zoomPercent?: number;
  onZoomChange?: (percent: number) => void;
  /** Human: Title bar — workbook display name (defaults from fileName). */
  fileName?: string;
  autoSaveEnabled?: boolean;
  onAutoSaveChange?: (enabled: boolean) => void;
  onSave?: () => void;
  onShare?: () => void;
  onFormatAsTable?: () => void;
  onClearFormatting?: () => void;
  /** Human: Ribbon Fill-down — extends selection by one row via fill handle logic. */
  onFillDown?: () => void;
};

// Human: Map border preset names to CellStyle patches for the Borders gallery.
function borderPatchForPreset(preset: BorderPreset, current: CellStyle): Partial<CellStyle> {
  const color = current.borderColor ?? "#1A1A1A";
  switch (preset) {
    case "all":
    case "outline":
      return { borderTop: true, borderRight: true, borderBottom: true, borderLeft: true, borderColor: color };
    case "top":
      return { borderTop: true, borderColor: color };
    case "bottom":
      return { borderBottom: true, borderColor: color };
    case "left":
      return { borderLeft: true, borderColor: color };
    case "right":
      return { borderRight: true, borderColor: color };
    case "clear":
      return {
        borderTop: undefined,
        borderRight: undefined,
        borderBottom: undefined,
        borderLeft: undefined,
        borderColor: undefined,
      };
    default:
      return {};
  }
}

function iconSize() {
  return scaledPx(16);
}

function HomeTabPanel({
  cellStyle,
  readOnly,
  onStyleChange,
  onConditionalFormatPreset,
  onCopy,
  onCut,
  onPaste,
  onPasteSpecial,
  onFormatPainter,
  formatPainterActive,
  onSortAsc,
  onSortDesc,
  onFilter,
  onFindReplace,
  onAutoSum,
  onInsertRow,
  onDeleteRow,
  onMergeCells,
  onFormatAsTable,
  onClearFormatting,
  onFillDown,
}: Pick<
  ExcelSpreadsheetRibbonProps,
  | "cellStyle"
  | "readOnly"
  | "onStyleChange"
  | "onConditionalFormatPreset"
  | "onCopy"
  | "onCut"
  | "onPaste"
  | "onPasteSpecial"
  | "onFormatPainter"
  | "formatPainterActive"
  | "onSortAsc"
  | "onSortDesc"
  | "onFilter"
  | "onFindReplace"
  | "onAutoSum"
  | "onInsertRow"
  | "onDeleteRow"
  | "onMergeCells"
  | "onFormatAsTable"
  | "onClearFormatting"
  | "onFillDown"
>) {
  const sz = iconSize();
  const sm = scaledPx(14);
  const setAlign = (horizontalAlign: HorizontalAlign) => onStyleChange({ horizontalAlign });
  const currentSize = ribbonFontSizeSelectValue(cellStyle);
  const fontSizeOptions = ribbonFontSizeOptions(currentSize);

  const bumpFontSize = (delta: number) => {
    const next = Math.min(72, Math.max(8, currentSize + delta));
    onStyleChange({ fontSize: next });
  };

  return (
    <>
      {/* Human: Group Clipboard — large Paste + cut/copy stack + format painter (pen layout). */}
      <RibbonGroup>
        <RibbonLargeButton
          label="Paste"
          icon={<ClipboardPaste style={{ width: scaledPx(24), height: scaledPx(24) }} aria-hidden />}
          disabled={readOnly}
          onClick={onPaste}
        />
        <RibbonIconStack>
          <RibbonIconButton
            label="Cut"
            showLabel={false}
            icon={<Scissors style={{ width: sm, height: sm }} aria-hidden />}
            disabled={readOnly}
            onClick={onCut}
          />
          <RibbonIconButton
            label="Copy"
            showLabel={false}
            icon={<Copy style={{ width: sm, height: sm }} aria-hidden />}
            onClick={onCopy}
          />
        </RibbonIconStack>
        <RibbonIconButton
          label="Format Painter"
          showLabel={false}
          icon={<Paintbrush style={{ width: sm, height: sm }} aria-hidden />}
          disabled={readOnly}
          active={formatPainterActive}
          title="Format Painter"
          onClick={onFormatPainter}
        />
        {onPasteSpecial ? (
          <RibbonIconButton
            label="Paste Special"
            showLabel={false}
            icon={<span style={{ fontSize: scaledPx(9) }}>▾</span>}
            disabled={readOnly}
            onClick={onPasteSpecial}
          />
        ) : null}
      </RibbonGroup>
      <RibbonGroupDivider />

      {/* Human: Group Font — Aptos-style family row + decoration row with color swatches. */}
      <RibbonGroup>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <RibbonSelect
              ariaLabel="Font"
              disabled={readOnly}
              width={100}
              value={cellStyle.fontFamily ?? "Aptos Narrow"}
              onChange={(value) => onStyleChange({ fontFamily: value })}
              options={[
                { value: "Aptos Narrow", label: "Aptos Narrow" },
                { value: "Inter", label: "Inter" },
                { value: "Calibri", label: "Calibri" },
                { value: "Arial", label: "Arial" },
                { value: "Georgia", label: "Georgia" },
                { value: "Times New Roman", label: "Times New Roman" },
              ]}
            />
            <RibbonSelect
              ariaLabel="Font size"
              disabled={readOnly}
              width={36}
              value={currentSize}
              onChange={(value) => onStyleChange({ fontSize: Number(value) })}
              options={fontSizeOptions}
            />
            <RibbonToggleButton ariaLabel="Increase font size" disabled={readOnly} onClick={() => bumpFontSize(1)}>
              <span style={{ fontSize: scaledPx(10), fontWeight: 600 }}>A^</span>
            </RibbonToggleButton>
            <RibbonToggleButton ariaLabel="Decrease font size" disabled={readOnly} onClick={() => bumpFontSize(-1)}>
              <span style={{ fontSize: scaledPx(10), fontWeight: 600 }}>A˅</span>
            </RibbonToggleButton>
          </div>
          <div className="flex items-center gap-0.5">
            <RibbonToggleButton
              ariaLabel="Bold"
              disabled={readOnly}
              active={cellStyle.bold}
              onClick={() => onStyleChange({ bold: cellStyle.bold ? undefined : true })}
            >
              <Bold style={{ width: sm, height: sm }} />
            </RibbonToggleButton>
            <RibbonToggleButton
              ariaLabel="Italic"
              disabled={readOnly}
              active={cellStyle.italic}
              onClick={() => onStyleChange({ italic: cellStyle.italic ? undefined : true })}
            >
              <Italic style={{ width: sm, height: sm }} />
            </RibbonToggleButton>
            <RibbonToggleButton
              ariaLabel="Underline"
              disabled={readOnly}
              active={cellStyle.underline}
              onClick={() => onStyleChange({ underline: cellStyle.underline ? undefined : true })}
            >
              <Underline style={{ width: sm, height: sm }} />
            </RibbonToggleButton>
            <RibbonToggleButton ariaLabel="Strikethrough" disabled={readOnly}>
              <span style={{ fontSize: scaledPx(11), fontWeight: 600 }}>ab</span>
            </RibbonToggleButton>
            <RibbonToggleButton
              ariaLabel="Borders"
              disabled={readOnly}
              onClick={() => onStyleChange(borderPatchForPreset("all", cellStyle))}
            >
              <Grid3X3 style={{ width: sm, height: sm }} />
            </RibbonToggleButton>
            <RibbonColorButton
              ariaLabel="Fill color"
              disabled={readOnly}
              variant="fill"
              value={cellStyle.backgroundColor ?? "#FFD700"}
              onChange={(color) => onStyleChange({ backgroundColor: color })}
            />
            <RibbonColorButton
              ariaLabel="Font color"
              disabled={readOnly}
              variant="font"
              value={cellStyle.textColor ?? "#E81123"}
              onChange={(color) => onStyleChange({ textColor: color })}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      {/* Human: Group Alignment — 3×3 icon grid + wrap/merge compact buttons. */}
      <RibbonGroup>
        <div className="flex items-center gap-1">
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">
              {(["top", "middle", "bottom"] as VerticalAlign[]).map((align) => (
                <RibbonSquareIconButton
                  key={align}
                  ariaLabel={`Vertical ${align}`}
                  disabled={readOnly}
                  active={cellStyle.verticalAlign === align}
                  onClick={() => onStyleChange({ verticalAlign: align })}
                >
                  {align === "top" ? (
                    <AlignStartVertical style={{ width: sm, height: sm }} />
                  ) : align === "middle" ? (
                    <AlignCenterVertical style={{ width: sm, height: sm }} />
                  ) : (
                    <AlignEndVertical style={{ width: sm, height: sm }} />
                  )}
                </RibbonSquareIconButton>
              ))}
            </div>
            <div className="flex gap-0.5">
              {(["left", "center", "right"] as HorizontalAlign[]).map((align) => (
                <RibbonSquareIconButton
                  key={align}
                  ariaLabel={`Align ${align}`}
                  disabled={readOnly}
                  active={
                    cellStyle.horizontalAlign === align || (!cellStyle.horizontalAlign && align === "left")
                  }
                  onClick={() => setAlign(align)}
                >
                  {align === "left" ? (
                    <AlignLeft style={{ width: sm, height: sm }} />
                  ) : align === "center" ? (
                    <AlignCenter style={{ width: sm, height: sm }} />
                  ) : (
                    <AlignRight style={{ width: sm, height: sm }} />
                  )}
                </RibbonSquareIconButton>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <RibbonCompactButton
              label="Wrap Text"
              icon={<WrapText style={{ width: sm, height: sm }} aria-hidden />}
              disabled={readOnly}
              active={cellStyle.wrapText}
              onClick={() => onStyleChange({ wrapText: !cellStyle.wrapText })}
            />
            <RibbonCompactButton
              label="Merge & Center"
              icon={<Table2 style={{ width: sm, height: sm }} aria-hidden />}
              disabled={readOnly}
              onClick={onMergeCells}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      {/* Human: Group Number — General dropdown + quick format icons. */}
      <RibbonGroup>
        <div className="flex flex-col gap-1">
          <RibbonSelect
            ariaLabel="Number format"
            disabled={readOnly}
            width={84}
            value={cellStyle.numberFormat ?? "general"}
            onChange={(value) =>
              onStyleChange({ numberFormat: value as NumberFormat, customNumberFormat: undefined })
            }
            options={RIBBON_NUMBER_FORMAT_OPTIONS}
          />
          <div className="flex gap-0.5">
            <RibbonIconButton
              label="Currency"
              showLabel={false}
              icon={<span style={{ fontSize: scaledPx(11), fontWeight: 700 }}>$</span>}
              disabled={readOnly}
              active={cellStyle.numberFormat === "currency"}
              onClick={() =>
                onStyleChange({
                  numberFormat: cellStyle.numberFormat === "currency" ? "general" : "currency",
                  customNumberFormat: undefined,
                })
              }
            />
            <RibbonIconButton
              label="Percent"
              showLabel={false}
              icon={<span style={{ fontSize: scaledPx(11), fontWeight: 700 }}>%</span>}
              disabled={readOnly}
              active={cellStyle.numberFormat === "percent"}
              onClick={() =>
                onStyleChange({
                  numberFormat: cellStyle.numberFormat === "percent" ? "general" : "percent",
                  customNumberFormat: undefined,
                })
              }
            />
            <RibbonIconButton
              label="Comma"
              showLabel={false}
              icon={<span style={{ fontSize: scaledPx(11), fontWeight: 700 }}>,</span>}
              disabled={readOnly}
              active={cellStyle.numberFormat === "number"}
              onClick={() =>
                onStyleChange({
                  numberFormat: cellStyle.numberFormat === "number" ? "general" : "number",
                  customNumberFormat: undefined,
                })
              }
            />
            <RibbonIconButton
              label="Increase decimals"
              showLabel={false}
              icon={<span style={{ fontSize: scaledPx(9) }}>.00↑</span>}
              disabled={readOnly}
            />
            <RibbonIconButton
              label="Decrease decimals"
              showLabel={false}
              icon={<span style={{ fontSize: scaledPx(9) }}>.0↓</span>}
              disabled={readOnly}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      {/* Human: Group Styles — conditional format + table + cell styles (pen layout). */}
      <RibbonGroup>
        <div className="flex flex-col gap-0.5">
          <ExcelConditionalFormatMenu
            disabled={readOnly || !onConditionalFormatPreset}
            onApplyPreset={(preset) => onConditionalFormatPreset?.(preset)}
          />
          <RibbonCompactButton
            label="Format as Table"
            icon={<Palette style={{ width: sm, height: sm }} aria-hidden />}
            disabled={readOnly}
            onClick={onFormatAsTable}
          />
          <RibbonCompactButton
            label="Cell Styles"
            icon={<Palette style={{ width: sm, height: sm }} aria-hidden />}
            disabled={readOnly}
            onClick={() => onStyleChange(borderPatchForPreset("outline", cellStyle))}
          />
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      {/* Human: Group Cells — Insert / Delete / Format with chevrons. */}
      <RibbonGroup>
        <div className="flex flex-col gap-0.5">
          <RibbonCompactButton
            label="Insert"
            icon={<Table2 style={{ width: sm, height: sm }} aria-hidden />}
            disabled={readOnly}
            showChevron
            onClick={onInsertRow}
          />
          <RibbonCompactButton
            label="Delete"
            icon={<Table2 style={{ width: sm, height: sm }} aria-hidden />}
            disabled={readOnly}
            showChevron
            onClick={onDeleteRow}
          />
          <RibbonCompactButton
            label="Format"
            icon={<Table2 style={{ width: sm, height: sm }} aria-hidden />}
            disabled={readOnly}
            showChevron
            onClick={onClearFormatting}
            title="Clear cell formatting"
          />
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      {/* Human: Group Editing — AutoSum, Fill, Clear, Sort & Filter, Find (undo/redo live in title bar). */}
      <RibbonGroup>
        <div className="flex items-center gap-1">
          <div className="flex flex-col gap-0.5">
            <RibbonCompactButton
              label="AutoSum"
              icon={<Sigma style={{ width: sm, height: sm }} aria-hidden />}
              disabled={readOnly}
              onClick={onAutoSum}
            />
            <RibbonCompactButton
              label="Fill"
              icon={<ArrowDown style={{ width: sm, height: sm }} aria-hidden />}
              disabled={readOnly}
              onClick={onFillDown}
            />
            <RibbonCompactButton
              label="Clear"
              icon={<Eraser style={{ width: sm, height: sm }} aria-hidden />}
              disabled={readOnly}
              onClick={onClearFormatting}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <RibbonCompactButton
              label="Sort & Filter"
              icon={<span style={{ fontSize: scaledPx(10), fontWeight: 700 }}>F</span>}
              showChevron
              onClick={onFilter}
            />
            <RibbonCompactButton
              label="Find & Select"
              icon={<span style={{ fontSize: scaledPx(10), fontWeight: 700 }}>F</span>}
              showChevron
              onClick={onFindReplace}
            />
            <div className="flex gap-0.5">
              <RibbonIconButton
                label="Sort A→Z"
                showLabel={false}
                icon={<ArrowDownAZ style={{ width: sz, height: sz }} aria-hidden />}
                onClick={onSortAsc}
              />
              <RibbonIconButton
                label="Sort Z→A"
                showLabel={false}
                icon={<ArrowUpAZ style={{ width: sz, height: sz }} aria-hidden />}
                onClick={onSortDesc}
              />
            </div>
          </div>
        </div>
      </RibbonGroup>
    </>
  );
}

function FileTabPanel({
  onSaveCopy,
  onPrint,
  onExportPdf,
}: Pick<ExcelSpreadsheetRibbonProps, "onSaveCopy" | "onPrint" | "onExportPdf">) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Export">
        <RibbonLargeButton label="Save Copy" icon={<Copy style={{ width: sz, height: sz }} aria-hidden />} onClick={onSaveCopy} />
        <RibbonIconButton label="Print" icon={<Printer style={{ width: sz, height: sz }} aria-hidden />} onClick={onPrint} />
        <RibbonIconButton label="Export PDF" icon={<FileText style={{ width: sz, height: sz }} aria-hidden />} onClick={onExportPdf ?? onPrint} />
      </RibbonGroup>
    </>
  );
}

function InsertTabPanel({
  onMergeCells,
  onInsertChart,
  onInsertTable,
  onInsertPivot,
  readOnly,
}: Pick<
  ExcelSpreadsheetRibbonProps,
  "onMergeCells" | "onInsertChart" | "onInsertTable" | "onInsertPivot" | "readOnly"
>) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Tables">
        <RibbonLargeButton label="PivotTable" icon={<Table2 style={{ width: sz, height: sz }} aria-hidden />} disabled={readOnly} onClick={onInsertPivot} />
        <RibbonIconButton label="Table" icon={<Grid3X3 style={{ width: sz, height: sz }} aria-hidden />} disabled={readOnly} onClick={onInsertTable} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Charts">
        <RibbonLargeButton label="Charts" icon={<BarChart3 style={{ width: sz, height: sz }} aria-hidden />} onClick={onInsertChart} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Cells">
        <RibbonIconButton label="Merge Cells" icon={<Table2 style={{ width: sz, height: sz }} aria-hidden />} disabled={readOnly} onClick={onMergeCells} />
      </RibbonGroup>
    </>
  );
}

function PageLayoutTabPanel(props: Pick<
  ExcelSpreadsheetRibbonProps,
  | "onToggleGridlines"
  | "onFreezePanes"
  | "onUnfreezePanes"
  | "onSetPrintArea"
  | "onClearPrintArea"
  | "onPageMargins"
  | "onPageSetup"
  | "onPrintPreview"
  | "readOnly"
>) {
  const sz = iconSize();
  const { readOnly, onToggleGridlines, onFreezePanes, onUnfreezePanes, onSetPrintArea, onClearPrintArea, onPageMargins, onPageSetup, onPrintPreview } = props;
  return (
    <>
      <RibbonGroup label="Page Setup">
        <RibbonIconButton label="Margins" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} onClick={onPageMargins} />
        <RibbonIconButton label="Page Setup" icon={<FileText style={{ width: sz, height: sz }} aria-hidden />} onClick={onPageSetup} />
        <RibbonIconStack>
          <RibbonIconButton label="Print Area" icon={<Printer style={{ width: sz, height: sz }} aria-hidden />} disabled={readOnly} onClick={onSetPrintArea} title="Set Print Area" />
          <RibbonIconButton label="Clear Area" icon={<span style={{ fontSize: scaledPx(10) }}>✕</span>} disabled={readOnly} onClick={onClearPrintArea} />
        </RibbonIconStack>
        <RibbonIconButton label="Print Preview" icon={<Eye style={{ width: sz, height: sz }} aria-hidden />} onClick={onPrintPreview} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Sheet Options">
        <RibbonIconButton label="Gridlines" icon={<Grid3X3 style={{ width: sz, height: sz }} aria-hidden />} onClick={onToggleGridlines} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Window">
        <RibbonIconButton label="Freeze Panes" icon={<PanelTop style={{ width: sz, height: sz }} aria-hidden />} onClick={onFreezePanes} />
        <RibbonIconButton label="Unfreeze" icon={<span style={{ fontSize: scaledPx(10) }}>⊟</span>} onClick={onUnfreezePanes} />
      </RibbonGroup>
    </>
  );
}

function FormulasTabPanel(props: Pick<
  ExcelSpreadsheetRibbonProps,
  "onAutoSum" | "onInsertFunction" | "onToggleShowFormulas" | "onTracePrecedents" | "onNameManager" | "readOnly" | "showFormulas"
>) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Function Library">
        <RibbonLargeButton label="Insert Function" icon={<FunctionSquare style={{ width: sz, height: sz }} aria-hidden />} disabled={props.readOnly} onClick={props.onInsertFunction} />
        <RibbonIconButton label="AutoSum" icon={<Sigma style={{ width: sz, height: sz }} aria-hidden />} disabled={props.readOnly} onClick={props.onAutoSum} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Defined Names">
        <RibbonIconButton label="Name Manager" icon={<Calculator style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onNameManager} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Formula Auditing">
        <RibbonIconButton label="Show Formulas" icon={<Eye style={{ width: sz, height: sz }} aria-hidden />} active={props.showFormulas} onClick={props.onToggleShowFormulas} />
        <RibbonIconButton label="Trace Precedents" icon={<Search style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onTracePrecedents} />
      </RibbonGroup>
    </>
  );
}

function DataTabPanel(props: Pick<
  ExcelSpreadsheetRibbonProps,
  | "onSortAsc"
  | "onSortDesc"
  | "onFilter"
  | "onClearFilter"
  | "onInsertRow"
  | "onDeleteRow"
  | "onInsertColumn"
  | "onDeleteColumn"
  | "onFindReplace"
  | "onRemoveDuplicates"
  | "onImportCsv"
  | "onDataValidation"
  | "onTextToColumns"
  | "readOnly"
>) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Get & Transform Data">
        <RibbonLargeButton label="From Text/CSV" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onImportCsv} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Sort & Filter">
        <RibbonIconButton label="Sort A→Z" icon={<ArrowDownAZ style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onSortAsc} />
        <RibbonIconButton label="Sort Z→A" icon={<ArrowUpAZ style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onSortDesc} />
        <RibbonIconButton label="Filter" icon={<Filter style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onFilter} />
        <RibbonIconButton label="Clear" icon={<span style={{ fontSize: scaledPx(10) }}>✕</span>} onClick={props.onClearFilter} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Data Tools">
        <RibbonIconButton label="Validation" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onDataValidation} />
        <RibbonIconButton label="Text to Columns" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onTextToColumns} />
        <RibbonIconButton label="Remove Duplicates" icon={<Copy style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onRemoveDuplicates} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Outline">
        <RibbonIconStack>
          <RibbonIconButton label="Insert Row" icon={<span style={{ fontSize: scaledPx(9) }}>+R</span>} disabled={props.readOnly} onClick={props.onInsertRow} />
          <RibbonIconButton label="Delete Row" icon={<span style={{ fontSize: scaledPx(9) }}>-R</span>} disabled={props.readOnly} onClick={props.onDeleteRow} />
        </RibbonIconStack>
        <RibbonIconStack>
          <RibbonIconButton label="Insert Col" icon={<span style={{ fontSize: scaledPx(9) }}>+C</span>} disabled={props.readOnly} onClick={props.onInsertColumn} />
          <RibbonIconButton label="Delete Col" icon={<span style={{ fontSize: scaledPx(9) }}>-C</span>} disabled={props.readOnly} onClick={props.onDeleteColumn} />
        </RibbonIconStack>
      </RibbonGroup>
    </>
  );
}

function ReviewTabPanel(
  props: Pick<
    ExcelSpreadsheetRibbonProps,
    "onEditComment" | "onProtectSheet" | "onTrackChanges" | "readOnly"
  >,
) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Comments">
        <RibbonLargeButton label="Comment" icon={<MessageSquare style={{ width: sz, height: sz }} aria-hidden />} disabled={props.readOnly} onClick={props.onEditComment} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Protect">
        <RibbonIconButton label="Protect Sheet" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onProtectSheet} />
        <RibbonIconButton label="Track Changes" icon={<Eye style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onTrackChanges} />
      </RibbonGroup>
    </>
  );
}

function ViewTabPanel(props: Pick<
  ExcelSpreadsheetRibbonProps,
  | "onToggleGridlines"
  | "onToggleShowFormulas"
  | "onFreezePanes"
  | "onUnfreezePanes"
  | "onHideRow"
  | "onHideColumn"
  | "onZoomChange"
  | "showGridlines"
  | "showFormulas"
  | "zoomPercent"
  | "readOnly"
>) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Show">
        <RibbonIconButton label="Gridlines" icon={<Grid3X3 style={{ width: sz, height: sz }} aria-hidden />} active={props.showGridlines} onClick={props.onToggleGridlines} />
        <RibbonIconButton label="Formulas" icon={<FunctionSquare style={{ width: sz, height: sz }} aria-hidden />} active={props.showFormulas} onClick={props.onToggleShowFormulas} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Window">
        <RibbonIconButton label="Freeze Panes" icon={<PanelTop style={{ width: sz, height: sz }} aria-hidden />} onClick={props.onFreezePanes} />
        <RibbonIconButton label="Unfreeze Panes" icon={<span style={{ fontSize: scaledPx(10) }}>⊟</span>} onClick={props.onUnfreezePanes} />
        <RibbonIconButton label="Hide Row" icon={<span style={{ fontSize: scaledPx(9) }}>-R</span>} disabled={props.readOnly} onClick={props.onHideRow} />
        <RibbonIconButton label="Hide Col" icon={<span style={{ fontSize: scaledPx(9) }}>-C</span>} disabled={props.readOnly} onClick={props.onHideColumn} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label="Zoom">
        <RibbonIconButton label="Zoom −" icon={<span style={{ fontSize: scaledPx(12) }}>−</span>} onClick={() => props.onZoomChange?.((props.zoomPercent ?? 100) - 10)} />
        <span style={{ fontSize: scaledPx(10), paddingInline: scaledPx(4) }}>{props.zoomPercent ?? 100}%</span>
        <RibbonIconButton label="Zoom +" icon={<span style={{ fontSize: scaledPx(12) }}>+</span>} onClick={() => props.onZoomChange?.((props.zoomPercent ?? 100) + 10)} />
      </RibbonGroup>
    </>
  );
}

function AutomateTabPanel() {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Automate">
        <RibbonIconButton label="Scripts" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} disabled title="Office Scripts not supported in browser" />
        <RibbonIconButton label="Automate" icon={<Calculator style={{ width: sz, height: sz }} aria-hidden />} disabled title="Power Automate not supported in browser" />
      </RibbonGroup>
    </>
  );
}

export function ExcelSpreadsheetRibbon(props: ExcelSpreadsheetRibbonProps) {
  const { activeTab, onTabChange } = props;
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const autoSaveEnabled = props.autoSaveEnabled ?? true;

  const documentTitle = spreadsheetDisplayTitle(props.fileName ?? "Book1");

  let panel: ReactNode;
  switch (activeTab) {
    case "file":
      panel = <FileTabPanel onSaveCopy={props.onSaveCopy} onPrint={props.onPrint} onExportPdf={props.onExportPdf} />;
      break;
    case "home":
      panel = <HomeTabPanel {...props} />;
      break;
    case "insert":
      panel = <InsertTabPanel {...props} />;
      break;
    case "draw":
      panel = (
        <ExcelDrawPanel
          drawMode={props.drawMode ?? null}
          strokeColor={props.drawColor ?? "#2563EB"}
          onDrawModeChange={props.onDrawModeChange ?? (() => undefined)}
          onStrokeColorChange={props.onDrawColorChange ?? (() => undefined)}
          onClearDrawings={props.onClearDrawings ?? (() => undefined)}
        />
      );
      break;
    case "page-layout":
      panel = <PageLayoutTabPanel {...props} />;
      break;
    case "formulas":
      panel = <FormulasTabPanel {...props} />;
      break;
    case "data":
      panel = <DataTabPanel {...props} />;
      break;
    case "review":
      panel = <ReviewTabPanel {...props} />;
      break;
    case "view":
      panel = <ViewTabPanel {...props} />;
      break;
    case "help":
      panel = <ExcelHelpPanel />;
      break;
    case "automate":
      panel = <AutomateTabPanel />;
      break;
    default:
      panel = null;
  }

  const isPrimaryTab = RIBBON_PRIMARY_TABS.some((tab) => tab.id === activeTab);

  return (
    <div className="shrink-0 bg-white" style={{ fontFamily: EXCEL_RIBBON_FONT }}>
      <ExcelToolbarTitleBar
        documentTitle={documentTitle}
        readOnly={props.readOnly}
        autoSaveEnabled={autoSaveEnabled}
        onAutoSaveChange={(enabled) => props.onAutoSaveChange?.(enabled)}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onSave={props.onSave}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onQuickAccessMenu={() => setQuickMenuOpen((open) => !open)}
        onSearch={props.onFindReplace}
        onComments={props.onEditComment}
        onShare={props.onShare}
      />

      {quickMenuOpen ? (
        <div
          className="flex flex-wrap gap-2 border-b bg-[#FAFAFA] px-3 py-2"
          style={{ borderColor: "#EDEBE9", fontSize: scaledPx(11) }}
        >
          <button type="button" className="rounded px-2 py-1 hover:bg-[#F3F2F1]" onClick={props.onSaveCopy}>
            Save a Copy
          </button>
          <button type="button" className="rounded px-2 py-1 hover:bg-[#F3F2F1]" onClick={props.onPrint}>
            Print
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-[#F3F2F1]"
            onClick={props.onExportPdf ?? props.onPrint}
          >
            Export PDF
          </button>
        </div>
      ) : null}

      <RibbonTabStrip
        tabs={RIBBON_PRIMARY_TABS}
        activeTab={isPrimaryTab ? activeTab : ""}
        onTabChange={(id) => onTabChange(id as RibbonTabId)}
        overflowTabs={RIBBON_OVERFLOW_TABS}
        onOverflowTab={(id) => onTabChange(id as RibbonTabId)}
      />
      <RibbonContent>{panel}</RibbonContent>
    </div>
  );
}
