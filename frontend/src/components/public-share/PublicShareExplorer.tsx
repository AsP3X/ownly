// Human: File-explorer browser for anonymous folder shares — grid/list views and folder navigation.
// Agent: READS folders + files props; EMITS openFolder/preview/download; PERSISTS view mode in sessionStorage.

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Music,
  Presentation,
} from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import {
  formatBytes,
  formatFileOpened,
  isAudioMime,
  isImageMime,
  isPdfMime,
  sortFilesByName,
} from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";

export type PublicShareBreadcrumb = { id: string; name: string };

type ViewMode = "grid" | "list";

const VIEW_MODE_STORAGE_KEY = "public-share-view-mode";

type PublicShareExplorerProps = {
  shareName: string;
  folders: FolderItem[];
  files: FileItem[];
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
};

// Human: Read persisted grid/list preference — grid is the default for new visitors.
// Agent: READS sessionStorage; RETURNS "grid" | "list".
function readStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "grid";
  const stored = window.sessionStorage.getItem(VIEW_MODE_STORAGE_KEY);
  return stored === "list" ? "list" : "grid";
}

// Human: Small mime icon for list rows and grid tile headers.
// Agent: READS mime_type; RETURNS lucide icon sized for explorer tiles.
function ShareFileTypeIcon({ mimeType, large }: { mimeType: string | null; large?: boolean }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = large ? "size-10 text-blue-600" : "size-[18px] shrink-0 text-blue-600";
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

// Human: Decide whether a file row/tile should open a preview vs download-only.
// Agent: READS mime + processing + hls_ready; RETURNS preview handler or undefined.
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

export function PublicShareExplorer({
  shareName,
  folders,
  files,
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
}: PublicShareExplorerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => readStoredViewMode());

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [folders],
  );
  const sortedFiles = useMemo(() => sortFilesByName(files), [files]);
  const itemCount = sortedFolders.length + sortedFiles.length;
  const canGoBack = breadcrumbs.length > 1;

  // Human: Remember grid vs list for the rest of the browser session on this tab.
  // Agent: WRITES sessionStorage when viewMode changes.
  useEffect(() => {
    window.sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const previewHandlers = {
    onPreviewVideo,
    onPreviewImage,
    onPreviewPdf,
    onPreviewAudio,
  };

  function handleBack() {
    if (breadcrumbs.length < 2) return;
    onNavigateBreadcrumb(breadcrumbs[breadcrumbs.length - 2]!.id);
  }

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      {/* Human: Explorer toolbar — navigation, breadcrumbs, and view toggle like a desktop file manager. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!canGoBack}
            onClick={handleBack}
            aria-label="Go back"
          >
            <ArrowLeft className="size-4" />
          </Button>
        </div>

        <nav
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm"
          aria-label="Folder path"
        >
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <span className="text-neutral-400">/</span> : null}
              <button
                type="button"
                className={cn(
                  "max-w-[12rem] truncate rounded px-1 py-0.5 text-left transition-colors",
                  index === breadcrumbs.length - 1
                    ? "font-medium text-neutral-900"
                    : "text-sky-700 hover:bg-sky-50 hover:underline",
                )}
                disabled={index === breadcrumbs.length - 1}
                onClick={() => onNavigateBreadcrumb(crumb.id)}
                title={crumb.name || shareName}
              >
                {crumb.name || shareName}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2 text-xs text-neutral-500 sm:text-sm">
          <span className="hidden sm:inline">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <div className="flex rounded-md border border-neutral-200 p-0.5">
            <Button
              type="button"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              type="button"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setViewMode("list")}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading folder…
        </div>
      ) : itemCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Folder className="size-10 text-neutral-300" />
          <p className="font-medium text-neutral-700">This folder is empty</p>
          <p className="text-sm text-neutral-500">There are no files or subfolders here.</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {sortedFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => onOpenFolder(folder)}
                className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-left transition hover:border-amber-200 hover:shadow-sm"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-[#f3f2f1]">
                  <Folder className="size-10 text-amber-500" aria-hidden />
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="truncate text-sm font-medium text-neutral-900">{folder.name}</span>
                  <span className="text-xs text-neutral-500">Folder</span>
                </div>
              </button>
            ))}
            {sortedFiles.map((file) => {
              const processing = isFileProcessing(file);
              const onPreview = resolvePreviewHandler(file, previewHandlers);
              return (
                <article
                  key={file.id}
                  onClick={(event) => {
                    if (!onPreview) return;
                    const target = event.target;
                    if (!(target instanceof Element)) return;
                    if (target.closest("button")) return;
                    onPreview();
                  }}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-blue-200 hover:shadow-sm",
                    onPreview && "cursor-pointer",
                    processing && "border-violet-200 bg-violet-50/30",
                  )}
                >
                  <div className="relative flex aspect-[4/3] items-center justify-center bg-[#f3f2f1]">
                    <ShareFileTypeIcon mimeType={file.mime_type} large />
                    {processing ? (
                      <div className="absolute inset-x-2 bottom-2">
                        <FileProcessingBadge file={file} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 px-3 py-2">
                    <span className="truncate text-sm font-medium text-neutral-900">{file.name}</span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-500">{formatBytes(file.size_bytes)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        disabled={processing || downloadingId === file.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDownload(file);
                        }}
                        aria-label={`Download ${file.name}`}
                      >
                        {downloadingId === file.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10 border-b border-neutral-100 bg-neutral-50/95 backdrop-blur-sm">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                <th className="py-2.5 pr-4 pl-4 font-medium">Name</th>
                <th className="hidden py-2.5 pr-4 font-medium sm:table-cell">Modified</th>
                <th className="py-2.5 pr-4 font-medium">Size</th>
                <th className="py-2.5 pr-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedFolders.map((folder) => (
                <tr
                  key={folder.id}
                  className="border-b border-neutral-100 transition-colors hover:bg-neutral-50"
                >
                  <td className="py-2.5 pr-4 pl-4">
                    <button
                      type="button"
                      onClick={() => onOpenFolder(folder)}
                      className="flex min-w-0 items-center gap-3 text-left"
                    >
                      <Folder className="size-[18px] shrink-0 text-amber-500" aria-hidden />
                      <span className="truncate font-medium text-neutral-900">{folder.name}</span>
                    </button>
                  </td>
                  <td className="hidden py-2.5 pr-4 whitespace-nowrap text-neutral-600 sm:table-cell">
                    {formatFileOpened(folder.updated_at)}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-neutral-500">—</td>
                  <td className="py-2.5 pr-4 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onOpenFolder(folder)}
                      aria-label={`Open ${folder.name}`}
                    >
                      <Folder className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {sortedFiles.map((file) => {
                const processing = isFileProcessing(file);
                const onPreview = resolvePreviewHandler(file, previewHandlers);
                return (
                  <tr
                    key={file.id}
                    onClick={() => onPreview?.()}
                    className={cn(
                      "border-b border-neutral-100 transition-colors hover:bg-neutral-50",
                      onPreview && "cursor-pointer",
                      processing && "bg-violet-50/40",
                    )}
                  >
                    <td className="py-2.5 pr-4 pl-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <ShareFileTypeIcon mimeType={file.mime_type} />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium text-neutral-900">{file.name}</span>
                            {processing ? <FileProcessingBadge file={file} /> : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-2.5 pr-4 whitespace-nowrap text-neutral-600 sm:table-cell">
                      {formatFileOpened(file.updated_at)}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-neutral-600">
                      {formatBytes(file.size_bytes)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={processing || downloadingId === file.id}
                          onClick={() => onDownload(file)}
                          aria-label={`Download ${file.name}`}
                        >
                          {downloadingId === file.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Download className="size-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
