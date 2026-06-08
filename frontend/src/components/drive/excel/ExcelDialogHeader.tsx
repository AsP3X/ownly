// Human: Excel dialog header — filename, cloud save badge, share, save & close.
// Agent: READS file metadata + dirty flag; EMITS share/save callbacks per Pencil sgOxg header.

import { FileSpreadsheet, Share2 } from "lucide-react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import type { FileItem } from "@/api/client";
import { cn } from "@/lib/utils";

type ExcelDialogHeaderProps = {
  file: FileItem | null;
  dirty: boolean;
  saving: boolean;
  loading?: boolean;
  loaded?: boolean;
  readOnly: boolean;
  onShare?: () => void;
  onSaveAndClose: () => void;
};

export function ExcelDialogHeader({
  file,
  dirty,
  saving,
  loading = false,
  loaded = true,
  readOnly,
  onShare,
  onSaveAndClose,
}: ExcelDialogHeaderProps) {
  const savedLabel = loading
    ? "Loading spreadsheet…"
    : saving
      ? "Saving to Ownly Cloud…"
      : !loaded
        ? "Not loaded"
        : dirty
          ? "Unsaved changes"
          : "Saved to Ownly Cloud";

  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-[#F7F8FA]"
      style={{ height: scaledPx(56), paddingInline: scaledPx(20) }}
    >
      {/* Human: Left cluster — green spreadsheet icon, filename, cloud sync badge. */}
      <div className="flex min-w-0 items-center gap-3">
        <FileSpreadsheet
          className="shrink-0 text-[#107C41]"
          style={{ width: scaledPx(18), height: scaledPx(18) }}
          aria-hidden
        />
        <h2 className="truncate font-bold text-[#1A1A1A]" style={{ fontSize: scaledPx(14) }}>
          {file?.name ?? "Spreadsheet"}
        </h2>
        <span
          className={cn(
            "shrink-0 rounded-lg",
            dirty ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#DEF7EC] text-[#03543F]",
          )}
          style={{ fontSize: scaledPx(11), padding: `${scaledPx(2)}px ${scaledPx(6)}px` }}
        >
          {savedLabel}
        </span>
      </div>

      {/* Human: Right actions — share and primary save & close per Pencil. */}
      <div className="flex shrink-0 items-center gap-4">
        {onShare ? (
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center rounded-lg border border-[#E5E7EB] bg-white font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA]"
            style={{
              gap: scaledPx(6),
              padding: `${scaledPx(8)}px ${scaledPx(14)}px`,
              fontSize: scaledPx(13),
            }}
          >
            <Share2 style={{ width: scaledPx(14), height: scaledPx(14) }} aria-hidden />
            Share
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSaveAndClose}
          disabled={readOnly && !dirty}
          className="rounded-lg bg-[#2563EB] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            padding: `${scaledPx(8)}px ${scaledPx(16)}px`,
            fontSize: scaledPx(13),
          }}
        >
          {readOnly ? "Close" : "Save & Close"}
        </button>
      </div>
    </header>
  );
}
