// Human: Mobile-native list view for the My files browser — grouped folders and files as tappable rows.
// Agent: lg:hidden counterpart to FileTable; SUPPORTS selection, preview tap, and action sheet trigger.

import { useEffect, useMemo, useRef, type ChangeEvent, type ReactNode, type RefObject } from "react";
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
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import { isFileProcessing } from "@/lib/file-processing";
import { formatBytes, formatFileOpened, isAudioMime, isImageMime, isPdfMime } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
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

// Human: Mime icon inside a soft rounded tile for mobile file rows.
// Agent: READS mime_type; RETURNS icon wrapper with type-specific background tint.
function FileTypeTile({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  let icon = <FileIcon className="size-5 text-blue-700" aria-hidden />;
  let tone = "bg-blue-50";

  if (mime.startsWith("image/")) {
    icon = <ImageIcon className="size-5 text-sky-700" aria-hidden />;
    tone = "bg-sky-50";
  } else if (mime.startsWith("video/")) {
    icon = <Film className="size-5 text-violet-700" aria-hidden />;
    tone = "bg-violet-50";
  } else if (mime.startsWith("audio/")) {
    icon = <Music className="size-5 text-emerald-700" aria-hidden />;
    tone = "bg-emerald-50";
  } else if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) {
    icon = <FileSpreadsheet className="size-5 text-green-700" aria-hidden />;
    tone = "bg-green-50";
  } else if (mime.includes("presentation") || mime.includes("powerpoint")) {
    icon = <Presentation className="size-5 text-orange-700" aria-hidden />;
    tone = "bg-orange-50";
  } else if (
    mime.startsWith("text/") ||
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("document")
  ) {
    icon = <FileText className="size-5 text-blue-700" aria-hidden />;
    tone = "bg-blue-50";
  }

  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", tone)}>
      {icon}
    </span>
  );
}

// Human: Section wrapper for grouped mobile list blocks (Folders / Files).
// Agent: RENDERS title + rounded card list container.
function ListSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      <ul className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        {children}
      </ul>
    </section>
  );
}

// Human: Scrollable grouped list replacing the desktop table on viewports below lg.
// Agent: RENDERS folder section then file section; OBSERVES scroll sentinel for infinite load.
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
  onPreviewPdf,
  onPreviewAudio,
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
    return (
      <p className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70 lg:hidden">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:hidden">
      {hasMoreFolders && onLoadMoreFolders ? (
        <div className="flex justify-center">
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
        <label className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-neutral-700 shadow-sm ring-1 ring-neutral-200/70">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="size-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
            checked={allVisibleSelected}
            onChange={handleSelectAllVisible}
          />
          Select all files
        </label>
      ) : null}

      {folders.length > 0 ? (
        <ListSection title="Folders">
          {folders.map((folder, index) => (
            <li
              key={folder.id}
              className={cn(index > 0 && "border-t border-neutral-100")}
              data-folder-id={folder.id}
            >
              <div className="flex items-center gap-1 pr-1">
                <button
                  type="button"
                  onClick={() => onOpenFolder?.(folder)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left active:bg-neutral-50"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50">
                    <Folder className="size-5 text-amber-600" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-neutral-900">{folder.name}</span>
                      <SharedIndicator flags={folderShareFlags[folder.id]} />
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {locationLabel} · {ownerLabel}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-neutral-300" aria-hidden />
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-neutral-400"
                  aria-label={`Actions for ${folder.name}`}
                  onClick={() => onOpenActions({ kind: "folder", folder })}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ListSection>
      ) : null}

      {files.length > 0 ? (
        <ListSection title="Files">
          {files.map((file, index) => {
            const isSelected = selectionEnabled && selectedFileIds.has(file.id);
            const isVideo = file.mime_type?.startsWith("video/") ?? false;
            const isImage = isImageMime(file.mime_type);
            const isPdf = isPdfMime(file.mime_type);
            const isAudio = isAudioMime(file.mime_type);
            const processing = isFileProcessing(file);
            const canPreviewVideo = isVideo && onPreviewVideo !== undefined && !processing;
            const canPreviewImage = isImage && onPreviewImage !== undefined && !processing;
            const canPreviewPdf = isPdf && onPreviewPdf !== undefined && !processing;
            const canPreviewAudio = isAudio && onPreviewAudio !== undefined && !processing;
            const canPreview =
              canPreviewVideo || canPreviewImage || canPreviewPdf || canPreviewAudio;

            return (
              <li
                key={file.id}
                className={cn(
                  index > 0 && "border-t border-neutral-100",
                  isSelected && "bg-blue-50/50",
                  processing && "bg-violet-50/30",
                )}
                data-file-id={file.id}
              >
                <div className="flex items-center gap-1 pr-1">
                  {selectionEnabled ? (
                    <input
                      type="checkbox"
                      className="ml-3 size-4 shrink-0 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      checked={isSelected}
                      disabled={processing}
                      onChange={(event) => toggleFileSelected(file.id, event.target.checked)}
                      aria-label={`Select ${file.name}`}
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (canPreviewVideo) onPreviewVideo!(file);
                      else if (canPreviewImage) onPreviewImage!(file);
                      else if (canPreviewPdf) onPreviewPdf!(file);
                      else if (canPreviewAudio) onPreviewAudio!(file);
                    }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left active:bg-neutral-50",
                      !canPreview && "cursor-default",
                    )}
                  >
                    <FileTypeTile mimeType={file.mime_type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-neutral-900">{file.name}</span>
                        <SharedIndicator flags={fileShareFlags[file.id]} />
                      </div>
                      <p className="truncate text-xs text-neutral-500">
                        {formatBytes(file.size_bytes)} · {formatFileOpened(file.updated_at)}
                      </p>
                      {processing ? (
                        <div className="mt-1.5">
                          <FileProcessingBadge file={file} className="bg-violet-100 text-violet-900" />
                        </div>
                      ) : null}
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-neutral-400"
                    aria-label={`Actions for ${file.name}`}
                    onClick={() => onOpenActions({ kind: "file", file })}
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ListSection>
      ) : null}

      <div ref={loadMoreSentinelRef} className="h-1" aria-hidden />
      {loadingMoreFiles ? (
        <p className="py-2 text-center text-xs text-neutral-500">Loading more files…</p>
      ) : null}
      {hasMoreFiles && !loadingMoreFiles ? (
        <div className="flex justify-center py-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onLoadMoreFiles?.()}>
            Load more files
          </Button>
        </div>
      ) : null}
    </div>
  );
}
