// Human: Bottom status and action bar — Pencil Status and Action Bar (48px) with save/close controls.
// Agent: SHOWS sync state, cursor position, language; EMITS close/save when editable.

import { CloudLightning, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type CodeEditorStatusBarProps = {
  branchLabel: string;
  syncLabel: string;
  syncTone: "saved" | "dirty" | "saving" | "error";
  cursorLabel: string;
  languageLabel: string;
  tabSizeLabel: string;
  readOnly?: boolean;
  saving?: boolean;
  canSave?: boolean;
  onClose: () => void;
  onSave?: () => void;
};

export function CodeEditorStatusBar({
  branchLabel,
  syncLabel,
  syncTone,
  cursorLabel,
  languageLabel,
  tabSizeLabel,
  readOnly = false,
  saving = false,
  canSave = false,
  onClose,
  onSave,
}: CodeEditorStatusBarProps) {
  return (
    <footer className="flex h-12 shrink-0 items-center justify-between border-t border-[#262637] bg-[#151521] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <GitBranch className="size-3 shrink-0 text-[#A6ADC8]" aria-hidden />
        <span className="truncate text-xs text-[#A6ADC8]">{branchLabel}</span>
        <CloudLightning
          className={cn(
            "size-3 shrink-0",
            syncTone === "saved" && "text-[#10B981]",
            syncTone === "dirty" && "text-[#F59E0B]",
            syncTone === "saving" && "text-[#2563EB]",
            syncTone === "error" && "text-[#EF4444]",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "truncate text-xs",
            syncTone === "saved" && "text-[#10B981]",
            syncTone === "dirty" && "text-[#F59E0B]",
            syncTone === "saving" && "text-[#2563EB]",
            syncTone === "error" && "text-[#EF4444]",
          )}
        >
          {syncLabel}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span className="hidden text-xs text-[#A6ADC8] sm:inline">{cursorLabel}</span>
        <span className="hidden text-xs text-[#A6ADC8] md:inline">{tabSizeLabel}</span>
        <span className="text-xs text-[#A6ADC8]">{languageLabel}</span>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#313244] px-3 py-1.5 text-xs font-medium text-[#A6ADC8] transition-colors hover:bg-white/5"
        >
          Close
        </button>

        {!readOnly ? (
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
            Save Changes
          </button>
        ) : null}
      </div>
    </footer>
  );
}
