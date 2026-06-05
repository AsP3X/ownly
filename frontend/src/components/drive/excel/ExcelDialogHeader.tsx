// Human: Excel dialog header — filename, cloud save badge, copilot toggle, share, save & close.
// Agent: READS file metadata + dirty/copilot flags; EMITS toggle/share/save callbacks per Pencil sgOxg header.

import { FileSpreadsheet, Share2, Sparkles } from "lucide-react";
import type { FileItem } from "@/api/client";
import { cn } from "@/lib/utils";

type ExcelDialogHeaderProps = {
  file: FileItem | null;
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  copilotOpen: boolean;
  onToggleCopilot: () => void;
  onShare?: () => void;
  onSaveAndClose: () => void;
};

export function ExcelDialogHeader({
  file,
  dirty,
  saving,
  readOnly,
  copilotOpen,
  onToggleCopilot,
  onShare,
  onSaveAndClose,
}: ExcelDialogHeaderProps) {
  const savedLabel = saving
    ? "Saving to Ownly Cloud…"
    : dirty
      ? "Unsaved changes"
      : "Saved to Ownly Cloud";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-[#F7F8FA] px-5">
      {/* Human: Left cluster — green spreadsheet icon, filename, cloud sync badge. */}
      <div className="flex min-w-0 items-center gap-2">
        <FileSpreadsheet className="size-[18px] shrink-0 text-[#107C41]" aria-hidden />
        <h2 className="truncate text-sm font-bold text-[#1A1A1A]">{file?.name ?? "Spreadsheet"}</h2>
        <span
          className={cn(
            "shrink-0 rounded-lg px-1.5 py-0.5 text-[11px]",
            dirty ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#DEF7EC] text-[#03543F]",
          )}
        >
          {savedLabel}
        </span>
      </div>

      {/* Human: Right actions — copilot toggle, share, primary save & close per Pencil. */}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleCopilot}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors",
            copilotOpen
              ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"
              : "border-[#E5E7EB] bg-white text-[#2563EB] hover:bg-[#EFF6FF]",
          )}
        >
          <Sparkles className="size-3.5" aria-hidden />
          Copilot Sidebar
        </button>

        {onShare ? (
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA]"
          >
            <Share2 className="size-3.5" aria-hidden />
            Share
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSaveAndClose}
          disabled={readOnly && !dirty}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {readOnly ? "Close" : "Save & Close"}
        </button>
      </div>
    </header>
  );
}
