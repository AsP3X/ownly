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
  FolderOpen,
  Italic,
  Plus,
  Printer,
  Settings,
  Underline,
} from "lucide-react";
import type {
  CellStyle,
  HorizontalAlign,
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
};

function RibbonDivider() {
  return (
    <div className="w-px shrink-0 bg-[#E5E7EB]" style={{ height: scaledPx(24) }} aria-hidden />
  );
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
          Inter
          <ChevronDown className="size-3 text-[#666666]" aria-hidden />
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-1.5 py-1 text-xs text-[#1A1A1A]">
          11
          <ChevronDown className="size-3 text-[#666666]" aria-hidden />
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
          className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-[#1A1A1A]"
          onClick={() =>
            onStyleChange({
              numberFormat: cellStyle.numberFormat === "currency" ? "general" : "currency",
            })
          }
        >
          Currency
          <ChevronDown className="size-3 text-[#666666]" aria-hidden />
        </button>
        <ExcelConditionalFormatMenu
          disabled={readOnly || !onConditionalFormatPreset}
          onApplyPreset={(preset) => onConditionalFormatPreset?.(preset)}
        />
      </div>
    </>
  );
}

function FileTools() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="New" icon={<Plus className="size-3 text-[#666666]" aria-hidden />} />
      <RibbonButton label="Open" icon={<FolderOpen className="size-3 text-[#666666]" aria-hidden />} />
      <RibbonButton label="Save Copy" icon={<Copy className="size-3 text-[#666666]" aria-hidden />} />
      <RibbonButton label="Export PDF" icon={<FileText className="size-3 text-[#666666]" aria-hidden />} />
      <RibbonButton label="Print" icon={<Printer className="size-3 text-[#666666]" aria-hidden />} />
      <RibbonButton label="Settings" icon={<Settings className="size-3 text-[#666666]" aria-hidden />} />
    </div>
  );
}

function InsertTools() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Table" />
      <RibbonButton label="PivotTable" />
      <RibbonDivider />
      <RibbonButton label="Pictures" />
      <RibbonButton label="Shapes" />
      <RibbonDivider />
      <RibbonButton label="Recommended Charts" />
    </div>
  );
}

function PageLayoutTools() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Margins" />
      <RibbonButton label="Orientation" />
      <RibbonButton label="Size" />
      <RibbonDivider />
      <RibbonButton label="Gridlines" />
      <RibbonButton label="Headings" />
    </div>
  );
}

function FormulasTools() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="Insert Function" />
      <RibbonButton label="AutoSum" />
      <RibbonButton label="Financial" />
      <RibbonButton label="Logical" />
      <RibbonButton label="Math & Trig" />
      <RibbonDivider />
      <RibbonButton label="Name Manager" />
      <RibbonDivider />
      <RibbonButton label="Trace Precedents" />
      <RibbonButton label="Show Formulas" />
    </div>
  );
}

function DataTools() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RibbonButton label="From CSV" />
      <RibbonButton label="From Web" />
      <RibbonDivider />
      <RibbonButton label="Sort" />
      <RibbonButton label="Filter" active />
      <RibbonDivider />
      <RibbonButton label="Remove Duplicates" />
      <RibbonButton label="Validation" />
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
        {activeTab === "file" ? <FileTools /> : null}
        {activeTab === "home" ? (
          <HomeTools
            cellStyle={cellStyle}
            readOnly={readOnly}
            onStyleChange={onStyleChange}
            onConditionalFormatPreset={onConditionalFormatPreset}
          />
        ) : null}
        {activeTab === "insert" ? <InsertTools /> : null}
        {activeTab === "page-layout" ? <PageLayoutTools /> : null}
        {activeTab === "formulas" ? <FormulasTools /> : null}
        {activeTab === "data" ? <DataTools /> : null}
        {activeTab === "automate" ? <AutomateTools /> : null}
      </div>
    </div>
  );
}
