// Human: Top bar for anonymous share pages — brand, badge, save-to-library, and download actions.
// Agent: RENDERS actions from parent callbacks; KEEPS download visible when block_download (disabled).

import { Cloud, Download, FolderInput, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PublicShareHeaderProps = {
  downloadLabel: string;
  onDownload: () => void;
  onSave: () => void;
  downloadDisabled?: boolean;
  downloadLoading?: boolean;
  saveLoading?: boolean;
  className?: string;
};

export function PublicShareHeader({
  downloadLabel,
  onDownload,
  onSave,
  downloadDisabled,
  downloadLoading,
  saveLoading,
  className,
}: PublicShareHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-20 shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-white px-6 sm:px-12",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <Cloud className="size-6 shrink-0 text-[#2563EB]" aria-hidden />
          <span className="text-lg font-bold tracking-tight text-[#1A1A1A]">Ownly</span>
        </div>
        <span className="hidden h-5 w-px bg-[#E5E7EB] sm:block" aria-hidden />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#2563EB]">
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          Public Shared Link
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onSave}
          disabled={saveLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60"
        >
          {saveLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <FolderInput className="size-4 shrink-0" aria-hidden />
          )}
          <span className="hidden sm:inline">Save to My Ownly</span>
          <span className="sm:hidden">Save</span>
        </button>
        <button
          type="button"
          disabled={downloadDisabled || downloadLoading}
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloadLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4 shrink-0" aria-hidden />
          )}
          <span className="max-w-[12rem] truncate sm:max-w-none">{downloadLabel}</span>
        </button>
      </div>
    </header>
  );
}
