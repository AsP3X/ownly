// Human: Folder browser for anonymous public shares — Pencil list rows, search, and bulk download bar.
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
import {
  formatBytes,
  formatFileOpened,
  isAudioMime,
  isImageMime,
  isPdfMime,
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
  onPreviewAudio: (file: FileItem) => void;
  allowDownload?: boolean;
  onBulkDownload?: (files: FileItem[]) => void;
};

function ShareFileTypeIcon({ mimeType, isFolder }: { mimeType: string | null; isFolder?: boolean }) {
  const frameClass = cn(
    "flex size-10 shrink-0 items-center justify-center rounded-[10px]",
    publicShareIconFrameClass(mimeType, Boolean(isFolder)),
  );
  const iconClass = "size-5";
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
    "onPreviewVideo" | "onPreviewImage" | "onPreviewPdf" | "onPreviewAudio"
  >,
): (() => void) | undefined {
  if (isFileProcessing(file)) return undefined;
  const isVideo = file.mime_type?.startsWith("video/") ?? false;
  if (isVideo && file.hls_ready) return () => handlers.onPreviewVideo(file);
  if (isImageMime(file.mime_type)) return () => handlers.onPreviewImage(file);
  if (isPdfMime(file.mime_type)) return () => handlers.onPreviewPdf(file);
  if (isAudioMime(file.mime_type)) return () => handlers.onPreviewAudio(file);
  return undefined;
}

function fileMetaLine(file: FileItem): string {
  const parts: string[] = [];
  const mime = file.mime_type ?? "File";
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
  onPreviewAudio,
  allowDownload = true,
  onBulkDownload,
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
    <div className="flex flex-col gap-6">
      {/* Human: Search & Filter Row from Pencil Shared Files List Container */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative flex w-full max-w-xs items-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-[#666666]" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shared files..."
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#1A1A1A] outline-none placeholder:text-[#666666]"
          />
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-[13px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA]"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filter
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
      <nav className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Folder path">
        <button
          type="button"
          className="text-[#666666] transition-colors hover:text-[#2563EB] hover:underline"
          onClick={() => rootCrumb && onNavigateBreadcrumb(rootCrumb.id)}
        >
          Shared Link
        </button>
        {breadcrumbs.length > 1 ? (
          <>
            <ChevronRight className="size-3 text-[#888888]" aria-hidden />
            <span className="font-semibold text-[#1A1A1A]">{currentCrumb?.name ?? shareName}</span>
          </>
        ) : (
          <>
            <ChevronRight className="size-3 text-[#888888]" aria-hidden />
            <span className="font-semibold text-[#1A1A1A]">{shareName}</span>
          </>
        )}
      </nav>

      {/* Human: Bulk Action Bar — select all + download selected */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-[#666666]">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA]"
          >
            <Download className="size-3.5" aria-hidden />
            Download Selected
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
        <div className="relative flex flex-col gap-3">
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
              className="flex items-center justify-between gap-4 rounded-xl border border-[#E5E7EB] bg-white px-5 py-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <input
                  type="checkbox"
                  checked={selectedIds.has(folder.id)}
                  onChange={() => toggleSelect(folder.id)}
                  className="size-4 shrink-0 rounded border border-[#E5E7EB] accent-[#2563EB]"
                  aria-label={`Select ${folder.name}`}
                />
                <ShareFileTypeIcon isFolder mimeType={null} />
                <button
                  type="button"
                  onClick={() => onOpenFolder(folder)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-[#1A1A1A]">{folder.name}</p>
                  <p className="text-xs text-[#666666]">Folder • Open to browse</p>
                </button>
              </div>
              <button
                type="button"
                onClick={() => onOpenFolder(folder)}
                className="shrink-0 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA]"
              >
                Open
              </button>
            </div>
          ))}

          {filteredFiles.map((file) => {
            const processing = isFileProcessing(file);
            const onPreview = resolvePreviewHandler(file, previewHandlers);
            return (
              <div
                key={file.id}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-xl border border-[#E5E7EB] bg-white px-5 py-4",
                  processing && "border-violet-200 bg-violet-50/30",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(file.id)}
                    onChange={() => toggleSelect(file.id)}
                    className="size-4 shrink-0 rounded border border-[#E5E7EB] accent-[#2563EB]"
                    aria-label={`Select ${file.name}`}
                  />
                  <ShareFileTypeIcon mimeType={file.mime_type} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[#1A1A1A]">{file.name}</p>
                      {processing ? <FileProcessingBadge file={file} /> : null}
                    </div>
                    <p className="truncate text-xs text-[#666666]">{fileMetaLine(file)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {onPreview ? (
                    <button
                      type="button"
                      onClick={onPreview}
                      className="rounded-lg bg-[#F7F8FA] px-3.5 py-2 text-[13px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#EFF6FF]"
                    >
                      Preview
                    </button>
                  ) : null}
                  {allowDownload ? (
                    <button
                      type="button"
                      disabled={processing || downloadingId === file.id}
                      onClick={() => onDownload(file)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60"
                    >
                      {downloadingId === file.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      Download
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
