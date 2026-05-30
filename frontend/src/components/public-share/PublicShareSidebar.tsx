// Human: Right column on public share pages — owner info, dates, stats, security, and signup CTA.
// Agent: READS PublicShareInfo from overview API; RENDERS Pencil sidebar copy with Tailwind tokens.

import { Cloud, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { PublicShareInfo } from "@/api/client";
import {
  displayNameFromEmail,
  formatShareDate,
  formatShareExpiry,
} from "@/lib/public-share-format";
import { formatBytes } from "@/lib/utils-app";

type PublicShareSidebarProps = {
  overview: PublicShareInfo;
};

export function PublicShareSidebar({ overview }: PublicShareSidebarProps) {
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
    <aside className="flex w-full flex-col gap-6 lg:w-[380px] lg:shrink-0">
      <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-5">
        <p className="text-[11px] font-semibold tracking-wide text-[#888888]">SHARED BY</p>
        <div className="flex items-center gap-3">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[15px] font-bold text-[#2563EB]"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <p className="truncate text-[15px] font-bold text-[#1A1A1A]">{displayName}</p>
            <p className="truncate text-xs text-[#666666]">
              {overview.shared_by_email} • Ownly
            </p>
          </div>
        </div>
        <div className="h-px w-full bg-[#E5E7EB]" />
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#666666]">Created</dt>
            <dd className="font-semibold text-[#1A1A1A]">{formatShareDate(overview.created_at)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#666666]">Expires</dt>
            <dd className="max-w-[14rem] text-right text-xs font-semibold leading-snug text-[#1A1A1A]">
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

      <div className="flex flex-col gap-3 rounded-xl border border-[#DCFCE7] bg-[#F0FDF4] p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-[18px] shrink-0 text-[#166534]" aria-hidden />
          <p className="text-sm font-bold text-[#166534]">Zero-Knowledge Verified</p>
        </div>
        <p className="text-xs leading-relaxed text-[#15803D]">
          These files are encrypted client-side. Ownly cannot view, access, or log your shared files. Only
          people with this link can decrypt and view them.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-5">
        <p className="text-[15px] font-bold text-[#1A1A1A]">Get Your Secure Cloud Storage</p>
        <p className="text-xs leading-relaxed text-[#666666]">
          Tired of big tech scanning your files? Ownly gives you 10 GB of free, zero-knowledge encrypted
          storage. Keep your private life private.
        </p>
        <Link
          to="/register"
          className="flex h-11 w-full items-center justify-center rounded-lg bg-[#2563EB] text-[13px] font-bold text-white transition-colors hover:bg-[#1d4ed8]"
        >
          <Cloud className="mr-2 size-4" aria-hidden />
          Get 10 GB Free Storage
        </Link>
      </div>
    </aside>
  );
}
