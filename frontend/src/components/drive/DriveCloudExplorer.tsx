// Human: My Cloud file explorer — breadcrumbs, search/action bar, folder + file grids per Pencil wireframe.
// Agent: TAILWIND-only layout; SUPPORTS folder navigation, search, type filters, drag-drop, selection, previews.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import {
  ChevronRight,
  FileIcon,
  FolderPlus,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import {
  ExplorerFileGridTile,
  ExplorerFolderGridTile,
  type ExplorerGridEntry,
} from "@/components/drive/ExplorerGridTiles";
import { ExplorerScrollProvider } from "@/components/drive/ExplorerScrollProvider";
import { isFileProcessing } from "@/lib/file-processing";
import { type FileTypeFilter } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Human: MIME payload for HTML5 drag — must match DrivePage FileTable for drop handlers.
// Agent: SET on dragstart; READ on folder drop.
const FILE_DRAG_MIME = "application/x-ownly-file-id";

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
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  /** Human: Opens the mobile action sheet when the row ⋯ control is used. */
  onOpenActions?: (target: MobileActionTarget) => void;
};

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
  onPreviewSpreadsheet,
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
  const fallbackScrollRef = useRef<HTMLElement | null>(null);
  const explorerScrollRef = scrollElementRef ?? fallbackScrollRef;

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const selectionEnabled =
    selectable && selectedFileIds !== undefined && onSelectedFileIdsChange !== undefined;
  // Human: When any file is selected, keep checkmarks visible on all tiles for easier multi-select.
  // Agent: READS selectedFileIds.size; USED by explorer file card checkbox opacity classes.
  const hasActiveSelection =
    selectionEnabled && selectedFileIds !== undefined && selectedFileIds.size > 0;
  const activeFilterLabel =
    typeFilterOptions.find((option) => option.id === typeFilter)?.label ?? "All";

  // Human: Flatten folders + files into one grid sequence (folders first when browsing).
  // Agent: RENDERED in a static grid; off-screen paint skipped via content-visibility on each tile.
  const gridEntries = useMemo(() => {
    const entries: ExplorerGridEntry[] = [];
    if (!isSearching) {
      for (const folder of folders) {
        entries.push({ kind: "folder", folder });
      }
    }
    for (const file of files) {
      entries.push({ kind: "file", file });
    }
    return entries;
  }, [files, folders, isSearching]);

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

  const toggleFileSelected = useCallback(
    (fileId: string, checked: boolean) => {
      if (!selectionEnabled || selectedFileIds === undefined || !onSelectedFileIdsChange) {
        return;
      }
      const next = new Set(selectedFileIds);
      if (checked) next.add(fileId);
      else next.delete(fileId);
      onSelectedFileIdsChange(next);
    },
    [onSelectedFileIdsChange, selectedFileIds, selectionEnabled],
  );

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

  const handleFolderDragEnter = useCallback(
    (event: DragEvent<HTMLButtonElement>, folderId: string) => {
      const fileId = draggingFileIdRef.current;
      if (!dragEnabled || !fileId) return;
      event.preventDefault();
      const depth = (dragDepthRef.current.get(folderId) ?? 0) + 1;
      dragDepthRef.current.set(folderId, depth);
      setDropTargetFolderId(folderId);
    },
    [dragEnabled],
  );

  const handleFolderDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      if (!dragEnabled || !draggingFileIdRef.current) return;
      event.preventDefault();
    },
    [dragEnabled],
  );

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
          <ExplorerScrollProvider scrollElementRef={explorerScrollRef}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
              {gridEntries.map((entry) =>
                entry.kind === "folder" ? (
                  <ExplorerFolderGridTile
                    key={`folder-${entry.folder.id}`}
                    folder={entry.folder}
                    shareFlags={folderShareFlags[entry.folder.id]}
                    isDropTarget={dropTargetFolderId === entry.folder.id}
                    dragEnabled={dragEnabled && !isSearching}
                    onOpenFolder={onOpenFolder}
                    onDragEnter={handleFolderDragEnter}
                    onDragOver={handleFolderDragOver}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={handleFolderDrop}
                  />
                ) : (
                  <ExplorerFileGridTile
                    key={entry.file.id}
                    file={entry.file}
                    shareFlags={fileShareFlags[entry.file.id]}
                    selectionEnabled={selectionEnabled}
                    isSelected={selectionEnabled && (selectedFileIds?.has(entry.file.id) ?? false)}
                    hasActiveSelection={hasActiveSelection}
                    isDragging={draggingFileId === entry.file.id}
                    dragEnabled={dragEnabled}
                    onToggleSelected={toggleFileSelected}
                    onDragStart={handleFileDragStart}
                    onDragEnd={resetDragState}
                    onPreviewVideo={onPreviewVideo}
                    onPreviewImage={onPreviewImage}
                    onPreviewPdf={onPreviewPdf}
                    onPreviewText={onPreviewText}
                    onPreviewSpreadsheet={onPreviewSpreadsheet}
                    onPreviewAudio={onPreviewAudio}
                    onOpenActions={onOpenActions}
                  />
                ),
              )}
            </div>
          </ExplorerScrollProvider>
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
