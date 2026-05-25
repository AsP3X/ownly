// Human: Mobile-native list view for the My files browser — folders and files as tappable rows.
// Agent: lg:hidden counterpart to FileTable; SUPPORTS selection, preview tap, and action sheet trigger.

import { useEffect, useMemo, useRef, type ChangeEvent, type RefObject } from "react";
import {
  ChevronRight,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  ImageIcon,
  MoreVertical,
  Music,
  Presentation,
} from "lucide-react";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import { isFileProcessing } from "@/lib/file-processing";
import { formatBytes, formatFileOpened, isImageMime } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";

type FileListViewProps = {
  folders?: FolderItem[];
  files: FileItem[];
  ownerLabel: string;
  favouriteIds: Set<string>;
  locationLabel?: string;
  emptyMessage: string;
  selectable?: boolean;
  selectedFileIds?: Set<string>;
  onSelectedFileIdsChange?: (ids: Set<string>) => void;
  onOpenFolder?: (folder: FolderItem) => void;
  onToggleFavourite: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  onDownload: (file: FileItem) => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  fileShareFlags?: Record<string, ShareFlags>;
  folderShareFlags?: Record<string, ShareFlags>;
  hasMoreFiles?: boolean;
  loadingMoreFiles?: boolean;
  onLoadMoreFiles?: () => void;
  hasMoreFolders?: boolean;
  loadingMoreFolders?: boolean;
  onLoadMoreFolders?: () => void;
  scrollElementRef?: RefObject<HTMLElement | null>;
  onOpenActions: (target: MobileActionTarget) => void;
};

// Human: Compact mime icon for mobile list rows.
// Agent: READS mime_type string; RETURNS lucide icon sized for list density.
function FileTypeIcon({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = "size-5 shrink-0 text-blue-600";
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

// Human: Scrollable list replacing the desktop table on viewports below lg.
// Agent: RENDERS folder rows first; OBSERVES scroll sentinel for infinite file load.
export function FileListView({
  folders = [],
  files,
  ownerLabel,
  locationLabel = "My files",
  emptyMessage,
  selectable = false,
  selectedFileIds,
  onSelectedFileIdsChange,
  onOpenFolder,
  onPreviewVideo,
  onPreviewImage,
  fileShareFlags = {},
  folderShareFlags = {},
  hasMoreFiles = false,
  loadingMoreFiles = false,
  onLoadMoreFiles,
  hasMoreFolders = false,
  loadingMoreFolders = false,
  onLoadMoreFolders,
  scrollElementRef,
  onOpenActions,
}: FileListViewProps) {
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selectionEnabled = selectable && selectedFileIds !== undefined && onSelectedFileIdsChange !== undefined;
  const selectableFileIds = useMemo(
    () => files.filter((file) => !isFileProcessing(file)).map((file) => file.id),
    [files],
  );
  const selectedVisibleCount = selectionEnabled
    ? selectableFileIds.filter((id) => selectedFileIds.has(id)).length
    : 0;
  const allVisibleSelected =
    selectionEnabled &&
    selectableFileIds.length > 0 &&
    selectedVisibleCount === selectableFileIds.length;
  const someVisibleSelected =
    selectionEnabled &&
    selectedVisibleCount > 0 &&
    selectedVisibleCount < selectableFileIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    const root = scrollElementRef?.current ?? null;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !onLoadMoreFiles || !hasMoreFiles || loadingMoreFiles) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreFiles();
        }
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreFiles, loadingMoreFiles, onLoadMoreFiles, files.length, scrollElementRef]);

  function toggleFileSelected(fileId: string, checked: boolean) {
    if (!selectionEnabled) return;
    const next = new Set(selectedFileIds);
    if (checked) {
      next.add(fileId);
    } else {
      next.delete(fileId);
    }
    onSelectedFileIdsChange(next);
  }

  function handleSelectAllVisible(event: ChangeEvent<HTMLInputElement>) {
    if (!selectionEnabled) return;
    const next = new Set(selectedFileIds);
    if (event.target.checked) {
      for (const fileId of selectableFileIds) {
        next.add(fileId);
      }
    } else {
      for (const fileId of selectableFileIds) {
        next.delete(fileId);
      }
    }
    onSelectedFileIdsChange(next);
  }

  if (folders.length === 0 && files.length === 0) {
    return <p className="py-6 text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className="lg:hidden">
      {hasMoreFolders && onLoadMoreFolders ? (
        <div className="mb-2 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMoreFolders}
            onClick={() => onLoadMoreFolders()}
          >
            {loadingMoreFolders ? "Loading folders…" : "Load more folders"}
          </Button>
        </div>
      ) : null}

      {selectionEnabled && selectableFileIds.length > 0 ? (
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="size-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
            checked={allVisibleSelected}
            onChange={handleSelectAllVisible}
          />
          Select all
        </label>
      ) : null}

      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {folders.map((folder) => (
          <li key={folder.id}>
            <div
              className="flex items-center gap-2 px-2 py-1"
              data-folder-id={folder.id}
            >
              <button
                type="button"
                onClick={() => onOpenFolder?.(folder)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left active:bg-neutral-50"
              >
                <Folder className="size-5 shrink-0 text-amber-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-neutral-900">{folder.name}</span>
                    <SharedIndicator flags={folderShareFlags[folder.id]} />
                  </div>
                  <p className="truncate text-xs text-neutral-500">
                    {locationLabel} · Folder · {ownerLabel}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-neutral-400" aria-hidden />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-neutral-500"
                aria-label={`Actions for ${folder.name}`}
                onClick={() => onOpenActions({ kind: "folder", folder })}
              >
                <MoreVertical className="size-4" />
              </Button>
            </div>
          </li>
        ))}

        {files.map((file) => {
          const isSelected = selectionEnabled && selectedFileIds.has(file.id);
          const isVideo = file.mime_type?.startsWith("video/") ?? false;
          const isImage = isImageMime(file.mime_type);
          const processing = isFileProcessing(file);
          const canPreviewVideo = isVideo && onPreviewVideo !== undefined && !processing;
          const canPreviewImage = isImage && onPreviewImage !== undefined && !processing;
          const canPreview = canPreviewVideo || canPreviewImage;

          return (
            <li key={file.id}>
              <div
                className={cn(
                  "flex items-center gap-2 px-2 py-1",
                  processing && "bg-violet-50/40",
                  isSelected && "bg-blue-50/60",
                )}
                data-file-id={file.id}
              >
                {selectionEnabled ? (
                  <input
                    type="checkbox"
                    className="ml-1 size-4 shrink-0 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                    checked={isSelected}
                    disabled={processing}
                    onChange={(event) => toggleFileSelected(file.id, event.target.checked)}
                    aria-label={`Select ${file.name}`}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={!canPreview && false}
                  onClick={() => {
                    if (canPreviewVideo) onPreviewVideo!(file);
                    else if (canPreviewImage) onPreviewImage!(file);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left active:bg-neutral-50",
                    !canPreview && "cursor-default",
                  )}
                >
                  <FileTypeIcon mimeType={file.mime_type} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-neutral-900">{file.name}</span>
                      <SharedIndicator flags={fileShareFlags[file.id]} />
                      {processing ? (
                        <FileProcessingBadge
                          file={file}
                          className="shrink-0 bg-violet-100 text-violet-900"
                        />
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {formatBytes(file.size_bytes)} · {formatFileOpened(file.updated_at)}
                    </p>
                  </div>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-neutral-500"
                  aria-label={`Actions for ${file.name}`}
                  onClick={() => onOpenActions({ kind: "file", file })}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div ref={loadMoreSentinelRef} className="h-1" aria-hidden />
      {loadingMoreFiles ? (
        <p className="py-3 text-center text-xs text-neutral-500">Loading more files…</p>
      ) : null}
      {hasMoreFiles && !loadingMoreFiles ? (
        <div className="flex justify-center py-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onLoadMoreFiles?.()}>
            Load more files
          </Button>
        </div>
      ) : null}
    </div>
  );
}
