// Human: Stacked download + save buttons for single-file mobile shares (Pencil Primary Actions Stack).
// Agent: RENDERS full-width pills; parent supplies labels and loading/disabled flags.

import { Download, FolderInput, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PublicShareMobileActionStackProps = {
  downloadLabel: string;
  onDownload?: () => void;
  onSave?: () => void;
  downloadDisabled?: boolean;
  downloadLoading?: boolean;
  saveDisabled?: boolean;
  saveLoading?: boolean;
  className?: string;
};

export function PublicShareMobileActionStack({
  downloadLabel,
  onDownload,
  onSave,
  downloadDisabled,
  downloadLoading,
  saveDisabled,
  saveLoading,
  className,
}: PublicShareMobileActionStackProps) {
  if (!onDownload && !onSave) return null;

  return (
    <div className={cn("flex flex-col gap-2.5 lg:hidden", className)}>
      {onDownload ? (
        <button
          type="button"
          onClick={onDownload}
          disabled={downloadDisabled || downloadLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloadLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4 shrink-0" aria-hidden />
          )}
          {downloadLabel}
        </button>
      ) : null}
      {onSave ? (
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled || saveLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-5 py-3.5 text-sm font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saveLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <FolderInput className="size-4 shrink-0" aria-hidden />
          )}
          Save to My Ownly
        </button>
      ) : null}
    </div>
  );
}
