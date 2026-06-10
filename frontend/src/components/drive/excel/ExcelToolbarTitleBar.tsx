// Human: macOS Excel title bar — AutoSave, quick access, document title, search, comments, share.
// Agent: READS file metadata; EMITS save/undo/redo/share/find/comment callbacks per excel-editor-dialog.pen.

import type { ReactNode } from "react";
import {
  ChevronDown,
  MessageSquare,
  Redo2,
  Save,
  Search,
  Share2,
  Undo2,
  Upload,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import {
  EXCEL_RIBBON_BORDER,
  EXCEL_RIBBON_FILE_TAB,
  EXCEL_RIBBON_FILE_TAB_HOVER,
  EXCEL_RIBBON_FONT,
  EXCEL_RIBBON_TAB_STRIP_BG,
  EXCEL_RIBBON_TEXT,
  EXCEL_RIBBON_TEXT_SECONDARY,
  EXCEL_RIBBON_TITLE_BAR_HEIGHT_PX,
} from "@/components/drive/excel/excel-ribbon-tokens";
import { cn } from "@/lib/utils";

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
  onQuickAccessMenu?: () => void;
  onSearch?: () => void;
  onComments?: () => void;
  onShare?: () => void;
};

/** Human: Strip spreadsheet extension for centered workbook title (Book1-style). */
export function spreadsheetDisplayTitle(filename: string): string {
  const base = filename.replace(/\.(xlsx|xls|xlsm|csv)$/i, "").trim();
  return base || "Book1";
}

// Human: Icon-only quick-access control (save, undo, redo).
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
      className="rounded-sm p-1.5 text-[#323130] transition-colors hover:bg-[#F3F2F1] disabled:cursor-not-allowed disabled:opacity-40"
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
  onQuickAccessMenu,
  onSearch,
  onComments,
  onShare,
}: ExcelToolbarTitleBarProps) {
  const iconSize = scaledPx(14);

  return (
    <div
      className="relative flex shrink-0 items-center justify-between border-b bg-white"
      style={{
        height: scaledPx(EXCEL_RIBBON_TITLE_BAR_HEIGHT_PX),
        borderColor: EXCEL_RIBBON_BORDER,
        paddingInline: scaledPx(12),
        fontFamily: EXCEL_RIBBON_FONT,
      }}
    >
      {/* Human: Left — AutoSave toggle + quick access toolbar. */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: scaledPx(12), color: EXCEL_RIBBON_TEXT }}>AutoSave</span>
          <Switch
            size="sm"
            checked={autoSaveEnabled}
            onCheckedChange={onAutoSaveChange}
            disabled={readOnly}
            className="data-checked:bg-[#107C41]"
            aria-label="AutoSave"
          />
        </div>

        <div className="flex items-center gap-1">
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
          <button
            type="button"
            aria-label="Customize Quick Access Toolbar"
            title="Quick Access Toolbar"
            onClick={onQuickAccessMenu}
            className="rounded-sm p-1 text-[#605E5C] hover:bg-[#F3F2F1]"
          >
            <ChevronDown style={{ width: scaledPx(12), height: scaledPx(12) }} aria-hidden />
          </button>
        </div>
      </div>

      {/* Human: Center — workbook title. */}
      <p
        className="pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate font-semibold"
        style={{ fontSize: scaledPx(13), color: EXCEL_RIBBON_TEXT }}
      >
        {documentTitle}
      </p>

      {/* Human: Right — search, comments, green Share. */}
      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => onSearch?.()}
          className="flex items-center rounded-sm transition-colors hover:bg-[#EBEBEB]"
          style={{
            gap: scaledPx(8),
            width: scaledPx(200),
            backgroundColor: EXCEL_RIBBON_TAB_STRIP_BG,
            padding: `${scaledPx(6)}px ${scaledPx(10)}px`,
          }}
        >
          <Search
            style={{ width: iconSize, height: iconSize, color: EXCEL_RIBBON_TEXT_SECONDARY }}
            aria-hidden
          />
          <span style={{ fontSize: scaledPx(11), color: EXCEL_RIBBON_TEXT_SECONDARY }}>
            Search (Cmd + Ctrl + U)
          </span>
        </button>

        <button
          type="button"
          onClick={() => onComments?.()}
          className="inline-flex items-center rounded-sm text-[#323130] transition-colors hover:bg-[#F3F2F1]"
          style={{ gap: scaledPx(6), padding: `${scaledPx(6)}px ${scaledPx(10)}px`, fontSize: scaledPx(12) }}
        >
          <MessageSquare style={{ width: iconSize, height: iconSize }} aria-hidden />
          Comments
        </button>

        {onShare ? (
          <button
            type="button"
            onClick={onShare}
            className={cn(
              "inline-flex items-center rounded-sm font-semibold text-white transition-colors",
            )}
            style={{
              gap: scaledPx(6),
              padding: `${scaledPx(6)}px ${scaledPx(12)}px`,
              fontSize: scaledPx(12),
              backgroundColor: EXCEL_RIBBON_FILE_TAB,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.backgroundColor = EXCEL_RIBBON_FILE_TAB_HOVER;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = EXCEL_RIBBON_FILE_TAB;
            }}
          >
            <Upload style={{ width: iconSize, height: iconSize }} aria-hidden />
            Share
            <ChevronDown style={{ width: scaledPx(12), height: scaledPx(12) }} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center rounded-sm font-semibold text-white opacity-50"
            style={{
              gap: scaledPx(6),
              padding: `${scaledPx(6)}px ${scaledPx(12)}px`,
              fontSize: scaledPx(12),
              backgroundColor: EXCEL_RIBBON_FILE_TAB,
            }}
          >
            <Share2 style={{ width: iconSize, height: iconSize }} aria-hidden />
            Share
          </button>
        )}
      </div>
    </div>
  );
}
