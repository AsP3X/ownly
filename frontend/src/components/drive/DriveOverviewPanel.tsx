// Human: Home / My Cloud overview — metrics, folder cards, and recent activity table per Pencil wireframe.
// Agent: READS folders + recent files from parent; CALLS open/preview/upload handlers; Tailwind-only styling.

import type { ReactNode } from "react";
import {
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  ImageIcon,
  Lock,
  LockOpen,
  Music,
  Presentation,
  RefreshCw,
  Shield,
  Upload,
} from "lucide-react";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import { isFileProcessing } from "@/lib/file-processing";
import {
  formatBytes,
  formatFileOpened,
  isAudioMime,
  isImageMime,
  isPdfMime,
  isTextCodePreviewMime,
} from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DriveOverviewPanelProps = {
  folders: FolderItem[];
  recentFiles: FileItem[];
  usedBytes: number;
  quotaBytes: number;
  fileShareFlags?: Record<string, ShareFlags>;
  folderShareFlags?: Record<string, ShareFlags>;
  onOpenFolder: (folder: FolderItem) => void;
  onCreateFolder: () => void;
  onUpload: () => void;
  onViewAllFiles: () => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
};

// Human: Small file icon for the recent-activity name column.
// Agent: READS mime_type; RETURNS blue lucide icon sized to 16px.
function ActivityFileIcon({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = "size-4 shrink-0 text-[#2563EB]";
  if (mime.startsWith("image/")) return <ImageIcon className={className} aria-hidden />;
  if (mime.startsWith("video/")) return <Film className={className} aria-hidden />;
  if (mime.startsWith("audio/")) return <Music className={className} aria-hidden />;
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) {
    return <FileSpreadsheet className={className} aria-hidden />;
  }
  if (mime.includes("presentation") || mime.includes("powerpoint")) {
    return <Presentation className={className} aria-hidden />;
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("document")
  ) {
    return <FileText className={className} aria-hidden />;
  }
  return <FileIcon className={className} aria-hidden />;
}

// Human: KPI card shell shared by the three overview metric tiles.
// Agent: RENDERS label row + value + description; optional icon in top-right.
function MetricCard({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-[#E5E7EB] bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#888888]">{label}</p>
        <span className="text-[#2563EB]" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="text-[22px] font-bold leading-tight text-[#1A1A1A]">{value}</p>
      <p className="text-xs text-[#666666]">{description}</p>
    </article>
  );
}

// Human: Security label for a recent file row (shared vs encrypted-at-rest messaging).
// Agent: READS share flags; RETURNS icon + label matching Pencil Encrypted/Shared cells.
function SecurityCell({ flags }: { flags?: ShareFlags }) {
  const isShared = Boolean(flags?.public || flags?.users);
  if (isShared) {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-[#666666]">
        <LockOpen className="size-3.5 shrink-0 text-[#888888]" aria-hidden />
        Shared
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-[#1A1A1A]">
      <Lock className="size-3.5 shrink-0 text-[#2563EB]" aria-hidden />
      Encrypted
    </span>
  );
}

// Human: Folder shortcut card for the overview grid.
// Agent: CALLS onOpenFolder on click; SHOWS lock when folder is not publicly shared.
function FolderOverviewCard({
  folder,
  shareFlags,
  onOpen,
}: {
  folder: FolderItem;
  shareFlags?: ShareFlags;
  onOpen: () => void;
}) {
  const isShared = Boolean(shareFlags?.public || shareFlags?.users);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5 text-left transition-colors hover:border-[#2563EB]/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <Folder className="size-6 text-[#2563EB]" aria-hidden />
        {isShared ? (
          <LockOpen className="size-4 text-[#888888]" aria-hidden />
        ) : (
          <Lock className="size-4 text-[#2563EB]" aria-hidden />
        )}
      </div>
      <p className="text-[15px] font-bold text-[#1A1A1A]">{folder.name}</p>
      <p className="text-xs text-[#888888]">Updated {formatFileOpened(folder.updated_at)}</p>
    </button>
  );
}

/** Human: Main overview content when Home nav is active — full Pencil Main Overview layout. */
export function DriveOverviewPanel({
  folders,
  recentFiles,
  usedBytes,
  quotaBytes,
  fileShareFlags = {},
  folderShareFlags = {},
  onOpenFolder,
  onCreateFolder,
  onUpload,
  onViewAllFiles,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewAudio,
}: DriveOverviewPanelProps) {
  const usagePercent =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Content header — title + primary actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-[32px] font-bold leading-tight text-[#1A1A1A]">My Cloud</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-auto gap-2 rounded-lg border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F7F8FA]"
            onClick={onCreateFolder}
          >
            <FolderPlus className="size-4" aria-hidden />
            New Folder
          </Button>
          <Button
            type="button"
            className="h-auto gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1d4ed8]"
            onClick={onUpload}
          >
            <Upload className="size-4" aria-hidden />
            Upload Files
          </Button>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Secure vault space"
          value={`${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`}
          description={`${usagePercent}% storage used`}
          icon={<HardDrive className="size-4" />}
        />
        <MetricCard
          label="Security level"
          value="End-to-End"
          description="Zero knowledge active"
          icon={<Shield className="size-4" />}
        />
        <MetricCard
          label="Active sync devices"
          value="1 Connected"
          description="All files fully synchronized"
          icon={<RefreshCw className="size-4" />}
        />
      </div>

      {/* Folders */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-bold text-[#1A1A1A]">Folders</h2>
        {folders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E5E7EB] bg-white px-6 py-10 text-center text-sm text-[#666666]">
            No folders yet. Create one to organize your library.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {folders.map((folder) => (
              <FolderOverviewCard
                key={folder.id}
                folder={folder}
                shareFlags={folderShareFlags[folder.id]}
                onOpen={() => onOpenFolder(folder)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recent activity table */}
      <section className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#1A1A1A]">Recent Activity</h2>
          <button
            type="button"
            onClick={onViewAllFiles}
            className="text-sm font-semibold text-[#2563EB] hover:underline"
          >
            View All
          </button>
        </div>

        <div className="hidden border-b border-[#E5E7EB] py-2 md:grid md:grid-cols-[minmax(0,1fr)_120px_140px_140px] md:gap-4">
          <span className="text-xs font-bold text-[#888888]">Name</span>
          <span className="text-xs font-bold text-[#888888]">Size</span>
          <span className="text-xs font-bold text-[#888888]">Security</span>
          <span className="text-xs font-bold text-[#888888]">Date Modified</span>
        </div>

        {recentFiles.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#666666]">
            No recent files yet. Open or upload something from My Cloud.
          </p>
        ) : (
          <ul className="flex flex-col">
            {recentFiles.map((file) => {
              const isVideo = file.mime_type?.startsWith("video/") ?? false;
              const isImage = isImageMime(file.mime_type);
              const isPdf = isPdfMime(file.mime_type);
              const isAudio = isAudioMime(file.mime_type);
              const processing = isFileProcessing(file);
              const canPreviewVideo =
                isVideo && onPreviewVideo !== undefined && !processing;
              const canPreviewImage =
                isImage && onPreviewImage !== undefined && !processing;
              const canPreviewPdf = isPdf && onPreviewPdf !== undefined && !processing;
              const canPreviewText =
                isTextCodePreviewMime(file.mime_type, file.name) &&
                onPreviewText !== undefined &&
                !processing;
              const canPreviewAudio =
                isAudio && onPreviewAudio !== undefined && !processing;
              const canPreview =
                canPreviewVideo || canPreviewImage || canPreviewPdf || canPreviewText || canPreviewAudio;

              return (
                <li
                  key={file.id}
                  className="border-b border-[#E5E7EB] py-3 last:border-b-0"
                >
                  <div
                    role={canPreview ? "button" : undefined}
                    tabIndex={canPreview ? 0 : undefined}
                    onClick={() => {
                      if (!canPreview) return;
                      if (canPreviewVideo) onPreviewVideo!(file);
                      else if (canPreviewImage) onPreviewImage!(file);
                      else if (canPreviewPdf) onPreviewPdf!(file);
                      else if (canPreviewText) onPreviewText!(file);
                      else if (canPreviewAudio) onPreviewAudio!(file);
                    }}
                    onKeyDown={(event) => {
                      if (!canPreview || event.key !== "Enter") return;
                      if (canPreviewVideo) onPreviewVideo!(file);
                      else if (canPreviewImage) onPreviewImage!(file);
                      else if (canPreviewPdf) onPreviewPdf!(file);
                      else if (canPreviewText) onPreviewText!(file);
                      else if (canPreviewAudio) onPreviewAudio!(file);
                    }}
                    className={cn(
                      "grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_140px_140px] md:items-center md:gap-4",
                      canPreview && "cursor-pointer rounded-lg md:hover:bg-[#F7F8FA]",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ActivityFileIcon mimeType={file.mime_type} />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-[#1A1A1A]">
                            {file.name}
                          </span>
                          <SharedIndicator flags={fileShareFlags[file.id]} className="size-3" />
                        </div>
                        {processing ? (
                          <div className="mt-1">
                            <FileProcessingBadge
                              file={file}
                              className="bg-violet-100 text-violet-900"
                            />
                          </div>
                        ) : null}
                        <p className="mt-0.5 text-xs text-[#666666] md:hidden">
                          {formatBytes(file.size_bytes)} ·{" "}
                          {formatFileOpened(file.updated_at)}
                        </p>
                      </div>
                    </div>
                    <span className="hidden text-sm text-[#666666] md:block">
                      {formatBytes(file.size_bytes)}
                    </span>
                    <span className="hidden md:block">
                      <SecurityCell flags={fileShareFlags[file.id]} />
                    </span>
                    <span className="hidden text-sm text-[#666666] md:block">
                      {formatFileOpened(file.updated_at)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
