// Human: Folder browser for anonymous public shares — Pencil mobile list + desktop explorer.
// Agent: READS folders + files props; EMITS navigation/preview/download; CLIENT-FILTERS by search query.

import { useMemo, useState } from "react";
import {
  ChevronRight,
  Download,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  ImageIcon,
  Loader2,
  Music,
  Presentation,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import { publicShareIconFrameClass } from "@/components/public-share/public-share-file-styles";
import { PublicShareSecurityBadge } from "@/components/public-share/PublicShareSecurityBadge";
import {
  formatBytes,
  formatFileOpened,
  isAudioMime,
  isImageMime,
  isPdfMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
  sortFilesByName,
} from "@/lib/utils-app";
import { expandShareSelectionToFiles } from "@/lib/public-share-selection";
import { cn } from "@/lib/utils";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";

export type PublicShareBreadcrumb = { id: string; name: string };

type FilterMode = "all" | "folders" | "files";

type PublicShareExplorerProps = {
  shareName: string;
  folders: FolderItem[];
  files: FileItem[];
  /** Human: Entire share tree — powers cross-folder search and folder bulk expansion. */
  allFiles: FileItem[];
  allFolders: FolderItem[];
  breadcrumbs: PublicShareBreadcrumb[];
  loading: boolean;
  downloadingId: string | null;
  onOpenFolder: (folder: FolderItem) => void;
  onNavigateBreadcrumb: (folderId: string) => void;
  onDownload: (file: FileItem) => void;
  onPreviewVideo: (file: FileItem) => void;
  onPreviewImage: (file: FileItem) => void;
  onPreviewPdf: (file: FileItem) => void;
  onPreviewText: (file: FileItem) => void;
  onPreviewSpreadsheet: (file: FileItem) => void;
  onPreviewAudio: (file: FileItem) => void;
  allowDownload?: boolean;
  onBulkDownload?: (files: FileItem[]) => void;
  /** Human: Mobile Pencil header — Download All pill beside Shared Files title. */
  onDownloadAll?: () => void;
  downloadAllDisabled?: boolean;
  downloadAllLoading?: boolean;
};

function ShareFileTypeIcon({
  mimeType,
  isFolder,
  compact,
}: {
  mimeType: string | null;
  isFolder?: boolean;
  compact?: boolean;
}) {
  const frameClass = cn(
    "flex shrink-0 items-center justify-center rounded-lg lg:rounded-[10px]",
    compact ? "size-9" : "size-10",
    publicShareIconFrameClass(mimeType, Boolean(isFolder)),
  );
  const iconClass = compact ? "size-4" : "size-5";
  if (isFolder) {
    return (
      <div className={frameClass}>
        <Folder className={iconClass} aria-hidden />
      </div>
    );
  }
  const mime = (mimeType ?? "").toLowerCase();
  return (
    <div className={frameClass}>
      {mime.startsWith("image/") ? (
        <ImageIcon className={iconClass} aria-hidden />
      ) : mime.startsWith("video/") ? (
        <Film className={iconClass} aria-hidden />
      ) : mime.startsWith("audio/") ? (
        <Music className={iconClass} aria-hidden />
      ) : mime.includes("sheet") || mime.includes("excel") ? (
        <FileSpreadsheet className={iconClass} aria-hidden />
      ) : mime.includes("presentation") ? (
        <Presentation className={iconClass} aria-hidden />
      ) : mime.startsWith("text/") || mime.includes("pdf") || mime.includes("word") ? (
        <FileText className={iconClass} aria-hidden />
      ) : (
        <FileIcon className={iconClass} aria-hidden />
      )}
    </div>
  );
}

function resolvePreviewHandler(
  file: FileItem,
  handlers: Pick<
    PublicShareExplorerProps,
    "onPreviewVideo" | "onPreviewImage" | "onPreviewPdf" | "onPreviewText" | "onPreviewSpreadsheet" | "onPreviewAudio"
  >,
): (() => void) | undefined {
  if (isFileProcessing(file)) return undefined;
  const isVideo = file.mime_type?.startsWith("video/") ?? false;
  if (isVideo && file.hls_ready) return () => handlers.onPreviewVideo(file);
  if (isImageMime(file.mime_type)) return () => handlers.onPreviewImage(file);
  if (isPdfMime(file.mime_type)) return () => handlers.onPreviewPdf(file);
  if (isSpreadsheetPreviewMime(file.mime_type, file.name)) return () => handlers.onPreviewSpreadsheet(file);
  if (isTextCodePreviewMime(file.mime_type, file.name)) return () => handlers.onPreviewText(file);
  if (isAudioMime(file.mime_type)) return () => handlers.onPreviewAudio(file);
  return undefined;
}

function fileMetaLine(file: FileItem, compact: boolean): string {
  const parts: string[] = [];
  const mime = file.mime_type ?? "File";
  if (compact) {
    parts.push(formatBytes(file.size_bytes));
    const subtype = mime.split("/")[1];
    if (subtype) {
      parts.push(subtype.toUpperCase().replace(/[-_]/g, " "));
    }
    return parts.join(" • ");
  }
  parts.push(mime.split("/")[1]?.toUpperCase() ?? mime);
  parts.push(formatBytes(file.size_bytes));
  if (file.updated_at) parts.push(`Modified ${formatFileOpened(file.updated_at)}`);
  return parts.join(" • ");
}

export function PublicShareExplorer({
  shareName,
  folders,
  files,
  allFiles,
  allFolders,
  breadcrumbs,
  loading,
  downloadingId,
  onOpenFolder,
  onNavigateBreadcrumb,
  onDownload,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewSpreadsheet,
  onPreviewAudio,
  allowDownload = true,
  onBulkDownload,
  onDownloadAll,
  downloadAllDisabled,
  downloadAllLoading,
}: PublicShareExplorerProps) {
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [folders],
  );
  const sortedFiles = useMemo(() => sortFilesByName(files), [files]);
  const query = search.trim().toLowerCase();

  const filteredFolders = useMemo(() => {
    if (filterMode === "files") return [];
    if (query) {
      return [...allFolders]
        .filter((f) => f.name.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    return sortedFolders;
  }, [sortedFolders, allFolders, query, filterMode]);

  const filteredFiles = useMemo(() => {
    if (filterMode === "folders") return [];
    if (query) {
      return [...allFiles]
        .filter((f) => f.name.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    return sortedFiles;
  }, [sortedFiles, allFiles, query, filterMode]);

  const visibleCount = filteredFolders.length + filteredFiles.length;
  const allIds = useMemo(
    () => [...filteredFolders.map((f) => f.id), ...filteredFiles.map((f) => f.id)],
    [filteredFolders, filteredFiles],
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  const previewHandlers = {
    onPreviewVideo,
    onPreviewImage,
    onPreviewPdf,
    onPreviewText,
    onPreviewSpreadsheet,
    onPreviewAudio,
  };

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(allIds));
  }

  const rootCrumb = breadcrumbs[0];
  const currentCrumb = breadcrumbs[breadcrumbs.length - 1];

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {/* Human: Mobile-only section title + Download All — Pencil Page Actions Header Row */}
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <h1 className="text-lg font-bold text-[#1A1A1A]">Shared Files</h1>
        {allowDownload && onDownloadAll ? (
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={downloadAllDisabled || downloadAllLoading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloadAllLoading ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3 shrink-0" aria-hidden />
            )}
            Download All
          </button>
        ) : null}
      </div>

      {/* Human: Search & Filter Row — full-width input + icon-only filter on mobile */}
      <div className="flex items-center gap-2.5">
        <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-2.5 lg:max-w-xs lg:rounded-lg">
          <Search className="size-3.5 shrink-0 text-[#666666] lg:size-4" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shared files..."
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#1A1A1A] outline-none placeholder:text-[#888888] lg:placeholder:text-[#666666]"
          />
        </label>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className="inline-flex size-11 items-center justify-center rounded-[10px] border border-[#E5E7EB] bg-white text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] lg:size-auto lg:gap-2 lg:rounded-lg lg:px-3.5 lg:py-2.5 lg:text-[13px] lg:font-semibold"
            aria-label="Filter items"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="hidden lg:inline">Filter</span>
          </button>
          {filterOpen ? (
            <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-[0_8px_24px_#00000014]">
              {(["all", "folders", "files"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "block w-full px-3 py-2 text-left text-sm capitalize transition-colors hover:bg-[#F7F8FA]",
                    filterMode === mode && "font-semibold text-[#2563EB]",
                  )}
                  onClick={() => {
                    setFilterMode(mode);
                    setFilterOpen(false);
                  }}
                >
                  {mode === "all" ? "All items" : mode}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Human: Breadcrumbs Row — Shared Link / current folder name */}
      <nav className="flex flex-wrap items-center gap-1.5 text-xs lg:gap-2 lg:text-[13px]" aria-label="Folder path">
        <button
          type="button"
          className="text-[#666666] transition-colors hover:text-[#2563EB] hover:underline"
          onClick={() => rootCrumb && onNavigateBreadcrumb(rootCrumb.id)}
        >
          Shared Link
        </button>
        {breadcrumbs.length > 1 ? (
          <>
            <ChevronRight className="size-2.5 text-[#888888] lg:size-3" aria-hidden />
            <span className="font-semibold text-[#1A1A1A]">{currentCrumb?.name ?? shareName}</span>
          </>
        ) : (
          <>
            <ChevronRight className="size-2.5 text-[#888888] lg:size-3" aria-hidden />
            <span className="font-semibold text-[#1A1A1A]">{shareName}</span>
          </>
        )}
      </nav>

      {/* Human: Bulk Action Bar — select all + download selected */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#666666] lg:gap-2.5 lg:text-[13px]">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="size-4 rounded border border-[#E5E7EB] accent-[#2563EB]"
          />
          {visibleCount} item{visibleCount === 1 ? "" : "s"} inside folder
        </label>
        {allowDownload && selectedIds.size > 0 && onBulkDownload ? (
          <button
            type="button"
            onClick={() =>
              onBulkDownload(expandShareSelectionToFiles(selectedIds, allFiles, allFolders))
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] lg:px-3.5 lg:py-2 lg:text-[13px]"
          >
            <Download className="size-3 shrink-0 lg:size-3.5" aria-hidden />
            <span className="lg:hidden">DL Selected</span>
            <span className="hidden lg:inline">Download Selected</span>
          </button>
        ) : null}
      </div>

      {loading && visibleCount === 0 ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[#666666]">
          <Loader2 className="size-5 animate-spin" />
          Loading folder…
        </div>
      ) : visibleCount === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white py-20 text-center">
          <Folder className="size-10 text-[#E5E7EB]" aria-hidden />
          <p className="font-semibold text-[#1A1A1A]">This folder is empty</p>
          <p className="text-sm text-[#666666]">There are no files or subfolders here.</p>
        </div>
      ) : (
        <div className="relative flex flex-col gap-2.5 lg:gap-3">
          {loading ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70"
              aria-live="polite"
            >
              <Loader2 className="size-6 animate-spin text-[#666666]" />
            </div>
          ) : null}

          {filteredFolders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center justify-between gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-3 lg:gap-4 lg:px-5 lg:py-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:gap-4">
                <input
                  type="checkbox"
                  checked={selectedIds.has(folder.id)}
                  onChange={() => toggleSelect(folder.id)}
                  className="size-4 shrink-0 rounded border border-[#E5E7EB] accent-[#2563EB]"
                  aria-label={`Select ${folder.name}`}
                />
                <ShareFileTypeIcon isFolder mimeType={null} compact />
                <button
                  type="button"
                  onClick={() => onOpenFolder(folder)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-[13px] font-bold text-[#1A1A1A] lg:text-sm lg:font-semibold">
                    {folder.name}
                  </p>
                  <p className="text-[11px] text-[#666666] lg:text-xs">Folder • Open to browse</p>
                </button>
              </div>
              <button
                type="button"
                onClick={() => onOpenFolder(folder)}
                className="hidden shrink-0 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] lg:inline-flex"
              >
                Open
              </button>
              {allowDownload ? (
                <button
                  type="button"
                  onClick={() => onOpenFolder(folder)}
                  className="inline-flex shrink-0 items-center justify-center p-1 text-[#666666] transition-colors hover:text-[#2563EB] lg:hidden"
                  aria-label={`Open ${folder.name}`}
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          ))}

          {filteredFiles.map((file) => {
            const processing = isFileProcessing(file);
            const onPreview = resolvePreviewHandler(file, previewHandlers);
            return (
              <div
                key={file.id}
                className={cn(
                  "flex items-center justify-between gap-2.5 rounded-xl border border-[#E5E7EB] bg-white p-3 lg:gap-4 lg:px-5 lg:py-4",
                  processing && "border-violet-200 bg-violet-50/30",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:gap-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(file.id)}
                    onChange={() => toggleSelect(file.id)}
                    className="size-4 shrink-0 rounded border border-[#E5E7EB] accent-[#2563EB]"
                    aria-label={`Select ${file.name}`}
                  />
                  <ShareFileTypeIcon mimeType={file.mime_type} compact />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-[13px] font-bold text-[#1A1A1A] lg:text-sm lg:font-semibold">
                        {file.name}
                      </p>
                      {processing ? <FileProcessingBadge file={file} /> : null}
                    </div>
                    <p className="truncate text-[11px] text-[#666666] lg:text-xs">
                      <span className="lg:hidden">{fileMetaLine(file, true)}</span>
                      <span className="hidden lg:inline">{fileMetaLine(file, false)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 lg:gap-2">
                  {onPreview ? (
                    <button
                      type="button"
                      onClick={onPreview}
                      className="rounded-md bg-[#F7F8FA] px-2 py-1 text-[10px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#EFF6FF] lg:rounded-lg lg:px-3.5 lg:py-2 lg:text-[13px]"
                    >
                      Preview
                    </button>
                  ) : null}
                  {allowDownload ? (
                    <button
                      type="button"
                      disabled={processing || downloadingId === file.id}
                      onClick={() => onDownload(file)}
                      className="inline-flex shrink-0 items-center justify-center text-[#666666] transition-colors hover:text-[#2563EB] disabled:opacity-60 lg:gap-1.5 lg:rounded-lg lg:border lg:border-[#E5E7EB] lg:bg-white lg:px-3.5 lg:py-2 lg:text-[13px] lg:font-semibold lg:text-[#1A1A1A] lg:hover:bg-[#F7F8FA]"
                      aria-label={`Download ${file.name}`}
                    >
                      {downloadingId === file.id ? (
                        <Loader2 className="size-4 animate-spin lg:size-3.5" />
                      ) : (
                        <Download className="size-4 lg:size-3.5" />
                      )}
                      <span className="hidden lg:inline">Download</span>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Human: Mobile security badge — Pencil Security Badge Wrapper at list bottom */}
      <div className="flex justify-center pt-2 lg:hidden">
        <PublicShareSecurityBadge variant="pill" />
      </div>
    </div>
  );
}
