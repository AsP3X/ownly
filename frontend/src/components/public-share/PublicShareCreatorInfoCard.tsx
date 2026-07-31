// Human: Creator + link metadata card — shared by desktop sidebar and mobile info sheet.
// Agent: READS PublicShareInfo; RENDERS SHARED BY block and metadata rows with Tailwind tokens.

import type { PublicShareInfo } from "@/api/client";
import {
  displayNameFromEmail,
  formatShareDate,
  formatShareExpiry,
} from "@/lib/public-share-format";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type PublicShareCreatorInfoCardProps = {
  overview: PublicShareInfo;
  className?: string;
};

export function PublicShareCreatorInfoCard({ overview, className }: PublicShareCreatorInfoCardProps) {
  const displayName = displayNameFromEmail(overview.shared_by_email);
  const initials = displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const totalFilesLabel =
    overview.resource_type === "file"
      ? "1 file"
      : overview.total_file_count === 1
        ? "1 item"
        : `${overview.total_file_count} items`;

  const folderLabel =
    overview.resource_type === "folder" && overview.total_folder_count > 0
      ? `${overview.total_folder_count} folder${overview.total_folder_count === 1 ? "" : "s"}`
      : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-edge bg-panel p-4 lg:p-5",
        className,
      )}
    >
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint">SHARED BY</p>
      <div className="flex items-center gap-3">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-weak text-[15px] font-bold text-brand"
          aria-hidden
        >
          {initials}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-[15px] font-bold text-ink">{displayName}</p>
          <p className="truncate text-xs text-ink-muted">{overview.shared_by_email} • Ownly</p>
        </div>
      </div>
      <div className="h-px w-full bg-edge" />
      <dl className="flex flex-col gap-3 text-[13px]">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-ink-muted">Created</dt>
          <dd className="font-semibold text-ink">{formatShareDate(overview.created_at)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-ink-muted">Expires</dt>
          <dd className="max-w-[14rem] text-right font-semibold leading-snug text-ink">
            {formatShareExpiry(overview.expires_at)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-ink-muted">Total Files</dt>
          <dd className="font-semibold text-ink">{totalFilesLabel}</dd>
        </div>
        {folderLabel ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Folders</dt>
            <dd className="font-semibold text-ink">{folderLabel}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-ink-muted">Total Size</dt>
          <dd className="font-semibold text-ink">
            {overview.total_bytes > 0 ? formatBytes(overview.total_bytes) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
