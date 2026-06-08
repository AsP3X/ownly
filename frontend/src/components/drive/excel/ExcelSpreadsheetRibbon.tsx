// Human: Microsoft Excel 365 ribbon — File tab, standard tabs, labeled command groups.
// Agent: READS activeRibbonTab + cellStyle; EMITS callbacks; USES excel-ribbon-primitives + login-screen tokens.

import { useState } from "react";
import type { ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowUpAZ,
  BarChart3,
  Bold,
  Calculator,
  ClipboardPaste,
  Copy,
  Eye,
  FileText,
  Filter,
  FunctionSquare,
  Grid3X3,
  Italic,
  MessageSquare,
  Paintbrush,
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
  VerticalAlign,
} from "@/lib/spreadsheet/types";
import {
  ExcelConditionalFormatMenu,
  type ConditionalFormatPreset,
} from "@/components/drive/excel/ExcelConditionalFormatMenu";
import {
  RibbonContent,
  RibbonGroup,
  RibbonGroupDivider,
  RibbonIconButton,
  RibbonIconStack,
  RibbonLargeButton,
  RibbonSelect,
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

/** Human: Excel 365 default tab order (File is separate green tab). */
const RIBBON_TABS: { id: Exclude<RibbonTabId, "file">; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "draw", label: "Draw" },
  { id: "page-layout", label: "Page Layout" },
  { id: "formulas", label: "Formulas" },
  { id: "data", label: "Data" },
  { id: "review", label: "Review" },
  { id: "view", label: "View" },
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
      return { borderTop: false, borderRight: false, borderBottom: false, borderLeft: false };
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
  canUndo,
  canRedo,
  onStyleChange,
  onConditionalFormatPreset,
  onCopy,
  onCut,
  onPaste,
  onUndo,
  onRedo,
  onSortAsc,
  onSortDesc,
  onFilter,
  onFindReplace,
  onAutoSum,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
  onMergeCells,
}: Pick<
  ExcelSpreadsheetRibbonProps,
  | "cellStyle"
  | "readOnly"
  | "canUndo"
  | "canRedo"
  | "onStyleChange"
  | "onConditionalFormatPreset"
  | "onCopy"
  | "onCut"
  | "onPaste"
  | "onUndo"
  | "onRedo"
  | "onSortAsc"
  | "onSortDesc"
  | "onFilter"
  | "onFindReplace"
  | "onAutoSum"
  | "onInsertRow"
  | "onDeleteRow"
  | "onInsertColumn"
  | "onDeleteColumn"
  | "onMergeCells"
>) {
  const sz = iconSize();
  const setAlign = (horizontalAlign: HorizontalAlign) => onStyleChange({ horizontalAlign });

  return (
    <>
      <RibbonGroup label="Clipboard">
        <RibbonLargeButton
          label="Paste"
          icon={<ClipboardPaste style={{ width: sz, height: sz }} aria-hidden />}
          disabled={readOnly}
          onClick={onPaste}
        />
        <RibbonIconStack>
          <RibbonIconButton
            label="Cut"
            showLabel={false}
            icon={<Scissors style={{ width: sz, height: sz }} aria-hidden />}
            disabled={readOnly}
            onClick={onCut}
          />
          <RibbonIconButton
            label="Copy"
            showLabel={false}
            icon={<Copy style={{ width: sz, height: sz }} aria-hidden />}
            onClick={onCopy}
          />
        </RibbonIconStack>
        <RibbonIconButton
          label="Format Painter"
          icon={<Paintbrush style={{ width: sz, height: sz }} aria-hidden />}
          disabled
          title="Format Painter (coming soon)"
        />
      </RibbonGroup>
      <RibbonGroupDivider />

      <RibbonGroup label="Font">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <RibbonSelect
              ariaLabel="Font"
              disabled={readOnly}
              width={100}
              value={cellStyle.fontFamily ?? "Inter"}
              onChange={(value) => onStyleChange({ fontFamily: value })}
              options={[
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
              width={44}
              value={cellStyle.fontSize ?? 11}
              onChange={(value) => onStyleChange({ fontSize: Number(value) })}
              options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((size) => ({
                value: size,
                label: String(size),
              }))}
            />
          </div>
          <div className="flex items-center gap-0.5">
            <RibbonToggleButton
              ariaLabel="Bold"
              disabled={readOnly}
              active={cellStyle.bold}
              onClick={() => onStyleChange({ bold: !cellStyle.bold })}
            >
              <Bold style={{ width: sz, height: sz }} />
            </RibbonToggleButton>
            <RibbonToggleButton
              ariaLabel="Italic"
              disabled={readOnly}
              active={cellStyle.italic}
              onClick={() => onStyleChange({ italic: !cellStyle.italic })}
            >
              <Italic style={{ width: sz, height: sz }} />
            </RibbonToggleButton>
            <RibbonToggleButton
              ariaLabel="Underline"
              disabled={readOnly}
              active={cellStyle.underline}
              onClick={() => onStyleChange({ underline: !cellStyle.underline })}
            >
              <Underline style={{ width: sz, height: sz }} />
            </RibbonToggleButton>
            <label
              className="ml-1 inline-flex cursor-pointer items-center gap-1 rounded-sm border px-1 py-0.5 hover:bg-[#E5E5E5]"
              style={{ fontSize: scaledPx(10), borderColor: "#E5E7EB" }}
            >
              Fill
              <input
                type="color"
                aria-label="Fill color"
                disabled={readOnly}
                value={cellStyle.backgroundColor ?? "#ffffff"}
                onChange={(event) => onStyleChange({ backgroundColor: event.target.value })}
                className="size-4 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      <RibbonGroup label="Alignment">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-0.5">
            {(["left", "center", "right"] as HorizontalAlign[]).map((align) => (
              <RibbonToggleButton
                key={align}
                ariaLabel={`Align ${align}`}
                disabled={readOnly}
                active={cellStyle.horizontalAlign === align || (!cellStyle.horizontalAlign && align === "left")}
                onClick={() => setAlign(align)}
              >
                {align === "left" ? (
                  <AlignLeft style={{ width: sz, height: sz }} />
                ) : align === "center" ? (
                  <AlignCenter style={{ width: sz, height: sz }} />
                ) : (
                  <AlignRight style={{ width: sz, height: sz }} />
                )}
              </RibbonToggleButton>
            ))}
            <RibbonToggleButton
              ariaLabel="Wrap text"
              disabled={readOnly}
              active={cellStyle.wrapText}
              onClick={() => onStyleChange({ wrapText: !cellStyle.wrapText })}
            >
              <WrapText style={{ width: sz, height: sz }} />
            </RibbonToggleButton>
          </div>
          <div className="flex items-center gap-0.5">
            {(["top", "middle", "bottom"] as VerticalAlign[]).map((align) => (
              <RibbonToggleButton
                key={align}
                ariaLabel={`Vertical ${align}`}
                disabled={readOnly}
                active={cellStyle.verticalAlign === align}
                onClick={() => onStyleChange({ verticalAlign: align })}
              >
                <span style={{ fontSize: scaledPx(9), fontWeight: 600, width: sz, textAlign: "center" }}>
                  {align === "top" ? "T" : align === "middle" ? "M" : "B"}
                </span>
              </RibbonToggleButton>
            ))}
            <RibbonIconButton
              label="Merge"
              icon={<Table2 style={{ width: sz, height: sz }} aria-hidden />}
              disabled={readOnly}
              onClick={onMergeCells}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      <RibbonGroup label="Number">
        <div className="flex flex-col gap-1">
          <RibbonSelect
            ariaLabel="Number format"
            disabled={readOnly}
            width={88}
            value={cellStyle.numberFormat ?? "general"}
            onChange={(value) =>
              onStyleChange({ numberFormat: value as CellStyle["numberFormat"] })
            }
            options={[
              { value: "general", label: "General" },
              { value: "number", label: "Number" },
              { value: "currency", label: "Currency" },
              { value: "percent", label: "Percent" },
            ]}
          />
          <div className="flex gap-0.5">
            <RibbonIconButton
              label="Currency"
              icon={<span style={{ fontSize: scaledPx(11), fontWeight: 700 }}>$</span>}
              disabled={readOnly}
              active={cellStyle.numberFormat === "currency"}
              onClick={() =>
                onStyleChange({
                  numberFormat: cellStyle.numberFormat === "currency" ? "general" : "currency",
                })
              }
            />
            <RibbonIconButton
              label="Percent"
              icon={<span style={{ fontSize: scaledPx(11), fontWeight: 700 }}>%</span>}
              disabled={readOnly}
              active={cellStyle.numberFormat === "percent"}
              onClick={() =>
                onStyleChange({
                  numberFormat: cellStyle.numberFormat === "percent" ? "general" : "percent",
                })
              }
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      <RibbonGroup label="Styles">
        <ExcelConditionalFormatMenu
          disabled={readOnly || !onConditionalFormatPreset}
          onApplyPreset={(preset) => onConditionalFormatPreset?.(preset)}
        />
        <div className="flex flex-wrap gap-0.5" style={{ maxWidth: scaledPx(120) }}>
          {(
            [
              ["All", "all"],
              ["Outline", "outline"],
              ["Clear", "clear"],
            ] as const
          ).map(([label, preset]) => (
            <button
              key={preset}
              type="button"
              disabled={readOnly}
              className="rounded-sm px-1.5 py-0.5 hover:bg-[#E5E5E5] disabled:opacity-40"
              style={{ fontSize: scaledPx(9), fontFamily: EXCEL_RIBBON_FONT }}
              onClick={() => onStyleChange(borderPatchForPreset(preset, cellStyle))}
            >
              {label}
            </button>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroupDivider />

      <RibbonGroup label="Cells">
        <RibbonIconStack>
          <RibbonIconButton label="Insert" icon={<span style={{ fontSize: scaledPx(10) }}>▾ Ins</span>} disabled={readOnly} onClick={onInsertRow} title="Insert row" />
          <RibbonIconButton label="Delete" icon={<span style={{ fontSize: scaledPx(10) }}>▾ Del</span>} disabled={readOnly} onClick={onDeleteRow} title="Delete row" />
        </RibbonIconStack>
        <RibbonIconStack>
          <RibbonIconButton label="Format" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} disabled={readOnly} onClick={onInsertColumn} title="Insert column" />
          <RibbonIconButton label="Delete Col" icon={<span style={{ fontSize: scaledPx(9) }}>-C</span>} disabled={readOnly} onClick={onDeleteColumn} title="Delete column" />
        </RibbonIconStack>
      </RibbonGroup>
      <RibbonGroupDivider />

      <RibbonGroup label="Editing">
        <RibbonLargeButton
          label="AutoSum"
          icon={<Sigma style={{ width: sz, height: sz }} aria-hidden />}
          disabled={readOnly}
          onClick={onAutoSum}
        />
        <RibbonIconStack>
          <RibbonIconButton label="Sort A→Z" icon={<ArrowDownAZ style={{ width: sz, height: sz }} aria-hidden />} onClick={onSortAsc} />
          <RibbonIconButton label="Sort Z→A" icon={<ArrowUpAZ style={{ width: sz, height: sz }} aria-hidden />} onClick={onSortDesc} />
        </RibbonIconStack>
        <RibbonIconStack>
          <RibbonIconButton label="Filter" icon={<Filter style={{ width: sz, height: sz }} aria-hidden />} onClick={onFilter} />
          <RibbonIconButton label="Find" icon={<Search style={{ width: sz, height: sz }} aria-hidden />} onClick={onFindReplace} />
        </RibbonIconStack>
        <RibbonIconStack>
          <RibbonIconButton label="Undo" icon={<span style={{ fontSize: scaledPx(10) }}>↶</span>} disabled={!canUndo} onClick={onUndo} />
          <RibbonIconButton label="Redo" icon={<span style={{ fontSize: scaledPx(10) }}>↷</span>} disabled={!canRedo} onClick={onRedo} />
        </RibbonIconStack>
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
  | "onPrintPreview"
  | "readOnly"
>) {
  const sz = iconSize();
  const { readOnly, onToggleGridlines, onFreezePanes, onUnfreezePanes, onSetPrintArea, onClearPrintArea, onPageMargins, onPrintPreview } = props;
  return (
    <>
      <RibbonGroup label="Page Setup">
        <RibbonIconButton label="Margins" icon={<Sheet style={{ width: sz, height: sz }} aria-hidden />} onClick={onPageMargins} />
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

function ReviewTabPanel(props: Pick<ExcelSpreadsheetRibbonProps, "onEditComment" | "readOnly">) {
  const sz = iconSize();
  return (
    <>
      <RibbonGroup label="Comments">
        <RibbonLargeButton label="Comment" icon={<MessageSquare style={{ width: sz, height: sz }} aria-hidden />} disabled={props.readOnly} onClick={props.onEditComment} />
      </RibbonGroup>
    </>
  );
}

function ViewTabPanel(props: Pick<
  ExcelSpreadsheetRibbonProps,
  "onToggleGridlines" | "onToggleShowFormulas" | "onFreezePanes" | "onUnfreezePanes" | "showGridlines" | "showFormulas"
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
      </RibbonGroup>
    </>
  );
}

function PlaceholderTabPanel({ message }: { message: string }) {
  return (
    <RibbonGroup label="Coming Soon">
      <p style={{ fontSize: scaledPx(11), fontFamily: EXCEL_RIBBON_FONT, color: "#666666", padding: scaledPx(8) }}>
        {message}
      </p>
    </RibbonGroup>
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
  const [collapsed, setCollapsed] = useState(false);
  const fileActive = activeTab === "file";

  let panel: ReactNode = null;
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
      panel = <PlaceholderTabPanel message="Draw tools require canvas support (planned)." />;
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
      panel = <PlaceholderTabPanel message="Search Excel Help — use Ownly docs for spreadsheet features." />;
      break;
    case "automate":
      panel = <AutomateTabPanel />;
      break;
    default:
      panel = null;
  }

  return (
    <div className="shrink-0" style={{ fontFamily: EXCEL_RIBBON_FONT }}>
      <RibbonTabStrip
        tabs={RIBBON_TABS}
        activeTab={fileActive ? "" : activeTab}
        fileActive={fileActive}
        onFileTab={() => onTabChange("file")}
        onTabChange={(id) => onTabChange(id as RibbonTabId)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((current) => !current)}
      />
      <RibbonContent collapsed={collapsed}>{panel}</RibbonContent>
    </div>
  );
}
