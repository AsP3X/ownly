// Human: Excel ribbon toolbar with all seven Pencil tab variants (File, Home, Insert, …).
// Agent: READS activeRibbonTab + formatting state; EMITS tab/format callbacks for selected cell styling.

import type { ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Copy,
  FileText,
  Italic,
  Printer,
  Underline,
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
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import { cn } from "@/lib/utils";

export type RibbonTabId =
  | "file"
  | "home"
  | "insert"
  | "page-layout"
  | "formulas"
  | "data"
  | "automate";

const RIBBON_TABS: { id: RibbonTabId; label: string }[] = [
  { id: "file", label: "File" },
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "page-layout", label: "Page Layout" },
  { id: "formulas", label: "Formulas" },
  { id: "data", label: "Data" },
  { id: "automate", label: "Automate" },
];

type ExcelSpreadsheetRibbonProps = {
  activeTab: RibbonTabId;
  cellStyle: CellStyle;
  readOnly?: boolean;
  onTabChange: (tab: RibbonTabId) => void;
  onStyleChange: (patch: Partial<CellStyle>) => void;
  onConditionalFormatPreset?: (preset: ConditionalFormatPreset) => void;
  onSaveCopy?: () => void;
  onPrint?: () => void;
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
  onRemoveDuplicates?: () => void;
  onImportCsv?: () => void;
  onInsertChart?: () => void;
  onInsertTable?: () => void;
  onTracePrecedents?: () => void;
  onNameManager?: () => void;
  onDataValidation?: () => void;
  onEditComment?: () => void;
};

function RibbonDivider() {
  return (
    <div className="w-px shrink-0 bg-[#E5E7EB]" style={{ height: scaledPx(24) }} aria-hidden />
  );
}

type BorderPreset = "all" | "outline" | "top" | "bottom" | "left" | "right" | "clear";

// Human: Map ribbon border preset to CellStyle patch for the active selection.
// Agent: WRITES per-side border flags consumed by grid + xlsx export.
function borderPatchForPreset(preset: BorderPreset, current: CellStyle): Partial<CellStyle> {
  const color = current.borderColor ?? "#1A1A1A";
  switch (preset) {
    case "all":
    case "outline":
      return {
        borderTop: true,
        borderRight: true,
        borderBottom: true,
        borderLeft: true,
        borderColor: color,
      };
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
        borderTop: false,
        borderRight: false,
        borderBottom: false,
        borderLeft: false,
      };
    default:
      return {};
  }
}

function RibbonButton({
  label,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-lg border font-semibold text-[#1A1A1A] transition-colors",
        active
          ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"
          : "border-[#E5E7EB] bg-[#F7F8FA] hover:bg-white",
      )}
      style={{
        gap: scaledPx(4),
        padding: `${scaledPx(4)}px ${scaledPx(8)}px`,
        fontSize: scaledPx(11),
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function HomeTools({
  cellStyle,
  readOnly,
  onStyleChange,
  onConditionalFormatPreset,
}: {
  cellStyle: CellStyle;
  readOnly?: boolean;
  onStyleChange: (patch: Partial<CellStyle>) => void;
  onConditionalFormatPreset?: (preset: ConditionalFormatPreset) => void;
}) {
  const setAlign = (horizontalAlign: HorizontalAlign) => onStyleChange({ horizontalAlign });

  return (
    <>
      <div className="flex items-center gap-1.5">
        <div className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-[#1A1A1A]">
          <select
            aria-label="Font family"
            className="bg-transparent outline-none"
            value={cellStyle.fontFamily ?? "Inter"}
            disabled={readOnly}
            onChange={(event) => onStyleChange({ fontFamily: event.target.value })}
          >
            <option value="Inter">Inter</option>
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Times New Roman">Times New Roman</option>
          </select>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-1.5 py-1 text-xs text-[#1A1A1A]">
          <select
            aria-label="Font size"
            className="bg-transparent outline-none"
            value={cellStyle.fontSize ?? 11}
            disabled={readOnly}
            onChange={(event) => onStyleChange({ fontSize: Number(event.target.value) })}
          >
            {[10, 11, 12, 14, 16, 18, 24].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-[#E5E7EB]">
          <button
            type="button"
            aria-label="Bold"
            onClick={() => onStyleChange({ bold: !cellStyle.bold })}
            className={cn("px-2 py-1.5", cellStyle.bold ? "bg-[#EFF6FF]" : "bg-white")}
          >
            <Bold className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Italic"
            onClick={() => onStyleChange({ italic: !cellStyle.italic })}
            className={cn("border-x border-[#E5E7EB] px-2 py-1.5", cellStyle.italic ? "bg-[#EFF6FF]" : "bg-white")}
          >
            <Italic className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Underline"
            onClick={() => onStyleChange({ underline: !cellStyle.underline })}
            className={cn("px-2 py-1.5", cellStyle.underline ? "bg-[#EFF6FF]" : "bg-white")}
          >
            <Underline className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <RibbonDivider />

      <div className="flex items-center gap-1">
        <div className="inline-flex overflow-hidden rounded-lg border border-[#E5E7EB]">
          {(["left", "center", "right"] as HorizontalAlign[]).map((align) => (
            <button
              key={align}
              type="button"
              aria-label={`Align ${align}`}
              onClick={() => setAlign(align)}
              className={cn(
                "px-2 py-1.5",
                cellStyle.horizontalAlign === align ? "bg-[#F7F8FA]" : "bg-white",
                align !== "right" && "border-r border-[#E5E7EB]",
              )}
            >
              {align === "left" ? (
                <AlignLeft className="size-3.5" aria-hidden />
              ) : align === "center" ? (
                <AlignCenter className="size-3.5" aria-hidden />
              ) : (
                <AlignRight className="size-3.5" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </div>

      <RibbonDivider />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs"
          onClick={() => onStyleChange({ wrapText: !cellStyle.wrapText })}
        >
          Wrap
        </button>
        {(["top", "middle", "bottom"] as VerticalAlign[]).map((align) => (
          <button
            key={align}
            type="button"
            className={cn(
              "rounded-lg border border-[#E5E7EB] px-2 py-1 text-xs capitalize",
              cellStyle.verticalAlign === align ? "bg-[#EFF6FF]" : "bg-white",
            )}
            onClick={() => onStyleChange({ verticalAlign: align })}
          >
            {align}
          </button>
        ))}
        <label className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs">
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
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-1 py-1 text-xs">
          {(
            [
              ["All", "all"],
              ["Outline", "outline"],
              ["Top", "top"],
              ["Bottom", "bottom"],
              ["Left", "left"],
              ["Right", "right"],
              ["Clear", "clear"],
            ] as const
          ).map(([label, preset]) => (
            <button
              key={preset}
              type="button"
              disabled={readOnly}
              className="rounded px-1.5 py-0.5 hover:bg-[#F7F8FA] disabled:opacity-40"
              onClick={() => onStyleChange(borderPatchForPreset(preset, cellStyle))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <RibbonDivider />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-[#1A1A1A]"
          onClick={() =>
            onStyleChange({
              numberFormat:
                cellStyle.numberFormat === "currency"
                  ? "general"
                  : cellStyle.numberFormat === "percent"
                    ? "general"
                    : "currency",
            })
          }
        >
          {cellStyle.numberFormat === "percent" ? "Percent" : "Currency"}
          <ChevronDown className="size-3 text-[#666666]" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-[#1A1A1A]"
          onClick={() =>
            onStyleChange({
              numberFormat: cellStyle.numberFormat === "percent" ? "general" : "percent",
            })
          }
        >
          Percent
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-[#1A1A1A]"
          onClick={() =>
            onStyleChange({
              numberFormat: cellStyle.numberFormat === "number" ? "general" : "number",
            })
          }
        >
          Number
        </button>
        <ExcelConditionalFormatMenu
          disabled={readOnly || !onConditionalFormatPreset}
          onApplyPreset={(preset) => onConditionalFormatPreset?.(preset)}
        />
      </div>
    </>
  );
}

function FileTools({
  onSaveCopy,
  onPrint,
}: {
  onSaveCopy?: () => void;
  onPrint?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Save Copy" icon={<Copy className="size-3 text-[#666666]" aria-hidden />} onClick={onSaveCopy} />
      <RibbonButton label="Print" icon={<Printer className="size-3 text-[#666666]" aria-hidden />} onClick={onPrint} />
      <RibbonButton label="Export PDF" icon={<FileText className="size-3 text-[#666666]" aria-hidden />} onClick={onPrint} />
    </div>
  );
}

function InsertTools({
  onMergeCells,
  onInsertChart,
  onInsertTable,
}: {
  onMergeCells?: () => void;
  onInsertChart?: () => void;
  onInsertTable?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Merge Cells" onClick={onMergeCells} />
      <RibbonButton label="Table" onClick={onInsertTable} />
      <RibbonButton label="Bar Chart" onClick={onInsertChart} />
    </div>
  );
}

function PageLayoutTools({
  onToggleGridlines,
  onFreezePanes,
  onUnfreezePanes,
  onSetPrintArea,
  onClearPrintArea,
  onPageMargins,
}: {
  onToggleGridlines?: () => void;
  onFreezePanes?: () => void;
  onUnfreezePanes?: () => void;
  onSetPrintArea?: () => void;
  onClearPrintArea?: () => void;
  onPageMargins?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Gridlines" onClick={onToggleGridlines} />
      <RibbonButton label="Freeze Panes" onClick={onFreezePanes} />
      <RibbonButton label="Unfreeze" onClick={onUnfreezePanes} />
      <RibbonDivider />
      <RibbonButton label="Set Print Area" onClick={onSetPrintArea} />
      <RibbonButton label="Clear Print Area" onClick={onClearPrintArea} />
      <RibbonButton label="Margins" onClick={onPageMargins} />
    </div>
  );
}

function FormulasTools({
  onAutoSum,
  onInsertFunction,
  onToggleShowFormulas,
  onTracePrecedents,
  onNameManager,
}: {
  onAutoSum?: () => void;
  onInsertFunction?: () => void;
  onToggleShowFormulas?: () => void;
  onTracePrecedents?: () => void;
  onNameManager?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Insert Function" onClick={onInsertFunction} />
      <RibbonButton label="AutoSum" onClick={onAutoSum} />
      <RibbonDivider />
      <RibbonButton label="Show Formulas" onClick={onToggleShowFormulas} />
      <RibbonButton label="Trace Precedents" onClick={onTracePrecedents} />
      <RibbonButton label="Name Manager" onClick={onNameManager} />
    </div>
  );
}

function DataTools({
  onSortAsc,
  onSortDesc,
  onFilter,
  onClearFilter,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
  onFindReplace,
  onRemoveDuplicates,
  onImportCsv,
  onDataValidation,
  onEditComment,
}: {
  onSortAsc?: () => void;
  onSortDesc?: () => void;
  onFilter?: () => void;
  onClearFilter?: () => void;
  onInsertRow?: () => void;
  onDeleteRow?: () => void;
  onInsertColumn?: () => void;
  onDeleteColumn?: () => void;
  onFindReplace?: () => void;
  onRemoveDuplicates?: () => void;
  onImportCsv?: () => void;
  onDataValidation?: () => void;
  onEditComment?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Sort A→Z" onClick={onSortAsc} />
      <RibbonButton label="Sort Z→A" onClick={onSortDesc} />
      <RibbonButton label="Filter" active onClick={onFilter} />
      <RibbonButton label="Clear Filter" onClick={onClearFilter} />
      <RibbonButton label="Remove Duplicates" onClick={onRemoveDuplicates} />
      <RibbonButton label="From CSV" onClick={onImportCsv} />
      <RibbonButton label="Validation" onClick={onDataValidation} />
      <RibbonButton label="Comment" onClick={onEditComment} />
      <RibbonDivider />
      <RibbonButton label="Insert Row" onClick={onInsertRow} />
      <RibbonButton label="Delete Row" onClick={onDeleteRow} />
      <RibbonButton label="Insert Column" onClick={onInsertColumn} />
      <RibbonButton label="Delete Column" onClick={onDeleteColumn} />
      <RibbonDivider />
      <RibbonButton label="Find" onClick={onFindReplace} />
    </div>
  );
}

function AutomateTools() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Record Actions" />
      <RibbonButton label="Office Scripts" />
      <RibbonDivider />
      <RibbonButton label="Power Automate" />
      <RibbonButton label="Add-ins" />
    </div>
  );
}

export function ExcelSpreadsheetRibbon({
  activeTab,
  cellStyle,
  readOnly,
  onTabChange,
  onStyleChange,
  onConditionalFormatPreset,
  onSaveCopy,
  onPrint,
  onToggleGridlines,
  onToggleShowFormulas,
  onAutoSum,
  onInsertFunction,
  onSortAsc,
  onSortDesc,
  onFilter,
  onClearFilter,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
  onMergeCells,
  onFindReplace,
  onFreezePanes,
  onUnfreezePanes,
  onSetPrintArea,
  onClearPrintArea,
  onPageMargins,
  onRemoveDuplicates,
  onImportCsv,
  onInsertChart,
  onInsertTable,
  onTracePrecedents,
  onNameManager,
  onDataValidation,
  onEditComment,
}: ExcelSpreadsheetRibbonProps) {
  return (
    <div className="shrink-0 border-b border-[#E5E7EB] bg-white">
      {/* Human: Tab row — active tab gets blue underline per Pencil ribbon variants. */}
      <div
        className="flex items-end bg-[#F7F8FA]"
        style={{
          height: scaledPx(28),
          gap: scaledPx(16),
          paddingInline: scaledPx(16),
          paddingTop: scaledPx(4),
        }}
      >
        {RIBBON_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative transition-colors",
                active ? "font-bold text-[#2563EB]" : "font-medium text-[#666666] hover:text-[#1A1A1A]",
              )}
              style={{
                fontSize: scaledPx(12),
                paddingInline: scaledPx(8),
                paddingBottom: scaledPx(4),
              }}
            >
              {tab.label}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#2563EB]" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Human: Tools area — 1.5× Pencil ribbon height (61px baseline). */}
      <div
        className="flex flex-wrap items-center bg-white"
        style={{
          minHeight: scaledPx(61),
          gap: scaledPx(12),
          padding: `${scaledPx(8)}px ${scaledPx(16)}px`,
        }}
      >
        {activeTab === "file" ? <FileTools onSaveCopy={onSaveCopy} onPrint={onPrint} /> : null}
        {activeTab === "home" ? (
          <HomeTools
            cellStyle={cellStyle}
            readOnly={readOnly}
            onStyleChange={onStyleChange}
            onConditionalFormatPreset={onConditionalFormatPreset}
          />
        ) : null}
        {activeTab === "insert" ? (
          <InsertTools
            onMergeCells={onMergeCells}
            onInsertChart={onInsertChart}
            onInsertTable={onInsertTable}
          />
        ) : null}
        {activeTab === "page-layout" ? (
          <PageLayoutTools
            onToggleGridlines={onToggleGridlines}
            onFreezePanes={onFreezePanes}
            onUnfreezePanes={onUnfreezePanes}
            onSetPrintArea={onSetPrintArea}
            onClearPrintArea={onClearPrintArea}
            onPageMargins={onPageMargins}
          />
        ) : null}
        {activeTab === "formulas" ? (
          <FormulasTools
            onAutoSum={onAutoSum}
            onInsertFunction={onInsertFunction}
            onToggleShowFormulas={onToggleShowFormulas}
            onTracePrecedents={onTracePrecedents}
            onNameManager={onNameManager}
          />
        ) : null}
        {activeTab === "data" ? (
          <DataTools
            onSortAsc={onSortAsc}
            onSortDesc={onSortDesc}
            onFilter={onFilter}
            onClearFilter={onClearFilter}
            onInsertRow={onInsertRow}
            onDeleteRow={onDeleteRow}
            onInsertColumn={onInsertColumn}
            onDeleteColumn={onDeleteColumn}
            onFindReplace={onFindReplace}
            onRemoveDuplicates={onRemoveDuplicates}
            onImportCsv={onImportCsv}
            onDataValidation={onDataValidation}
            onEditComment={onEditComment}
          />
        ) : null}
        {activeTab === "automate" ? <AutomateTools /> : null}
      </div>
    </div>
  );
}
