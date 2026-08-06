// Human: My Cloud file explorer — toolbar, grid or list of folders and files, and a status strip.
// Agent: OWNS drag-drop + selection state; DELEGATES chrome to ExplorerToolbar/ExplorerStatusBar.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { FileIcon, Folder, FolderPlus, Search, Upload } from "lucide-react";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import {
  ExplorerFileGridTile,
  ExplorerFolderGridTile,
  type ExplorerGridEntry,
} from "@/components/drive/ExplorerGridTiles";
import {
  ExplorerFileListRow,
  ExplorerFolderListRow,
  ExplorerListHeader,
} from "@/components/drive/FileListView";
import { ExplorerScrollProvider } from "@/components/drive/ExplorerScrollProvider";
import { ExplorerFirstRunEmptyState } from "@/components/drive/ExplorerFirstRunEmptyState";
import { ExplorerGridSkeleton } from "@/components/drive/ExplorerGridSkeleton";
import { ExplorerListSkeleton } from "@/components/drive/ExplorerListSkeleton";
import { ExplorerStatusBar } from "@/components/drive/ExplorerStatusBar";
import { ExplorerToolbar } from "@/components/drive/ExplorerToolbar";
import { EXPLORER_GRID_LAYOUT_CLASS } from "@/components/drive/ExplorerGridPreviewSlot";
import { useExplorerKeyboardNav } from "@/components/drive/useExplorerKeyboardNav";
import {
  entryRefFromNode,
  useExplorerMarqueeSelect,
} from "@/components/drive/useExplorerMarqueeSelect";
import { useExplorerTouchDrag } from "@/components/drive/useExplorerTouchDrag";
import {
  entryRefKey,
  sliceEntryRange,
  splitEntryRefs,
  type ExplorerEntryRef,
} from "@/lib/explorer-selection";
import {
  FILE_DRAG_MIME,
  FOLDER_DRAG_MIME,
  parseBreadcrumbDropTarget,
  readExplorerDragPayload,
  type ExplorerDragPayload,
} from "@/lib/explorer-drag";
import { isFileProcessing } from "@/lib/file-processing";
import { type FileTypeFilter } from "@/lib/utils-app";
import {
  type ExplorerFileSort,
  type ExplorerViewMode,
} from "@/lib/drive-preferences";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Human: Re-exported so existing importers (DrivePage) keep their current import path.
// Agent: CANONICAL definition now lives in ExplorerBreadcrumbs.
export type { ExplorerFolderCrumb } from "@/components/drive/ExplorerBreadcrumbs";
import type { ExplorerFolderCrumb } from "@/components/drive/ExplorerBreadcrumbs";

/** Human: Which listing the explorer is showing — drives folder visibility and empty-state copy. */
export type ExplorerListMode = "folder" | "search" | "favourites";

type TypeFilterOption = { id: FileTypeFilter; label: string };

/**
 * Human: The sticky toolbar and status strip must span the full width of the scroll pane,
 * not just the padded content column, or list rows show through beside them while scrolling.
 * Agent: Negative margins cancel DrivePage's scroll-pane padding (px-4 / md:p-6 / lg:px-12),
 *        and the matching padding puts the inner content back where it was.
 */
const EXPLORER_STICKY_BLEED =
  "-mx-4 px-4 md:-mx-6 md:px-6 lg:-mx-12 lg:px-12";

/**
 * Human: The status strip is a rounded pill below lg, so it keeps an 8px gutter instead of
 * bleeding to the screen edges; on lg it is a flush footer and takes the full bleed.
 * Agent: Still wider than the padded content column, so list rows stay covered while scrolling.
 */
const EXPLORER_STATUS_BLEED =
  "-mx-2 px-3 md:-mx-4 md:px-4 lg:-mx-12 lg:px-12";

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
  /** Human: How file rows are ordered in the explorer grid (folders stay A–Z). */
  fileSort: ExplorerFileSort;
  onFileSortChange: (sort: ExplorerFileSort) => void;
  /** Human: Thumbnail grid or detail rows; persisted by DrivePage via drive-preferences. */
  viewMode: ExplorerViewMode;
  onViewModeChange: (mode: ExplorerViewMode) => void;
  /**
   * Human: What the listing represents — a folder's contents, search hits, or starred files.
   * Agent: Anything but "folder" is a flat view: no Folders section, no drop targets, no trail.
   */
  listMode?: ExplorerListMode;
  /** Human: Empty library at the drive root — swaps the empty state for onboarding hints. */
  firstRun?: boolean;
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
  /** Human: Starred file ids for this account — drives the star badge on rows and tiles. */
  favouriteFileIds?: Set<string>;
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
  /** Human: Opens the New document picker from the toolbar. */
  onCreateDocument: () => void;
  onUpload: () => void;
  /** Human: Opens the ⌘K palette from the shortcut chip inside the search field. */
  onOpenCommandPalette: () => void;
  onMoveFileToFolder?: (fileId: string, folderId: string | null) => void | Promise<void>;
  onMoveFolderToParent?: (
    folderId: string,
    parentId: string | null,
  ) => void | Promise<void>;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewEpub?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewRtf?: (file: FileItem) => void;
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

  // Human: Status strip inputs — sourced from the drive shell's dashboard + listing totals.
  // Agent: PASSED THROUGH to ExplorerStatusBar; no fetching happens in this component.
  instanceName: string;
  usedBytes: number;
  quotaBytes: number;
  totalFolderCount: number;
  totalFileCount: number;
  selectedCount: number;
  /** Human: Select-all handler for the desktop list header checkbox. */
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  allSelected?: boolean;
  /** Human: Delete key targets — routed to the same confirm dialogs the context menu uses. */
  onDeleteFile?: (fileId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  /** Human: BulkActionsBar from DrivePage — stacked inside the sticky toolbar block. */
  bulkActionsSlot?: ReactNode;
  /**
   * Human: Topbar node that hosts the folder trail on desktop.
   * Agent: PASSED THROUGH to ExplorerToolbar; breadcrumb drag state stays in this component.
   */
  breadcrumbPortalTarget?: HTMLElement | null;
};

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
  fileSort,
  onFileSortChange,
  viewMode,
  onViewModeChange,
  listMode = "folder",
  firstRun = false,
  loading = false,
  dragEnabled = false,
  selectable = false,
  selectedFileIds,
  onSelectedFileIdsChange,
  selectedFolderIds,
  onSelectedFolderIdsChange,
  fileShareFlags = {},
  folderShareFlags = {},
  favouriteFileIds,
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
  onCreateDocument,
  onUpload,
  onOpenCommandPalette,
  onMoveFileToFolder,
  onMoveFolderToParent,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewEpub,
  onPreviewText,
  onPreviewRtf,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onOpenActions,
  onExplorerDragActiveChange,
  onExplorerTouchScrollLockChange,
  mobileSelectionMode = false,
  onTapToggleFileSelection,
  instanceName,
  usedBytes,
  quotaBytes,
  totalFolderCount,
  totalFileCount,
  selectedCount,
  onSelectAll,
  onClearSelection,
  allSelected = false,
  onDeleteFile,
  onDeleteFolder,
  bulkActionsSlot,
  breadcrumbPortalTarget,
}: DriveCloudExplorerProps) {
  const [activeDrag, setActiveDrag] = useState<ExplorerDragPayload | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [dropTargetBreadcrumb, setDropTargetBreadcrumb] = useState<string | null | undefined>(
    undefined,
  );
  const dragDepthRef = useRef<Map<string, number>>(new Map());
  const breadcrumbDragDepthRef = useRef<Map<string, number>>(new Map());
  const activeDragRef = useRef<ExplorerDragPayload | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const entriesContainerRef = useRef<HTMLDivElement>(null);
  /** Human: Full-height entries area — the marquee's coordinate space and hit-test scope. */
  const entriesSectionRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
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

  // Human: Publish the sticky toolbar's height so the list column header can pin right below it.
  // Agent: WRITES --explorer-toolbar-h on the explorer root; RE-MEASURES when the bulk bar appears.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const root = rootRef.current;
    if (!toolbar || !root) return;

    function publishHeight() {
      const height = toolbar?.getBoundingClientRect().height ?? 0;
      root?.style.setProperty("--explorer-toolbar-h", `${Math.round(height)}px`);
    }

    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(toolbar);
    return () => observer.disconnect();
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

  // Human: A flat view has no folders to show and no place to create one.
  const isSearching = listMode === "search";
  const isFlatList = listMode !== "folder";
  const listEmptyMessage = isSearching
    ? "Try a different search term or clear filters."
    : listMode === "favourites"
      ? "Star a file from its details panel and it shows up here, on every device."
      : "Create a folder, upload a file, or change your search and filters.";
  const showEmptyState = folders.length === 0 && files.length === 0;
  const isListView = viewMode === "list";

  // Human: Flatten folders + files into one sequence (folders first when browsing).
  // Agent: SHARED by both layouts; off-screen paint skipped via content-visibility on each tile.
  const gridEntries = useMemo(() => {
    const entries: ExplorerGridEntry[] = [];
    if (!isFlatList) {
      for (const folder of folders) {
        entries.push({ kind: "folder", folder });
      }
    }
    for (const file of files) {
      entries.push({ kind: "file", file });
    }
    return entries;
  }, [files, folders, isFlatList]);

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
      const selectedFileCount = selectedFileIds?.size ?? 0;
      if (
        mobileSelectionMode &&
        selectedFileCount > 1 &&
        selectedFileIds?.has(fileId) === true
      ) {
        return `${selectedFileCount} files`;
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

  // Human: Listing order for range selection — the same sequence the two layouts render.
  // Agent: MIRRORS gridEntries; processing files stay in the order but are filtered on apply.
  const entryOrder = useMemo<ExplorerEntryRef[]>(
    () =>
      gridEntries.map((entry) =>
        entry.kind === "folder"
          ? { kind: "folder" as const, id: entry.folder.id }
          : { kind: "file" as const, id: entry.file.id },
      ),
    [gridEntries],
  );

  // Human: Files mid-processing have no checkbox, so no gesture may sweep them into a selection.
  const unselectableFileIds = useMemo(
    () => new Set(files.filter(isFileProcessing).map((file) => file.id)),
    [files],
  );

  const keepSelectable = useCallback(
    (refs: readonly ExplorerEntryRef[]) =>
      refs.filter((ref) => ref.kind === "folder" || !unselectableFileIds.has(ref.id)),
    [unselectableFileIds],
  );

  /** Human: Where a Shift+click range starts — the last entry clicked without Shift. */
  const selectionAnchorRef = useRef<ExplorerEntryRef | null>(null);
  /** Human: Selection as it stood when a marquee drag began, for Ctrl/Shift-additive sweeps. */
  const marqueeStartRef = useRef<{ files: string[]; folders: string[] }>({
    files: [],
    folders: [],
  });

  // Human: Shift+click extends from the anchor; Ctrl/Cmd keeps what was already selected.
  // Agent: REPLACES the selection with the range unless additive.
  const applyRangeSelection = useCallback(
    (refs: readonly ExplorerEntryRef[], additive: boolean) => {
      if (!selectionEnabled || !onSelectedFileIdsChange || !onSelectedFolderIdsChange) return;
      const { fileIds, folderIds } = splitEntryRefs(keepSelectable(refs));
      onSelectedFileIdsChange((prev) => new Set(additive ? [...prev, ...fileIds] : fileIds));
      onSelectedFolderIdsChange((prev) => new Set(additive ? [...prev, ...folderIds] : folderIds));
    },
    [keepSelectable, onSelectedFileIdsChange, onSelectedFolderIdsChange, selectionEnabled],
  );

  // Human: A marquee sweep always resolves against what was selected when the drag started,
  // so shrinking the box releases entries it no longer covers.
  const applyMarqueeSelection = useCallback(
    (refs: readonly ExplorerEntryRef[], additive: boolean) => {
      if (!selectionEnabled || !onSelectedFileIdsChange || !onSelectedFolderIdsChange) return;
      const { fileIds, folderIds } = splitEntryRefs(keepSelectable(refs));
      const start = marqueeStartRef.current;
      onSelectedFileIdsChange(new Set(additive ? [...start.files, ...fileIds] : fileIds));
      onSelectedFolderIdsChange(new Set(additive ? [...start.folders, ...folderIds] : folderIds));
    },
    [keepSelectable, onSelectedFileIdsChange, onSelectedFolderIdsChange, selectionEnabled],
  );

  // Human: Clicking the background clears the selection, and drops the range anchor with it.
  // Agent: SKIPS the state write when nothing is selected, so idle clicks cause no re-render.
  const handleClearSelectionFromBackground = useCallback(() => {
    selectionAnchorRef.current = null;
    if ((selectedFileIds?.size ?? 0) === 0 && (selectedFolderIds?.size ?? 0) === 0) return;
    onClearSelection?.();
  }, [onClearSelection, selectedFileIds, selectedFolderIds]);

  const handleMarqueeStart = useCallback(() => {
    marqueeStartRef.current = {
      files: [...(selectedFileIds ?? [])],
      folders: [...(selectedFolderIds ?? [])],
    };
  }, [selectedFileIds, selectedFolderIds]);

  const { overlayRef: marqueeOverlayRef, handlePointerDown: handleMarqueePointerDown } =
    useExplorerMarqueeSelect({
      // Human: Only where a mouse and a listing both exist — never over the empty or loading states.
      enabled: selectionEnabled && !loading && gridEntries.length > 0 && !mobileSelectionMode,
      containerRef: entriesSectionRef,
      onMarqueeStart: handleMarqueeStart,
      onMarqueeSelect: applyMarqueeSelection,
      onClearSelection: handleClearSelectionFromBackground,
    });

  /**
   * Human: Shift+click on a row or tile selects the whole span from the anchor.
   * Agent: CAPTURE phase — stopping here keeps the click from opening the file it landed on.
   */
  const handleEntryClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!selectionEnabled) return;
      const ref = entryRefFromNode(event.target as Element | null);
      if (!ref) return;

      const anchor = selectionAnchorRef.current;
      if (event.shiftKey && anchor) {
        event.preventDefault();
        event.stopPropagation();
        applyRangeSelection(
          sliceEntryRange(entryOrder, entryRefKey(anchor), entryRefKey(ref)),
          event.metaKey || event.ctrlKey,
        );
        return;
      }
      selectionAnchorRef.current = ref;
    },
    [applyRangeSelection, entryOrder, selectionEnabled],
  );

  // Human: List header tick box selects or clears every selectable entry in the folder.
  // Agent: CALLS DrivePage's onSelectAll / onClearSelection so both layouts share one code path.
  const handleToggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) onSelectAll?.();
      else onClearSelection?.();
    },
    [onClearSelection, onSelectAll],
  );

  // Human: Space on a focused entry toggles its selection, folders included.
  // Agent: READS gridEntries[index]; SKIPS files still processing (their checkbox is disabled too).
  const handleKeyboardToggleSelect = useCallback(
    (index: number) => {
      const entry = gridEntries[index];
      if (!entry || !selectionEnabled) return;
      if (entry.kind === "folder") {
        toggleFolderSelected(
          entry.folder.id,
          !(selectedFolderIds?.has(entry.folder.id) ?? false),
        );
        return;
      }
      if (isFileProcessing(entry.file)) return;
      toggleFileSelected(entry.file.id, !(selectedFileIds?.has(entry.file.id) ?? false));
    },
    [
      gridEntries,
      selectedFileIds,
      selectedFolderIds,
      selectionEnabled,
      toggleFileSelected,
      toggleFolderSelected,
    ],
  );

  // Human: Delete on a focused entry opens the same confirm dialog the context menu uses.
  // Agent: CALLS onDeleteFile/onDeleteFolder; no deletion happens without that confirmation.
  const handleKeyboardDelete = useCallback(
    (index: number) => {
      const entry = gridEntries[index];
      if (!entry) return;
      if (entry.kind === "folder") onDeleteFolder?.(entry.folder.id);
      else onDeleteFile?.(entry.file.id);
    },
    [gridEntries, onDeleteFile, onDeleteFolder],
  );

  // Human: Backspace leaves the current folder; at the root there is nowhere to go.
  // Agent: CALLS onGoToFolderIndex(length - 2) which resolves to My Cloud root at depth 1.
  const handleKeyboardNavigateUp = useCallback(() => {
    if (folderStack.length === 0) return;
    onGoToFolderIndex(folderStack.length - 2);
  }, [folderStack.length, onGoToFolderIndex]);

  const handleKeyboardClearSelection = useCallback(() => {
    onClearSelection?.();
  }, [onClearSelection]);

  useExplorerKeyboardNav({
    enabled: !loading && gridEntries.length > 0,
    entryCount: gridEntries.length,
    containerRef: entriesContainerRef,
    isListView,
    onToggleSelectIndex: handleKeyboardToggleSelect,
    onClearSelection: handleKeyboardClearSelection,
    onNavigateUp: handleKeyboardNavigateUp,
    onDeleteIndex: handleKeyboardDelete,
  });

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
    // Human: Fills the scroll pane so `mt-auto` on the status strip reaches the floor, and still
    // grows past it for long listings.
    // Agent: grow+shrink-0 replaces `min-h-full`, which no-ops under an auto-height parent.
    <div ref={rootRef} className="flex grow flex-col shrink-0">
      <ExplorerToolbar
        containerRef={toolbarRef}
        // Human: Also pulls up over the pane's top padding so nothing scrolls above the bar.
        // Agent: lg:pt-3 balances the row against pb-2.5 now that the folder trail has moved
        //        out of this bar and up into the topbar.
        className={cn(EXPLORER_STICKY_BLEED, "-mt-4 pt-4 md:-mt-6 md:pt-6 lg:mt-0 lg:pt-3")}
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
        query={query}
        onQueryChange={onQueryChange}
        onSearchKeyDown={handleSearchKeyDown}
        searchInputRef={searchInputRef}
        typeFilter={typeFilter}
        onTypeFilterChange={onTypeFilterChange}
        typeFilterOptions={typeFilterOptions}
        fileSort={fileSort}
        onFileSortChange={onFileSortChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onCreateFolder={onCreateFolder}
        onCreateDocument={onCreateDocument}
        onUpload={onUpload}
        onOpenCommandPalette={onOpenCommandPalette}
        bulkActionsSlot={bulkActionsSlot}
        breadcrumbPortalTarget={breadcrumbPortalTarget}
      />

      {/* Human: One sequence — folders first, then files, in whichever layout is active. */}
      {/* Agent: RENDERS folders when not searching; FILES follow; EMPTY state when both absent. */}
      {/* Human: pb-4 keeps the final row off the sticky status strip below. */}
      {/* Human: `relative` anchors the marquee box; the pointer handler starts a sweep only on
          empty space, so dragging a tile still moves the file. */}
      <section
        ref={entriesSectionRef}
        onPointerDown={handleMarqueePointerDown}
        onClickCapture={handleEntryClickCapture}
        className="relative flex flex-1 flex-col pb-4 pt-4"
      >
        {/* Human: Painted directly through the ref during a drag — re-rendering the whole grid
            on every pointer move would be visibly slower on large folders. */}
        <div
          ref={marqueeOverlayRef}
          aria-hidden
          style={{ display: "none" }}
          className="pointer-events-none absolute left-0 top-0 z-10 origin-top-left rounded-sm border border-brand/70 bg-brand/12"
        />
        {loading ? (
          isListView ? (
            <ExplorerListSkeleton />
          ) : (
            <ExplorerGridSkeleton count={8} />
          )
        ) : showEmptyState && firstRun && !isFlatList ? (
          // Human: Brand-new library — onboarding hints instead of the terse "nothing here" copy.
          <ExplorerFirstRunEmptyState onUpload={onUpload} onCreateFolder={onCreateFolder} />
        ) : showEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <span
              className="flex size-12 items-center justify-center rounded-xl bg-sunken"
              aria-hidden
            >
              {isFlatList ? (
                <Search className="size-5 text-ink-faint" />
              ) : (
                <FileIcon className="size-5 text-ink-faint" />
              )}
            </span>
            <p className="text-sm font-semibold text-ink">
              {listMode === "search"
                ? "No matching files"
                : listMode === "favourites"
                  ? "No starred files yet"
                  : "Nothing here yet"}
            </p>
            <p className="max-w-sm text-[13px] text-ink-muted">{listEmptyMessage}</p>
            {/* Human: Empty folders offer the two actions that resolve the state. */}
            {/* Agent: HIDDEN while searching — creating a folder would not clear the query. */}
            {!isFlatList ? (
              <div className="mt-1 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-edge bg-panel text-ink hover:bg-surface"
                  onClick={onCreateFolder}
                >
                  <FolderPlus className="size-4" aria-hidden />
                  New Folder
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-2 bg-brand text-brand-on hover:bg-brand-hover"
                  onClick={onUpload}
                >
                  <Upload className="size-4" aria-hidden />
                  Upload Files
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {/* Human: Ref host for keyboard navigation — the hook queries entries beneath it. */}
            {/* Agent: MUST wrap both layouts so [data-explorer-entry] order matches gridEntries. */}
            <ExplorerScrollProvider scrollElementRef={explorerScrollRef}>
              <div ref={entriesContainerRef}>
              {isListView ? (
                <div className="flex flex-col">
                  <ExplorerListHeader
                    fileSort={fileSort}
                    onFileSortChange={onFileSortChange}
                    allSelected={allSelected}
                    someSelected={hasActiveSelection}
                    onToggleSelectAll={handleToggleSelectAll}
                    selectionEnabled={selectionEnabled}
                  />
                  {gridEntries.map((entry) =>
                    entry.kind === "folder" ? (
                      <ExplorerFolderListRow
                        key={`folder-${entry.folder.id}`}
                        folder={entry.folder}
                        shareFlags={folderShareFlags[entry.folder.id]}
                        isDropTarget={activeDropTargetFolderId === entry.folder.id}
                        dragEnabled={dragEnabled && !isFlatList}
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
                        onOpenActions={onOpenActions}
                        onDragStart={handleFolderDragStart}
                        onDragEnd={resetDragState}
                        onDragEnter={handleFolderDragEnter}
                        onDragOver={handleFolderDragOver}
                        onDragLeave={handleFolderDragLeave}
                        onDrop={handleFolderDrop}
                      />
                    ) : (
                      <ExplorerFileListRow
                        key={entry.file.id}
                        file={entry.file}
                        shareFlags={fileShareFlags[entry.file.id]}
                        isFavourite={favouriteFileIds?.has(entry.file.id) ?? false}
                        selectionEnabled={selectionEnabled}
                        isSelected={
                          selectionEnabled && (selectedFileIds?.has(entry.file.id) ?? false)
                        }
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
                          mobileSelectionMode || hasActiveSelection
                            ? onTapToggleFileSelection
                            : undefined
                        }
                        onDragStart={handleFileDragStart}
                        onDragEnd={resetDragState}
                        onPreviewVideo={onPreviewVideo}
                        onPreviewImage={onPreviewImage}
                        onPreviewPdf={onPreviewPdf}
                        onPreviewEpub={onPreviewEpub}
                        onPreviewText={onPreviewText}
                        onPreviewRtf={onPreviewRtf}
                        onPreviewSpreadsheet={onPreviewSpreadsheet}
                        onPreviewAudio={onPreviewAudio}
                        onOpenActions={onOpenActions}
                      />
                    ),
                  )}
                </div>
              ) : (
                <div className={EXPLORER_GRID_LAYOUT_CLASS}>
                  {gridEntries.map((entry) =>
                    entry.kind === "folder" ? (
                      <ExplorerFolderGridTile
                        key={`folder-${entry.folder.id}`}
                        folder={entry.folder}
                        shareFlags={folderShareFlags[entry.folder.id]}
                        isDropTarget={activeDropTargetFolderId === entry.folder.id}
                        dragEnabled={dragEnabled && !isFlatList}
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
                        isFavourite={favouriteFileIds?.has(entry.file.id) ?? false}
                        selectionEnabled={selectionEnabled}
                        isSelected={
                          selectionEnabled && (selectedFileIds?.has(entry.file.id) ?? false)
                        }
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
                          mobileSelectionMode || hasActiveSelection
                            ? onTapToggleFileSelection
                            : undefined
                        }
                        onDragStart={handleFileDragStart}
                        onDragEnd={resetDragState}
                        onPreviewVideo={onPreviewVideo}
                        onPreviewImage={onPreviewImage}
                        onPreviewPdf={onPreviewPdf}
                        onPreviewEpub={onPreviewEpub}
                        onPreviewText={onPreviewText}
                        onPreviewRtf={onPreviewRtf}
                        onPreviewSpreadsheet={onPreviewSpreadsheet}
                        onPreviewAudio={onPreviewAudio}
                        onOpenActions={onOpenActions}
                      />
                    ),
                  )}
                </div>
              )}
              </div>
            </ExplorerScrollProvider>
            <div ref={loadMoreSentinelRef} className="h-1 w-full" aria-hidden />
            {!isFlatList && hasMoreFolders && loadingMoreFolders ? (
              <p className="py-2 text-center text-xs text-ink-muted">Loading more folders…</p>
            ) : null}
            {!isFlatList && hasMoreFolders && onLoadMoreFolders ? (
              <div className="flex justify-center py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-brand hover:bg-brand-weak"
                  onClick={() => void onLoadMoreFolders()}
                  disabled={loadingMoreFolders}
                >
                  Load more folders
                </Button>
              </div>
            ) : null}
            {hasMoreFiles && loadingMoreFiles ? (
              <p className="py-2 text-center text-xs text-ink-muted">Loading more files…</p>
            ) : null}
          </>
        )}
        {ghostPosition && ghostLabel ? (
          <div
            data-explorer-touch-drag-ghost
            className="pointer-events-none fixed z-[80] flex max-w-[min(72vw,16rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl border border-brand/40 bg-panel/95 px-3 py-2 text-sm font-semibold text-ink shadow-lg shadow-brand/20"
            style={{ left: ghostPosition.x, top: ghostPosition.y }}
            aria-hidden
          >
            {ghostKind === "folder" ? (
              <Folder className="size-4 shrink-0 text-brand" />
            ) : (
              <FileIcon className="size-4 shrink-0 text-brand" />
            )}
            <span className="truncate">{ghostLabel}</span>
          </div>
        ) : null}
      </section>

      {/* Human: Status strip pinned to the bottom of the explorer, above the mobile bottom nav. */}
      {/* Agent: mt-auto keeps it at the floor when content is short; sticky handles long lists. */}
      {/*        pt-4 above it stops the last row sitting flush against the strip. */}
      <ExplorerStatusBar
        className={cn("mt-auto", EXPLORER_STATUS_BLEED)}
        instanceName={instanceName}
        folderCount={totalFolderCount}
        loadedFileCount={files.length}
        totalFileCount={totalFileCount}
        selectedCount={selectedCount}
        usedBytes={usedBytes}
        quotaBytes={quotaBytes}
        loading={loading || loadingMoreFiles || loadingMoreFolders}
        isSearching={isSearching}
      />
    </div>
  );
}
