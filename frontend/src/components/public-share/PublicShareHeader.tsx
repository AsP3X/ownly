// Human: Top bar for anonymous share pages — compact mobile header + full desktop actions.
// Agent: MOBILE shows logo, Shared Link badge, info button; DESKTOP adds download/save in header.

import { Cloud, Download, FolderInput, Info, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PublicShareHeaderProps = {
  downloadLabel: string;
  onDownload: () => void;
  onSave: () => void;
  onInfoClick?: () => void;
  downloadDisabled?: boolean;
  downloadLoading?: boolean;
  saveDisabled?: boolean;
  saveLoading?: boolean;
  className?: string;
};

export function PublicShareHeader({
  downloadLabel,
  onDownload,
  onSave,
  onInfoClick,
  downloadDisabled,
  downloadLoading,
  saveDisabled,
  saveLoading,
  className,
}: PublicShareHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-16 shrink-0 items-center justify-between border-b border-edge bg-panel px-5 lg:h-20 lg:px-12",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 lg:gap-4">
        <div className="flex items-center gap-2">
          <Cloud className="size-6 shrink-0 text-brand" aria-hidden />
          <span className="text-lg font-bold tracking-tight text-ink">Ownly</span>
        </div>
        <span className="hidden h-5 w-px bg-edge lg:block" aria-hidden />
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-weak px-2.5 py-1 text-[11px] font-semibold text-brand lg:gap-1.5 lg:px-3 lg:py-1.5 lg:text-xs">
          <Link2 className="size-3 shrink-0 lg:size-3.5" aria-hidden />
          <span className="lg:hidden">Shared Link</span>
          <span className="hidden lg:inline">Public Shared Link</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 lg:gap-4">
        {onInfoClick ? (
          <button
            type="button"
            onClick={onInfoClick}
            className="inline-flex size-8 items-center justify-center rounded-full border border-edge bg-surface text-ink transition-colors hover:bg-brand-weak lg:hidden"
            aria-label="Link information"
          >
            <Info className="size-4" aria-hidden />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled || saveLoading}
          className="hidden items-center gap-2 rounded-lg border border-edge bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex"
        >
          {saveLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <FolderInput className="size-4 shrink-0" aria-hidden />
          )}
          Save to My Ownly
        </button>
        <button
          type="button"
          disabled={downloadDisabled || downloadLoading}
          onClick={onDownload}
          className="hidden items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-brand-on transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex"
        >
          {downloadLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4 shrink-0" aria-hidden />
          )}
          <span className="max-w-[12rem] truncate xl:max-w-none">{downloadLabel}</span>
        </button>
      </div>
    </header>
  );
}
