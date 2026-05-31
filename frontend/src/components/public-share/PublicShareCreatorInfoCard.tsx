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
        "flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-4 lg:p-5",
        className,
      )}
    >
      <p className="text-[11px] font-semibold tracking-wide text-[#888888]">SHARED BY</p>
      <div className="flex items-center gap-3">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[15px] font-bold text-[#2563EB]"
          aria-hidden
        >
          {initials}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-[15px] font-bold text-[#1A1A1A]">{displayName}</p>
          <p className="truncate text-xs text-[#666666]">{overview.shared_by_email} • Ownly</p>
        </div>
      </div>
      <div className="h-px w-full bg-[#E5E7EB]" />
      <dl className="flex flex-col gap-3 text-[13px]">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#666666]">Created</dt>
          <dd className="font-semibold text-[#1A1A1A]">{formatShareDate(overview.created_at)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#666666]">Expires</dt>
          <dd className="max-w-[14rem] text-right font-semibold leading-snug text-[#1A1A1A]">
            {formatShareExpiry(overview.expires_at)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#666666]">Total Files</dt>
          <dd className="font-semibold text-[#1A1A1A]">{totalFilesLabel}</dd>
        </div>
        {folderLabel ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#666666]">Folders</dt>
            <dd className="font-semibold text-[#1A1A1A]">{folderLabel}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#666666]">Total Size</dt>
          <dd className="font-semibold text-[#1A1A1A]">
            {overview.total_bytes > 0 ? formatBytes(overview.total_bytes) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
