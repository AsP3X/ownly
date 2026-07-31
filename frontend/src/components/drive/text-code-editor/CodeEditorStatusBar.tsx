// Human: Bottom status and action bar — cursor, selection, indent, language, save/close.
// Agent: SHOWS sync state and editor metrics; EMITS close/save/download when available.

import { CloudLightning, Download, GitBranch, Loader2, ShieldCheck } from "lucide-react";
import { useCodeEditorTheme } from "@/components/drive/text-code-editor/useCodeEditorTheme";
import { cn } from "@/lib/utils";

export type CodeEditorStatusBarProps = {
  branchLabel: string;
  syncLabel: string;
  syncTone: "saved" | "dirty" | "saving" | "error";
  cursorLabel: string;
  selectionLabel?: string | null;
  languageLabel: string;
  indentLabel: string;
  encodingLabel?: string;
  eolLabel?: string;
  readOnly?: boolean;
  saving?: boolean;
  canSave?: boolean;
  onClose: () => void;
  onSave?: () => void;
  onDownload?: () => void;
};

export function CodeEditorStatusBar({
  branchLabel,
  syncLabel,
  syncTone,
  cursorLabel,
  selectionLabel,
  languageLabel,
  indentLabel,
  encodingLabel = "UTF-8",
  eolLabel = "LF",
  readOnly = false,
  saving = false,
  canSave = false,
  onClose,
  onSave,
  onDownload,
}: CodeEditorStatusBarProps) {
  const { theme } = useCodeEditorTheme();

  return (
    <footer
      className={cn(
        "flex h-12 shrink-0 items-center justify-between gap-3 border-t px-3 sm:px-4",
        theme.statusBar,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <GitBranch className={cn("size-3 shrink-0", theme.statusText)} aria-hidden />
        <span className={cn("hidden max-w-[8rem] truncate text-xs sm:inline", theme.statusText)}>
          {branchLabel}
        </span>
        <CloudLightning
          className={cn(
            "size-3 shrink-0",
            syncTone === "saved" && "text-ok",
            syncTone === "dirty" && "text-warn",
            syncTone === "saving" && "text-brand",
            syncTone === "error" && "text-danger",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "truncate text-xs",
            syncTone === "saved" && "text-ok",
            syncTone === "dirty" && "text-warn",
            syncTone === "saving" && "text-brand",
            syncTone === "error" && "text-danger",
          )}
        >
          {syncLabel}
        </span>
        {readOnly ? (
          <span className="hidden items-center gap-1 rounded-md border border-ok/30 bg-ok-weak px-1.5 py-0.5 text-[10px] font-bold text-ok sm:inline-flex dark:border-emerald-400/20 dark:bg-emerald-950/40 dark:text-emerald-300">
            <ShieldCheck className="size-3" aria-hidden />
            Read-only
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className={cn("hidden text-xs tabular-nums md:inline", theme.statusText)}>
          {cursorLabel}
        </span>
        {selectionLabel ? (
          <span className={cn("hidden text-xs tabular-nums lg:inline", theme.statusText)}>
            {selectionLabel}
          </span>
        ) : null}
        <span className={cn("hidden text-xs sm:inline", theme.statusText)}>{indentLabel}</span>
        <span className={cn("hidden text-xs lg:inline", theme.statusText)}>{eolLabel}</span>
        <span className={cn("hidden text-xs xl:inline", theme.statusText)}>{encodingLabel}</span>
        <span className={cn("text-xs", theme.statusText)}>{languageLabel}</span>

        {onDownload ? (
          <button
            type="button"
            onClick={onDownload}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              theme.closeButton,
            )}
            aria-label="Download file"
            title="Download"
          >
            <Download className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Download</span>
          </button>
        ) : null}

        <button type="button" onClick={onClose} className={theme.closeButton}>
          Close
        </button>

        {!readOnly ? (
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
            Save
          </button>
        ) : null}
      </div>
    </footer>
  );
}
