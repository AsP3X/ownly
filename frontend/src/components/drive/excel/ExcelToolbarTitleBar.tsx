// Human: Windows Excel title bar — AutoSave, quick access, “Name - Excel”, search, window close.
// Agent: READS file metadata; EMITS save/undo/redo/search/close callbacks per real Excel topbar.

import type { ReactNode } from "react";
import { Redo2, Save, Search, Undo2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import {
  EXCEL_RIBBON_CHROME_BG,
  EXCEL_RIBBON_FONT,
  EXCEL_RIBBON_SEARCH_BG,
  EXCEL_RIBBON_SEARCH_BORDER,
  EXCEL_RIBBON_TEXT,
  EXCEL_RIBBON_TEXT_SECONDARY,
  EXCEL_RIBBON_TITLE_BAR_HEIGHT_PX,
} from "@/components/drive/excel/excel-ribbon-tokens";

type ExcelToolbarTitleBarProps = {
  documentTitle: string;
  readOnly?: boolean;
  autoSaveEnabled: boolean;
  onAutoSaveChange: (enabled: boolean) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSearch?: () => void;
  onClose?: () => void;
};

/** Human: Strip spreadsheet extension for Book1-style workbook title. */
export function spreadsheetDisplayTitle(filename: string): string {
  const base = filename.replace(/\.(xlsx|xls|xlsm|csv)$/i, "").trim();
  return base || "Book1";
}

// Human: Compact icon-only quick-access control (save, undo, redo).
function QuickAccessIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-sm text-[#323130] transition-colors hover:bg-[#E8E4EC] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ width: scaledPx(28), height: scaledPx(28) }}
    >
      {children}
    </button>
  );
}

export function ExcelToolbarTitleBar({
  documentTitle,
  readOnly = false,
  autoSaveEnabled,
  onAutoSaveChange,
  canUndo,
  canRedo,
  onSave,
  onUndo,
  onRedo,
  onSearch,
  onClose,
}: ExcelToolbarTitleBarProps) {
  const iconSize = scaledPx(14);
  const titleLabel = `${documentTitle} - Excel`;

  return (
    <div
      className="relative flex shrink-0 items-center"
      style={{
        height: scaledPx(EXCEL_RIBBON_TITLE_BAR_HEIGHT_PX),
        backgroundColor: EXCEL_RIBBON_CHROME_BG,
        paddingInline: scaledPx(8),
        fontFamily: EXCEL_RIBBON_FONT,
      }}
    >
      {/* Human: Left — AutoSave + quick access (save / undo / redo). */}
      <div className="z-10 flex min-w-0 shrink-0 items-center" style={{ gap: scaledPx(6) }}>
        <div className="flex items-center" style={{ gap: scaledPx(6) }}>
          <span
            className="whitespace-nowrap"
            style={{ fontSize: scaledPx(11), color: EXCEL_RIBBON_TEXT }}
          >
            AutoSave{" "}
            <span style={{ color: EXCEL_RIBBON_TEXT_SECONDARY }}>
              {autoSaveEnabled ? "On" : "Off"}
            </span>
          </span>
          <Switch
            size="sm"
            checked={autoSaveEnabled}
            onCheckedChange={onAutoSaveChange}
            disabled={readOnly}
            className="data-checked:bg-[#107C41]"
            aria-label="AutoSave"
          />
        </div>

        <div className="flex items-center" style={{ gap: scaledPx(1), marginLeft: scaledPx(4) }}>
          {!autoSaveEnabled ? (
            <QuickAccessIconButton label="Save" disabled={readOnly} onClick={onSave}>
              <Save style={{ width: iconSize, height: iconSize }} aria-hidden />
            </QuickAccessIconButton>
          ) : null}
          <QuickAccessIconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 style={{ width: iconSize, height: iconSize }} aria-hidden />
          </QuickAccessIconButton>
          <QuickAccessIconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 style={{ width: iconSize, height: iconSize }} aria-hidden />
          </QuickAccessIconButton>
        </div>
      </div>

      {/* Human: Center — workbook title as “Name - Excel”. */}
      <p
        className="pointer-events-none absolute left-1/2 max-w-[36%] -translate-x-1/2 truncate text-center"
        style={{
          fontSize: scaledPx(12),
          fontWeight: 400,
          color: EXCEL_RIBBON_TEXT,
        }}
        title={titleLabel}
      >
        {titleLabel}
      </p>

      {/* Human: Right — search pill + window-style close. */}
      <div
        className="z-10 ml-auto flex shrink-0 items-center"
        style={{ gap: scaledPx(8) }}
      >
        <button
          type="button"
          onClick={() => onSearch?.()}
          className="flex items-center rounded-full border transition-colors hover:bg-white"
          style={{
            gap: scaledPx(6),
            width: scaledPx(220),
            backgroundColor: EXCEL_RIBBON_SEARCH_BG,
            borderColor: EXCEL_RIBBON_SEARCH_BORDER,
            padding: `${scaledPx(4)}px ${scaledPx(12)}px`,
            boxShadow: "inset 0 0 0 0 transparent",
          }}
        >
          <Search
            style={{ width: scaledPx(13), height: scaledPx(13), color: EXCEL_RIBBON_TEXT_SECONDARY }}
            aria-hidden
          />
          <span style={{ fontSize: scaledPx(11), color: EXCEL_RIBBON_TEXT_SECONDARY }}>Search</span>
        </button>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close spreadsheet"
            title="Close"
            className="inline-flex items-center justify-center rounded-sm text-[#323130] transition-colors hover:bg-[#E81123] hover:text-white"
            style={{ width: scaledPx(32), height: scaledPx(28) }}
          >
            <X style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
