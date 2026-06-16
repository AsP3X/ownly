// Human: My Cloud file explorer — breadcrumbs, search/action bar, folder + file grids per Pencil wireframe.
// Agent: TAILWIND-only layout; SUPPORTS folder navigation, search, type filters, HTML5 + touch drag-drop, selection, previews.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type RefObject,
} from "react";
import {
  ChevronRight,
  FileIcon,
  Folder,
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
import { EXPLORER_GRID_LAYOUT_CLASS } from "@/components/drive/ExplorerGridPreviewSlot";
import { useExplorerTouchDrag } from "@/components/drive/useExplorerTouchDrag";
import {
  FILE_DRAG_MIME,
  FOLDER_DRAG_MIME,
  parseBreadcrumbDropTarget,
  readExplorerDragPayload,
  type ExplorerDragPayload,
} from "@/lib/explorer-drag";
import { isFileProcessing } from "@/lib/file-processing";
import { type FileTypeFilter } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ExplorerFolderCrumb = { id: string; name: string };

type TypeFilterOption = { id: FileTypeFilter; label: string };

type DriveCloudExplorerProps = {
  folderStack: ExplorerFolderCrumb[];
  folders: FolderItem[];
  files: FileItem[];
  query: string;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  typeFilter: FileTypeFilter;
  onTypeFilterChange: (filter: FileTypeFilter) => void;
  typeFilterOptions: TypeFilterOption[];
  /** Human: True while filtering by name across the library — hides the Folders section. */
  isSearching?: boolean;
  /** Human: True while the explorer listing is being fetched — shows a loading indicator without unmounting search. */
  loading?: boolean;
  dragEnabled?: boolean;
  selectable?: boolean;
  selectedFileIds?: Set<string>;
  onSelectedFileIdsChange?: (
    ids: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  selectedFolderIds?: Set<string>;
  onSelectedFolderIdsChange?: (
    ids: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
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
  onMoveFileToFolder?: (fileId: string, folderId: string | null) => void | Promise<void>;
  onMoveFolderToParent?: (
    folderId: string,
    parentId: string | null,
  ) => void | Promise<void>;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  /** Human: Opens the mobile action sheet when the row ⋯ control is used. */
  onOpenActions?: (target: MobileActionTarget) => void;
  /** Human: Fired while HTML5 or touch drag is moving a file — parent closes the context menu. */
  onExplorerDragActiveChange?: (active: boolean) => void;
  /** Human: Locks the main scroll pane during touch long-press drag so list scroll does not steal the gesture. */
  onExplorerTouchScrollLockChange?: (locked: boolean) => void;
  /** Human: Mobile tap-to-select mode — tile taps toggle selection instead of opening previews. */
  mobileSelectionMode?: boolean;
  /** Human: Authoritative mobile tap toggle — reads/writes the synchronous selection ref in DrivePage. */
  onTapToggleFileSelection?: (fileId: string) => void;
};

/** Human: Collapse deep folder trails on viewports below Tailwind `lg`. */
const MOBILE_BREADCRUMB_COLLAPSE_DEPTH = 2;

// Human: Match Tailwind lg breakpoint for mobile-only breadcrumb behavior.
// Agent: READS matchMedia (max-width: 1023px); SUBSCRIBES to viewport resize.
function useMaxLgViewport(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mediaQuery = window.matchMedia("(max-width: 1023px)");
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(max-width: 1023px)").matches,
    () => false,
  );
}

type ExplorerBreadcrumbCrumbProps = {
  label: string;
  isCurrent: boolean;
  onClick: () => void;
  className?: string;
  /** Human: When set, this crumb accepts drag-drop moves into the encoded parent folder (root = `root`). */
  breadcrumbDropTarget?: string;
  isDropTarget?: boolean;
  dragEnabled?: boolean;
  onBreadcrumbDragEnter?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
  onBreadcrumbDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onBreadcrumbDragLeave?: (dropTarget: string) => void;
  onBreadcrumbDrop?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
};

// Human: One tappable breadcrumb segment with mobile truncation for long folder names.
// Agent: RENDERS button; TRUNCATES label below lg; SETS title tooltip to full name; OPTIONAL drop target.
function ExplorerBreadcrumbCrumb({
  label,
  isCurrent,
  onClick,
  className,
  breadcrumbDropTarget,
  isDropTarget = false,
  dragEnabled = false,
  onBreadcrumbDragEnter,
  onBreadcrumbDragOver,
  onBreadcrumbDragLeave,
  onBreadcrumbDrop,
}: ExplorerBreadcrumbCrumbProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      data-breadcrumb-drop={breadcrumbDropTarget}
      onDragEnter={
        dragEnabled && breadcrumbDropTarget !== undefined
          ? (event) => onBreadcrumbDragEnter?.(event, breadcrumbDropTarget)
          : undefined
      }
      onDragOver={dragEnabled ? onBreadcrumbDragOver : undefined}
      onDragLeave={
        dragEnabled && breadcrumbDropTarget !== undefined
          ? () => onBreadcrumbDragLeave?.(breadcrumbDropTarget)
          : undefined
      }
      onDrop={
        dragEnabled && breadcrumbDropTarget !== undefined
          ? (event) => onBreadcrumbDrop?.(event, breadcrumbDropTarget)
          : undefined
      }
      className={cn(
        "shrink-0 transition-colors hover:text-[#2563EB] max-lg:max-w-[9.5rem] max-lg:truncate",
        isCurrent ? "font-bold text-[#1A1A1A]" : "text-[#888888]",
        isDropTarget && "rounded-md bg-blue-50 px-1 text-[#2563EB] ring-2 ring-blue-300",
        className,
      )}
    >
      {label}
    </button>
  );
}

// Human: Wireframe breadcrumb trail — Home › My Cloud › folder path; crumbs accept drag-drop moves.
// Agent: CALLS parent navigation handlers; SCROLLS horizontally on mobile; COLLAPSES deep paths.
function ExplorerBreadcrumbs({
  folderStack,
  onNavigateHome,
  onNavigateMyCloudRoot,
  onGoToFolderIndex,
  dragEnabled = false,
  dropTargetBreadcrumb,
  onBreadcrumbDragEnter,
  onBreadcrumbDragOver,
  onBreadcrumbDragLeave,
  onBreadcrumbDrop,
}: {
  folderStack: ExplorerFolderCrumb[];
  onNavigateHome: () => void;
  onNavigateMyCloudRoot: () => void;
  onGoToFolderIndex: (index: number) => void;
  dragEnabled?: boolean;
  dropTargetBreadcrumb?: string | null;
  onBreadcrumbDragEnter?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
  onBreadcrumbDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onBreadcrumbDragLeave?: (dropTarget: string) => void;
  onBreadcrumbDrop?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
}) {
  const isMobile = useMaxLgViewport();

  const shouldCollapse =
    isMobile && folderStack.length > MOBILE_BREADCRUMB_COLLAPSE_DEPTH;

  const visibleFolderCrumbs = useMemo(() => {
    if (!shouldCollapse) {
      return folderStack.map((crumb, index) => ({ crumb, index }));
    }
    return folderStack.slice(-2).map((crumb, offset) => ({
      crumb,
      index: folderStack.length - 2 + offset,
    }));
  }, [folderStack, shouldCollapse]);

  const collapsedJumpIndex = shouldCollapse ? folderStack.length - 3 : -1;
  const collapsedJumpLabel =
    collapsedJumpIndex >= 0 ? folderStack[collapsedJumpIndex]?.name : null;

  return (
    <nav
      className={cn(
        "flex items-center gap-1.5 text-xs lg:flex-wrap lg:gap-2 lg:text-sm",
        "max-lg:-mx-1 max-lg:overflow-x-auto max-lg:pb-0.5",
        "max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden",
      )}
      aria-label="Folder path"
    >
      <ExplorerBreadcrumbCrumb
        label="Home"
        isCurrent={false}
        onClick={onNavigateHome}
      />
      <ChevronRight className="size-3 shrink-0 text-[#888888] lg:size-3.5" aria-hidden />
      <ExplorerBreadcrumbCrumb
        label="My Cloud"
        isCurrent={folderStack.length === 0}
        onClick={onNavigateMyCloudRoot}
        breadcrumbDropTarget="root"
        isDropTarget={dropTargetBreadcrumb === "root"}
        dragEnabled={dragEnabled}
        onBreadcrumbDragEnter={onBreadcrumbDragEnter}
        onBreadcrumbDragOver={onBreadcrumbDragOver}
        onBreadcrumbDragLeave={onBreadcrumbDragLeave}
        onBreadcrumbDrop={onBreadcrumbDrop}
      />
      {shouldCollapse ? (
        <>
          <ChevronRight className="size-3 shrink-0 text-[#888888] lg:size-3.5" aria-hidden />
          <button
            type="button"
            onClick={() => onGoToFolderIndex(collapsedJumpIndex)}
            title={collapsedJumpLabel ?? "Show earlier folders"}
            aria-label={
              collapsedJumpLabel
                ? `Go to ${collapsedJumpLabel}`
                : "Show earlier folders"
            }
            className="shrink-0 px-0.5 text-[#888888] transition-colors hover:text-[#2563EB]"
          >
            …
          </button>
        </>
      ) : null}
      {visibleFolderCrumbs.map(({ crumb, index }) => (
        <span key={crumb.id} className="flex shrink-0 items-center gap-1.5 lg:gap-2">
          <ChevronRight className="size-3 shrink-0 text-[#888888] lg:size-3.5" aria-hidden />
          <ExplorerBreadcrumbCrumb
            label={crumb.name}
            isCurrent={index === folderStack.length - 1}
            onClick={() => onGoToFolderIndex(index)}
            breadcrumbDropTarget={crumb.id}
            isDropTarget={dropTargetBreadcrumb === crumb.id}
            dragEnabled={dragEnabled}
            onBreadcrumbDragEnter={onBreadcrumbDragEnter}
            onBreadcrumbDragOver={onBreadcrumbDragOver}
            onBreadcrumbDragLeave={onBreadcrumbDragLeave}
            onBreadcrumbDrop={onBreadcrumbDrop}
          />
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
  onQuerySubmit,
  typeFilter,
  onTypeFilterChange,
  typeFilterOptions,
  isSearching = false,
  loading = false,
  dragEnabled = false,
  selectable = false,
  selectedFileIds,
  onSelectedFileIdsChange,
  selectedFolderIds,
  onSelectedFolderIdsChange,
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
  onMoveFolderToParent,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onOpenActions,
  onExplorerDragActiveChange,
  onExplorerTouchScrollLockChange,
  mobileSelectionMode = false,
  onTapToggleFileSelection,
}: DriveCloudExplorerProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ExplorerDragPayload | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [dropTargetBreadcrumb, setDropTargetBreadcrumb] = useState<string | null | undefined>(
    undefined,
  );
  const dragDepthRef = useRef<Map<string, number>>(new Map());
  const breadcrumbDragDepthRef = useRef<Map<string, number>>(new Map());
  const activeDragRef = useRef<ExplorerDragPayload | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fallbackScrollRef = useRef<HTMLElement | null>(null);
  const explorerScrollRef = scrollElementRef ?? fallbackScrollRef;

  // Human: Search input submits on Enter and stays focused so the user can keep editing.
  // Agent: READS keydown on search input; CALLS onQuerySubmit; REFOCUSES + RESTORES cursor at end.
  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onQuerySubmit();
    const input = searchInputRef.current;
    if (!input) return;
    // Human: Delay refocus until after parent state flush/re-render so React does not steal focus.
    window.setTimeout(() => {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 0);
  }

  // Human: Global Cmd/Ctrl+K focuses the drive search bar, matching common cloud-drive UX.
  // Agent: LISTENS document keydown; SKIPS when inside another input/textarea/dialog.
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      const isInsideDialog = target?.closest("[role='dialog'], dialog") !== null;
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (!isShortcut || isEditableTarget || isInsideDialog) return;

      event.preventDefault();
      searchInputRef.current?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  const resolveFileFolderId = useCallback(
    (fileId: string) => fileById.get(fileId)?.folder_id,
    [fileById],
  );

  const resolveFolderParentId = useCallback(
    (folderId: string) => folderById.get(folderId)?.parent_id,
    [folderById],
  );

  const {
    touchDragEnabled,
    draggingItemId: touchDraggingItemId,
    draggingItemKind: touchDraggingItemKind,
    armedItemId,
    armedItemKind,
    dropTargetFolderId: touchDropTargetFolderId,
    ghostLabel,
    ghostPosition,
    ghostKind,
    getFileDragBindings,
    getFolderDragBindings,
  } = useExplorerTouchDrag({
    // Human: Disable touch-drag while selecting so pointerdown does not lock list scroll.
    // Agent: READS mobileSelectionMode; SKIPS scroll lock + long-press handlers during tap-select.
    enabled: dragEnabled && !mobileSelectionMode,
    scrollElementRef: explorerScrollRef,
    onMoveFileToFolder,
    onMoveFolderToParent,
    resolveFileFolderId,
    resolveFolderParentId,
    onDragSessionActiveChange: onExplorerDragActiveChange,
    onTouchScrollLockChange: onExplorerTouchScrollLockChange,
  });

  const activeDraggingFileId =
    activeDrag?.kind === "file"
      ? activeDrag.id
      : touchDraggingItemKind === "file"
        ? touchDraggingItemId
        : null;
  const activeDraggingFolderId =
    activeDrag?.kind === "folder"
      ? activeDrag.id
      : touchDraggingItemKind === "folder"
        ? touchDraggingItemId
        : null;
  const activeDropTargetFolderId = dropTargetFolderId ?? touchDropTargetFolderId;
  const selectionEnabled =
    selectable &&
    selectedFileIds !== undefined &&
    onSelectedFileIdsChange !== undefined &&
    selectedFolderIds !== undefined &&
    onSelectedFolderIdsChange !== undefined;
  // Human: When any file or folder is selected, keep checkmarks visible on all tiles for easier multi-select.
  // Agent: READS selectedFileIds.size + selectedFolderIds.size; USED by explorer checkbox opacity classes.
  const hasActiveSelection =
    selectionEnabled &&
    ((selectedFileIds?.size ?? 0) > 0 || (selectedFolderIds?.size ?? 0) > 0);
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
      { root, rootMargin: "480px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreFiles, loadingMoreFiles, onLoadMoreFiles, files.length, scrollElementRef]);

  const resetDragState = useCallback(() => {
    activeDragRef.current = null;
    setActiveDrag(null);
    setDropTargetFolderId(null);
    setDropTargetBreadcrumb(undefined);
    dragDepthRef.current.clear();
    breadcrumbDragDepthRef.current.clear();
    onExplorerDragActiveChange?.(false);
  }, [onExplorerDragActiveChange]);

  // Human: Decide whether dropping onto a folder parent is a no-op for the dragged item.
  // Agent: READS file.folder_id or folder.parent_id; BLOCKS self-drop for folders.
  const isValidDropOntoFolder = useCallback(
    (payload: ExplorerDragPayload, targetFolderId: string) => {
      if (payload.kind === "folder" && payload.id === targetFolderId) {
        return false;
      }
      if (payload.kind === "file") {
        const file = fileById.get(payload.id);
        return file !== undefined && (file.folder_id ?? null) !== targetFolderId;
      }
      const folder = folderById.get(payload.id);
      return folder !== undefined && (folder.parent_id ?? null) !== targetFolderId;
    },
    [fileById, folderById],
  );

  const isValidDropOntoParent = useCallback(
    (payload: ExplorerDragPayload, parentId: string | null) => {
      if (payload.kind === "file") {
        const file = fileById.get(payload.id);
        return file !== undefined && (file.folder_id ?? null) !== parentId;
      }
      const folder = folderById.get(payload.id);
      if (!folder) return false;
      if (folder.id === parentId) return false;
      return (folder.parent_id ?? null) !== parentId;
    },
    [fileById, folderById],
  );

  const dispatchDrop = useCallback(
    (payload: ExplorerDragPayload, parentId: string | null | undefined) => {
      const targetParentId = parentId ?? null;
      if (payload.kind === "file") {
        void onMoveFileToFolder?.(payload.id, targetParentId);
        return;
      }
      void onMoveFolderToParent?.(payload.id, targetParentId);
    },
    [onMoveFileToFolder, onMoveFolderToParent],
  );

  const toggleFileSelected = useCallback(
    (fileId: string, checked: boolean) => {
      if (!selectionEnabled || !onSelectedFileIdsChange) {
        return;
      }
      // Human: Functional update — rapid mobile taps must not rebuild from a stale Set snapshot.
      // Agent: WRITES via onSelectedFileIdsChange updater; ADDS or REMOVES fileId from latest prev.
      onSelectedFileIdsChange((prev) => {
        const next = new Set(prev);
        if (checked) next.add(fileId);
        else next.delete(fileId);
        return next;
      });
    },
    [onSelectedFileIdsChange, selectionEnabled],
  );

  // Human: Label for the touch drag ghost when multiple files are checked in selection mode.
  // Agent: READS selectedFileIds + mobileSelectionMode; RETURNS count label or undefined for single file.
  const resolveTouchDragGhostLabel = useCallback(
    (fileId: string, fileName: string) => {
      const selectedCount = selectedFileIds?.size ?? 0;
      if (
        mobileSelectionMode &&
        selectedCount > 1 &&
        selectedFileIds?.has(fileId) === true
      ) {
        return `${selectedCount} files`;
      }
      return fileName;
    },
    [mobileSelectionMode, selectedFileIds],
  );

  const toggleFolderSelected = useCallback(
    (folderId: string, checked: boolean) => {
      if (!selectionEnabled || !onSelectedFolderIdsChange) {
        return;
      }
      // Human: Functional update — rapid checkbox clicks must not rebuild from a stale Set snapshot.
      // Agent: WRITES via onSelectedFolderIdsChange updater; ADDS or REMOVES folderId from latest prev.
      onSelectedFolderIdsChange((prev) => {
        const next = new Set(prev);
        if (checked) next.add(folderId);
        else next.delete(folderId);
        return next;
      });
    },
    [onSelectedFolderIdsChange, selectionEnabled],
  );

  const beginHtmlDrag = useCallback(
    (payload: ExplorerDragPayload) => {
      activeDragRef.current = payload;
      setActiveDrag(payload);
      onExplorerDragActiveChange?.(true);
    },
    [onExplorerDragActiveChange],
  );

  function handleFileDragStart(event: DragEvent<HTMLElement>, fileId: string) {
    if (!dragEnabled) {
      event.preventDefault();
      return;
    }
    const file = fileById.get(fileId);
    if (file && isFileProcessing(file)) {
      event.preventDefault();
      return;
    }
    beginHtmlDrag({ kind: "file", id: fileId });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FILE_DRAG_MIME, fileId);
    event.dataTransfer.setData("text/plain", fileId);
  }

  function handleFolderDragStart(event: DragEvent<HTMLElement>, folderId: string) {
    if (!dragEnabled) {
      event.preventDefault();
      return;
    }
    beginHtmlDrag({ kind: "folder", id: folderId });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FOLDER_DRAG_MIME, folderId);
    event.dataTransfer.setData("text/plain", folderId);
  }

  const handleFolderDragEnter = useCallback(
    (event: DragEvent<HTMLElement>, folderId: string) => {
      const payload = activeDragRef.current;
      if (!dragEnabled || !payload || !isValidDropOntoFolder(payload, folderId)) return;
      event.preventDefault();
      const depth = (dragDepthRef.current.get(folderId) ?? 0) + 1;
      dragDepthRef.current.set(folderId, depth);
      setDropTargetFolderId(folderId);
      setDropTargetBreadcrumb(undefined);
    },
    [dragEnabled, isValidDropOntoFolder],
  );

  const handleFolderDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!dragEnabled || !activeDragRef.current) return;
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

  function handleFolderDrop(event: DragEvent<HTMLElement>, folderId: string) {
    if (!dragEnabled || !folderId) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readExplorerDragPayload(event, activeDragRef.current);
    resetDragState();
    if (!payload || !isValidDropOntoFolder(payload, folderId)) return;
    dispatchDrop(payload, folderId);
  }

  const handleBreadcrumbDragEnter = useCallback(
    (event: DragEvent<HTMLButtonElement>, dropTarget: string) => {
      const payload = activeDragRef.current;
      const parentId = parseBreadcrumbDropTarget(dropTarget);
      if (!dragEnabled || !payload || !isValidDropOntoParent(payload, parentId)) return;
      event.preventDefault();
      const depth = (breadcrumbDragDepthRef.current.get(dropTarget) ?? 0) + 1;
      breadcrumbDragDepthRef.current.set(dropTarget, depth);
      setDropTargetBreadcrumb(dropTarget);
      setDropTargetFolderId(null);
    },
    [dragEnabled, isValidDropOntoParent],
  );

  const handleBreadcrumbDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      if (!dragEnabled || !activeDragRef.current) return;
      event.preventDefault();
    },
    [dragEnabled],
  );

  function handleBreadcrumbDragLeave(dropTarget: string) {
    const depth = (breadcrumbDragDepthRef.current.get(dropTarget) ?? 0) - 1;
    if (depth <= 0) {
      breadcrumbDragDepthRef.current.delete(dropTarget);
      setDropTargetBreadcrumb((current) => (current === dropTarget ? undefined : current));
      return;
    }
    breadcrumbDragDepthRef.current.set(dropTarget, depth);
  }

  function handleBreadcrumbDrop(event: DragEvent<HTMLButtonElement>, dropTarget: string) {
    if (!dragEnabled || !activeDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readExplorerDragPayload(event, activeDragRef.current);
    const parentId = parseBreadcrumbDropTarget(dropTarget);
    resetDragState();
    if (!payload || !isValidDropOntoParent(payload, parentId)) return;
    dispatchDrop(payload, parentId);
  }

  return (
    <div className="flex flex-col gap-6">
      <ExplorerBreadcrumbs
        folderStack={folderStack}
        onNavigateHome={onNavigateHome}
        onNavigateMyCloudRoot={onNavigateMyCloudRoot}
        onGoToFolderIndex={onGoToFolderIndex}
        dragEnabled={dragEnabled}
        dropTargetBreadcrumb={dropTargetBreadcrumb}
        onBreadcrumbDragEnter={handleBreadcrumbDragEnter}
        onBreadcrumbDragOver={handleBreadcrumbDragOver}
        onBreadcrumbDragLeave={handleBreadcrumbDragLeave}
        onBreadcrumbDrop={handleBreadcrumbDrop}
      />

      {/* Action bar — search + filter + folder/upload actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex w-full max-w-[320px] items-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5">
          <Search className="size-4 shrink-0 text-[#888888]" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search files... (Ctrl+K)"
            aria-label="Search files. Press Enter to search, Ctrl+K or Command+K to focus."
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
        {loading ? (
          <p className="py-4 text-center text-sm text-[#666666]">Loading files…</p>
        ) : !isSearching && folders.length === 0 && files.length === 0 ? (
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
            <div className={EXPLORER_GRID_LAYOUT_CLASS}>
              {gridEntries.map((entry) =>
                entry.kind === "folder" ? (
                  <ExplorerFolderGridTile
                    key={`folder-${entry.folder.id}`}
                    folder={entry.folder}
                    shareFlags={folderShareFlags[entry.folder.id]}
                    isDropTarget={activeDropTargetFolderId === entry.folder.id}
                    dragEnabled={dragEnabled && !isSearching}
                    selectionEnabled={selectionEnabled}
                    isSelected={
                      selectionEnabled && (selectedFolderIds?.has(entry.folder.id) ?? false)
                    }
                    hasActiveSelection={hasActiveSelection}
                    isDragging={activeDraggingFolderId === entry.folder.id}
                    isArmedForTouchDrag={
                      armedItemKind === "folder" && armedItemId === entry.folder.id
                    }
                    touchDragEnabled={touchDragEnabled && !mobileSelectionMode}
                    getTouchDragBindings={
                      touchDragEnabled && !mobileSelectionMode
                        ? () => getFolderDragBindings(entry.folder.id, entry.folder.name)
                        : undefined
                    }
                    onToggleSelected={toggleFolderSelected}
                    onOpenFolder={onOpenFolder}
                    onDragStart={handleFolderDragStart}
                    onDragEnd={resetDragState}
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
                    mobileSelectionMode={mobileSelectionMode}
                    isDragging={activeDraggingFileId === entry.file.id}
                    isArmedForTouchDrag={
                      armedItemKind === "file" && armedItemId === entry.file.id
                    }
                    dragEnabled={dragEnabled}
                    touchDragEnabled={touchDragEnabled && !mobileSelectionMode}
                    getTouchDragBindings={
                      touchDragEnabled && !mobileSelectionMode
                        ? () =>
                            getFileDragBindings(
                              entry.file.id,
                              resolveTouchDragGhostLabel(entry.file.id, entry.file.name),
                            )
                        : undefined
                    }
                    onToggleSelected={toggleFileSelected}
                    onTapToggleFileSelection={
                      mobileSelectionMode ? onTapToggleFileSelection : undefined
                    }
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
        {ghostPosition && ghostLabel ? (
          <div
            data-explorer-touch-drag-ghost
            className="pointer-events-none fixed z-[80] flex max-w-[min(72vw,16rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl border border-blue-300 bg-white/95 px-3 py-2 text-sm font-semibold text-[#1A1A1A] shadow-lg shadow-blue-500/20"
            style={{ left: ghostPosition.x, top: ghostPosition.y }}
            aria-hidden
          >
            {ghostKind === "folder" ? (
              <Folder className="size-4 shrink-0 text-[#2563EB]" />
            ) : (
              <FileIcon className="size-4 shrink-0 text-[#2563EB]" />
            )}
            <span className="truncate">{ghostLabel}</span>
          </div>
        ) : null}
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
