// Human: My Cloud file explorer — breadcrumbs, search/action bar, folder + file grids per Pencil wireframe.
// Agent: TAILWIND-only layout; SUPPORTS folder navigation, search, type filters, drag-drop, selection, previews.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type RefObject,
} from "react";
import {
  Check,
  ChevronRight,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderPlus,
  ImageIcon,
  Music,
  Presentation,
  Search,
  SlidersHorizontal,
  MoreVertical,
  Upload,
} from "lucide-react";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import { ExplorerImageThumbnail } from "@/components/drive/ExplorerImageThumbnail";
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
  type FileTypeFilter,
} from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Human: MIME payload for HTML5 drag — must match DrivePage FileTable for drop handlers.
// Agent: SET on dragstart; READ on folder drop.
const FILE_DRAG_MIME = "application/x-mediavault-file-id";

export type ExplorerFolderCrumb = { id: string; name: string };

type TypeFilterOption = { id: FileTypeFilter; label: string };

type DriveCloudExplorerProps = {
  folderStack: ExplorerFolderCrumb[];
  folders: FolderItem[];
  files: FileItem[];
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: FileTypeFilter;
  onTypeFilterChange: (filter: FileTypeFilter) => void;
  typeFilterOptions: TypeFilterOption[];
  /** Human: True while filtering by name across the library — hides the Folders section. */
  isSearching?: boolean;
  dragEnabled?: boolean;
  selectable?: boolean;
  selectedFileIds?: Set<string>;
  onSelectedFileIdsChange?: (ids: Set<string>) => void;
  fileShareFlags?: Record<string, ShareFlags>;
  folderShareFlags?: Record<string, ShareFlags>;
  hasMoreFiles?: boolean;
  loadingMoreFiles?: boolean;
  onLoadMoreFiles?: () => void;
  hasMoreFolders?: boolean;
  loadingMoreFolders?: boolean;
  onLoadMoreFolders?: () => void;
  scrollElementRef?: RefObject<HTMLElement | null>;
  onNavigateHome: () => void;
  onNavigateMyCloudRoot: () => void;
  onGoToFolderIndex: (index: number) => void;
  onOpenFolder: (folder: FolderItem) => void;
  onCreateFolder: () => void;
  onUpload: () => void;
  onMoveFileToFolder?: (fileId: string, folderId: string) => void | Promise<void>;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  /** Human: Opens the mobile action sheet when the row ⋯ control is used. */
  onOpenActions?: (target: MobileActionTarget) => void;
};

// Human: Large centered icon for explorer file tiles (32px per wireframe).
// Agent: READS mime_type; RETURNS lucide icon in brand blue.
function ExplorerFileIcon({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = "size-8 text-[#2563EB]";
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

// Human: Wireframe breadcrumb trail — Home › My Cloud › folder path.
// Agent: CALLS parent navigation handlers; BOLDS the current leaf crumb.
function ExplorerBreadcrumbs({
  folderStack,
  onNavigateHome,
  onNavigateMyCloudRoot,
  onGoToFolderIndex,
}: {
  folderStack: ExplorerFolderCrumb[];
  onNavigateHome: () => void;
  onNavigateMyCloudRoot: () => void;
  onGoToFolderIndex: (index: number) => void;
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-2 text-sm"
      aria-label="Folder path"
    >
      <button
        type="button"
        onClick={onNavigateHome}
        className="text-[#888888] transition-colors hover:text-[#2563EB]"
      >
        Home
      </button>
      <ChevronRight className="size-3.5 text-[#888888]" aria-hidden />
      <button
        type="button"
        onClick={onNavigateMyCloudRoot}
        className={cn(
          "transition-colors hover:text-[#2563EB]",
          folderStack.length === 0
            ? "font-bold text-[#1A1A1A]"
            : "text-[#888888]",
        )}
      >
        My Cloud
      </button>
      {folderStack.map((crumb, index) => (
        <span key={crumb.id} className="flex items-center gap-2">
          <ChevronRight className="size-3.5 text-[#888888]" aria-hidden />
          <button
            type="button"
            onClick={() => onGoToFolderIndex(index)}
            className={cn(
              "transition-colors hover:text-[#2563EB]",
              index === folderStack.length - 1
                ? "font-bold text-[#1A1A1A]"
                : "text-[#888888]",
            )}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** Human: My Cloud browser surface matching Ownly File Explorer Pencil frame. */
export function DriveCloudExplorer({
  folderStack,
  folders,
  files,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  typeFilterOptions,
  isSearching = false,
  dragEnabled = false,
  selectable = false,
  selectedFileIds,
  onSelectedFileIdsChange,
  fileShareFlags = {},
  folderShareFlags = {},
  hasMoreFiles = false,
  loadingMoreFiles = false,
  onLoadMoreFiles,
  hasMoreFolders = false,
  loadingMoreFolders = false,
  onLoadMoreFolders,
  scrollElementRef,
  onNavigateHome,
  onNavigateMyCloudRoot,
  onGoToFolderIndex,
  onOpenFolder,
  onCreateFolder,
  onUpload,
  onMoveFileToFolder,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewAudio,
  onOpenActions,
}: DriveCloudExplorerProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const dragDepthRef = useRef<Map<string, number>>(new Map());
  const draggingFileIdRef = useRef<string | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const selectionEnabled =
    selectable && selectedFileIds !== undefined && onSelectedFileIdsChange !== undefined;
  // Human: When any file is selected, keep checkmarks visible on all tiles for easier multi-select.
  // Agent: READS selectedFileIds.size; USED by explorer file card checkbox opacity classes.
  const hasActiveSelection =
    selectionEnabled && selectedFileIds !== undefined && selectedFileIds.size > 0;
  const activeFilterLabel =
    typeFilterOptions.find((option) => option.id === typeFilter)?.label ?? "All";

  // Human: Close the filter popover when clicking outside the filter control cluster.
  // Agent: LISTENS mousedown on document; WRITES filterOpen false when outside filterRef.
  useEffect(() => {
    if (!filterOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      if (filterRef.current?.contains(event.target)) return;
      setFilterOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [filterOpen]);

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

  const resetDragState = useCallback(() => {
    draggingFileIdRef.current = null;
    setDraggingFileId(null);
    setDropTargetFolderId(null);
    dragDepthRef.current.clear();
  }, []);

  function toggleFileSelected(fileId: string, checked: boolean) {
    if (!selectionEnabled) return;
    const next = new Set(selectedFileIds);
    if (checked) next.add(fileId);
    else next.delete(fileId);
    onSelectedFileIdsChange(next);
  }

  function handleFileDragStart(event: DragEvent<HTMLButtonElement>, fileId: string) {
    if (!dragEnabled) {
      event.preventDefault();
      return;
    }
    const file = fileById.get(fileId);
    if (file && isFileProcessing(file)) {
      event.preventDefault();
      return;
    }
    draggingFileIdRef.current = fileId;
    setDraggingFileId(fileId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FILE_DRAG_MIME, fileId);
    event.dataTransfer.setData("text/plain", fileId);
  }

  function readDraggedFileId(event: DragEvent): string | null {
    const custom = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (custom) return custom;
    const plain = event.dataTransfer.getData("text/plain");
    return plain || draggingFileIdRef.current || draggingFileId;
  }

  function handleFolderDragEnter(
    event: DragEvent<HTMLButtonElement>,
    folderId: string,
    fileId: string | null,
  ) {
    if (!dragEnabled || !fileId) return;
    event.preventDefault();
    const depth = (dragDepthRef.current.get(folderId) ?? 0) + 1;
    dragDepthRef.current.set(folderId, depth);
    setDropTargetFolderId(folderId);
  }

  function handleFolderDragLeave(folderId: string) {
    const depth = (dragDepthRef.current.get(folderId) ?? 0) - 1;
    if (depth <= 0) {
      dragDepthRef.current.delete(folderId);
      setDropTargetFolderId((current) => (current === folderId ? null : current));
      return;
    }
    dragDepthRef.current.set(folderId, depth);
  }

  function handleFolderDrop(event: DragEvent<HTMLButtonElement>, folderId: string) {
    if (!dragEnabled || !onMoveFileToFolder) return;
    event.preventDefault();
    const fileId = readDraggedFileId(event);
    resetDragState();
    if (!fileId) return;
    const file = fileById.get(fileId);
    if (!file || file.folder_id === folderId) return;
    void onMoveFileToFolder(fileId, folderId);
  }

  return (
    <div className="flex flex-col gap-6">
      <ExplorerBreadcrumbs
        folderStack={folderStack}
        onNavigateHome={onNavigateHome}
        onNavigateMyCloudRoot={onNavigateMyCloudRoot}
        onGoToFolderIndex={onGoToFolderIndex}
      />

      {/* Action bar — search + filter + folder/upload actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex w-full max-w-[320px] items-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5">
          <Search className="size-4 shrink-0 text-[#888888]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search files..."
            aria-label="Search files"
            className="min-w-0 flex-1 bg-transparent text-sm text-[#1A1A1A] placeholder:text-[#888888] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div ref={filterRef} className="relative">
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-auto gap-2 rounded-lg border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F7F8FA]",
                filterOpen && "ring-2 ring-[#2563EB]/30",
              )}
              onClick={() => setFilterOpen((open) => !open)}
              aria-expanded={filterOpen}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filter
              {typeFilter !== "all" ? (
                <span className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-xs font-semibold text-[#2563EB]">
                  {activeFilterLabel}
                </span>
              ) : null}
            </Button>
            {filterOpen ? (
              <div className="absolute right-0 top-full z-20 mt-2 min-w-[12rem] rounded-lg border border-[#E5E7EB] bg-white p-2 shadow-lg">
                {typeFilterOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onTypeFilterChange(option.id);
                      setFilterOpen(false);
                    }}
                    className={cn(
                      "flex w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                      typeFilter === option.id
                        ? "bg-[#F7F8FA] font-semibold text-[#2563EB]"
                        : "text-[#666666] hover:bg-[#F7F8FA]",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

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

      {/* Human: Single grid — folders first, then files (matches Pencil explorer, one list). */}
      {/* Agent: RENDERS folders when not searching; FILES follow in same grid; EMPTY when both absent. */}
      <section className="flex flex-col gap-5">
        <h2 className="text-base font-bold text-[#1A1A1A]">All Files</h2>
        {!isSearching && folders.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileIcon className="size-9 text-[#888888]" aria-hidden />
            <p className="font-semibold text-[#1A1A1A]">Nothing here yet</p>
            <p className="max-w-sm text-sm text-[#666666]">
              Create a folder, upload a file, or change your search and filters.
            </p>
          </div>
        ) : isSearching && files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileIcon className="size-9 text-[#888888]" aria-hidden />
            <p className="font-semibold text-[#1A1A1A]">No matching files</p>
            <p className="max-w-sm text-sm text-[#666666]">
              Try a different search term or clear filters.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
            {!isSearching
              ? folders.map((folder) => (
                  <button
                    key={`folder-${folder.id}`}
                    type="button"
                    data-folder-id={folder.id}
                    onClick={() => onOpenFolder(folder)}
                    onDragEnter={(event) =>
                      handleFolderDragEnter(event, folder.id, draggingFileIdRef.current)
                    }
                    onDragOver={(event) => {
                      if (!dragEnabled || !draggingFileIdRef.current) return;
                      event.preventDefault();
                    }}
                    onDragLeave={() => handleFolderDragLeave(folder.id)}
                    onDrop={(event) => handleFolderDrop(event, folder.id)}
                    className={cn(
                      "flex min-h-[108px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-3.5 text-center transition-[border-color,box-shadow,background-color] hover:border-blue-200 hover:shadow-sm",
                      dropTargetFolderId === folder.id &&
                        "border-blue-400 bg-blue-50/90 shadow-md shadow-blue-500/10",
                    )}
                  >
                    <Folder className="size-8 text-[#2563EB]" aria-hidden />
                    <span className="line-clamp-2 w-full text-[13px] font-semibold leading-tight text-[#1A1A1A]">
                      {folder.name}
                    </span>
                    <span className="text-[11px] text-[#888888]">Folder</span>
                    <SharedIndicator flags={folderShareFlags[folder.id]} className="size-3" />
                  </button>
                ))
              : null}
            {files.map((file) => {
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
              const isSelected = selectionEnabled && selectedFileIds.has(file.id);
              const showImagePreview = isImage && !processing;

              return (
                <div
                  key={file.id}
                  data-file-id={file.id}
                  className={cn(
                    "group relative rounded-xl border bg-white transition-[border-color,box-shadow,background-color]",
                    isSelected
                      ? "border-blue-500 bg-blue-50/90 shadow-md shadow-blue-500/10"
                      : "border-[#E5E7EB] hover:border-blue-200 hover:shadow-sm",
                    processing && "opacity-80",
                    draggingFileId === file.id && "opacity-50",
                  )}
                >
                  {selectionEnabled ? (
                    <label
                      className={cn(
                        "absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md transition-opacity",
                        isSelected || hasActiveSelection
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={processing}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          toggleFileSelected(file.id, event.target.checked)
                        }
                        className="peer sr-only"
                        aria-label={`Select ${file.name}`}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-md border transition-colors",
                          "peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-1",
                          isSelected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-[#D1D5DB] bg-white text-transparent shadow-sm",
                        )}
                        aria-hidden
                      >
                        <Check className="size-3.5 stroke-[2.5]" />
                      </span>
                    </label>
                  ) : null}
                  {onOpenActions ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={cn(
                        "absolute left-1.5 top-1.5 z-10 size-7 text-[#888888] lg:hidden",
                        isSelected && "bg-white/80",
                      )}
                      aria-label={`Actions for ${file.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenActions({ kind: "file", file });
                      }}
                    >
                      <MoreVertical className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    draggable={dragEnabled && !processing}
                    onDragStart={(event) => handleFileDragStart(event, file.id)}
                    onDragEnd={resetDragState}
                    onClick={() => {
                      if (!canPreview) return;
                      if (canPreviewVideo) onPreviewVideo!(file);
                      else if (canPreviewImage) onPreviewImage!(file);
                      else if (canPreviewPdf) onPreviewPdf!(file);
                      else if (canPreviewText) onPreviewText!(file);
                      else if (canPreviewAudio) onPreviewAudio!(file);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1.5 rounded-[11px] text-center transition-colors",
                      showImagePreview
                        ? "min-h-[148px] items-stretch p-2"
                        : "min-h-[108px] items-center justify-center px-2.5 py-3.5",
                      canPreview && !isSelected && "hover:bg-[#F7F8FA]",
                      canPreview && isSelected && "hover:bg-blue-100/50",
                    )}
                  >
                    {showImagePreview ? (
                      <ExplorerImageThumbnail file={file} />
                    ) : (
                      <ExplorerFileIcon mimeType={file.mime_type} />
                    )}
                    <span
                      className={cn(
                        "line-clamp-2 w-full text-[13px] font-semibold leading-snug",
                        isSelected ? "text-blue-950" : "text-[#1A1A1A]",
                      )}
                    >
                      {file.name}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        isSelected ? "text-blue-700/80" : "text-[#888888]",
                      )}
                    >
                      {formatBytes(file.size_bytes)} · {formatFileOpened(file.updated_at)}
                    </span>
                    {processing ? (
                      <div className="mt-1 flex w-full max-w-full justify-center overflow-hidden px-0.5">
                        <FileProcessingBadge
                          file={file}
                          compact
                          className="bg-violet-100 text-violet-900"
                        />
                      </div>
                    ) : null}
                    <SharedIndicator flags={fileShareFlags[file.id]} className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div ref={loadMoreSentinelRef} className="h-1 w-full" aria-hidden />
        {!isSearching && hasMoreFolders && loadingMoreFolders ? (
          <p className="text-center text-xs text-[#666666]">Loading more folders…</p>
        ) : null}
        {!isSearching && hasMoreFolders && onLoadMoreFolders ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-[#2563EB]"
              onClick={() => void onLoadMoreFolders()}
              disabled={loadingMoreFolders}
            >
              Load more folders
            </Button>
          </div>
        ) : null}
        {hasMoreFiles && loadingMoreFiles ? (
          <p className="text-center text-xs text-[#666666]">Loading more files…</p>
        ) : null}
      </section>
    </div>
  );
}
