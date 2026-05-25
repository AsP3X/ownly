// Human: OneDrive-style drive shell — top bar, sidebar, recent files table on a light theme.
// Agent: CALLS listFiles/uploadFile/fetchDashboard; READS auth user for profile chip.

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
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRight,
  Download,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderPlus,
  ImageIcon,
  LayoutGrid,
  LogOut,
  Music,
  Presentation,
  Search,
  Settings,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import {
  batchFiles,
  buildShareFlagMaps,
  fetchDashboard,
  fetchFile,
  fetchFolderDeletionPreview,
  fetchShareStatusBulk,
  FILES_PAGE_SIZE,
  getErrorMessage,
  copyFile,
  listFiles,
  listFolders,
  moveFile,
  type FileItem,
  type FolderDeletionPreview,
  type FolderItem,
  type ShareFlags,
} from "@/api/client";
import { BulkActionsBar } from "@/components/drive/BulkActionsBar";
import { FileListView } from "@/components/drive/FileListView";
import {
  MobileFileActionsSheet,
  type MobileActionTarget,
} from "@/components/drive/MobileFileActionsSheet";
import { MobileBottomNav } from "@/components/drive/MobileBottomNav";
import { MobileSidebarSheet } from "@/components/drive/MobileSidebarSheet";
import { CreateFolderDialog } from "@/components/drive/CreateFolderDialog";
import {
  ConfirmBulkDeleteDialog,
  type BulkDeleteItem,
} from "@/components/drive/ConfirmBulkDeleteDialog";
import {
  ConfirmDeleteDialog,
  type DeleteTarget,
} from "@/components/drive/ConfirmDeleteDialog";
import { DriveContextMenu } from "@/components/drive/DriveContextMenu";
import { FolderPickerDialog, type FolderPickerCrumb } from "@/components/drive/FolderPickerDialog";
import { ShareDialog, type ShareTarget } from "@/components/drive/ShareDialog";
import {
  ResourceDetailsDialog,
  type DetailsTarget,
} from "@/components/drive/ResourceDetailsDialog";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import { VideoPreviewDialog } from "@/components/drive/VideoPreviewDialog";
import { ImagePreviewDialog } from "@/components/drive/ImagePreviewDialog";
import { TransferPanelStack } from "@/components/drive/TransferPanelStack";
import { UploadDialog } from "@/components/drive/UploadDialog";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { subscribeUploadFileComplete } from "@/lib/upload-manager";
import { isFileProcessing } from "@/lib/file-processing";
import { enqueueDownload, enqueueBulkDownload, enqueueFolderDownload } from "@/lib/download-manager";
import { useAuth } from "@/hooks/useAuth";
import {
  buildImageGallery,
  formatBytes,
  formatFileOpened,
  isImageMime,
  sortFilesByName,
  userInitials,
  type FileTypeFilter,
} from "@/lib/utils-app";
import {
  getFavouriteFileIds,
  getRecentFileIds,
  pickFavouriteFiles,
  recordFileAccess,
  removeFilePreferences,
  sortFilesByRecentAccess,
  toggleFavouriteFile,
} from "@/lib/drive-preferences";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

type NavItemId = "home" | "my-files";
type FolderCrumb = { id: string; name: string };

const TYPE_FILTERS: { id: FileTypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "documents", label: "Documents" },
  { id: "spreadsheets", label: "Spreadsheets" },
  { id: "presentations", label: "Presentations" },
  { id: "images", label: "Images" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];

// Human: Pick a lucide icon from mime type for the file table name column.
// Agent: READS mime_type string; RETURNS icon component for row rendering.
function FileTypeIcon({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = "size-[18px] shrink-0 text-blue-600";
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

// Human: Sidebar nav row with OneDrive-style active indicator on the left edge.
// Agent: RENDERS button; HIGHLIGHTS when id matches activeNav.
function SidebarNavItem({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md py-2 pl-1 pr-2 text-left text-sm transition-colors",
        active && "font-semibold text-blue-700",
        !active && !disabled && "text-neutral-700 hover:bg-neutral-100",
        disabled && "cursor-not-allowed text-neutral-400",
      )}
    >
      <span
        className={cn(
          "h-[18px] w-[3px] shrink-0 rounded-full",
          active ? "bg-blue-600" : "bg-transparent",
        )}
        aria-hidden
      />
      <span>{label}</span>
    </button>
  );
}

type FileTableProps = {
  folders?: FolderItem[];
  files: FileItem[];
  ownerLabel: string;
  favouriteIds: Set<string>;
  locationLabel?: string;
  emptyMessage: string;
  dragEnabled?: boolean;
  selectable?: boolean;
  selectedFileIds?: Set<string>;
  onSelectedFileIdsChange?: (ids: Set<string>) => void;
  onOpenFolder?: (folder: FolderItem) => void;
  onDeleteFolder?: (folderId: string) => void;
  onMoveFileToFolder?: (fileId: string, folderId: string) => void | Promise<void>;
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
  /** Main pane scroll element — virtualizer and load-more observe this, not an inner box. */
  scrollElementRef?: RefObject<HTMLElement | null>;
};

// Human: MIME payload key for HTML5 drag — keeps drop handler independent of React state timing.
// Agent: SET on dragstart; READ on drop to resolve which file was moved.
const FILE_DRAG_MIME = "application/x-mediavault-file-id";
// Human: Fixed row height estimate for virtualized file rows in the drive table.
// Agent: USED by @tanstack/react-virtual estimateSize; MATCHES py-3 row padding.
const FILE_TABLE_ROW_HEIGHT = 56;

// Human: Reusable file rows table for the My files browser, with optional folder rows first.
// Agent: RENDERS folder navigation + download/delete/favourite actions; SUPPORTS drag files onto folders.
function FileTable({
  folders = [],
  files,
  ownerLabel,
  favouriteIds,
  locationLabel = "My files",
  emptyMessage,
  dragEnabled = false,
  selectable = false,
  selectedFileIds,
  onSelectedFileIdsChange,
  onOpenFolder,
  onDeleteFolder,
  onMoveFileToFolder,
  onToggleFavourite,
  onDelete,
  onDownload,
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
}: FileTableProps) {
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const dragDepthRef = useRef<Map<string, number>>(new Map());
  const selectAllRef = useRef<HTMLInputElement>(null);
  // Human: Ref mirrors dragging id so dragOver handlers see it before React re-renders.
  // Agent: WRITES in dragstart; READS in folder dragenter/over; CLEARS on dragend.
  const draggingFileIdRef = useRef<string | null>(null);

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const selectionEnabled = selectable && selectedFileIds !== undefined && onSelectedFileIdsChange !== undefined;
  // Human: Bulk selection skips files still processing on the server.
  // Agent: FILTERS isFileProcessing; USED by select-all and checkbox disabled state.
  const selectableFileIds = useMemo(
    () => files.filter((file) => !isFileProcessing(file)).map((file) => file.id),
    [files],
  );
  const columnCount = selectionEnabled ? 5 : 4;

  // Human: Only mount visible file rows; scroll tracking uses the main pane, not a nested box.
  // Agent: READS scrollElementRef from DrivePage main; CALLS onLoadMoreFiles via IntersectionObserver.
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollElementRef?.current ?? null,
    estimateSize: () => FILE_TABLE_ROW_HEIGHT,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
      : 0;

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

  // Human: Mirror partial selection on the header checkbox via the native indeterminate flag.
  // Agent: WRITES selectAllRef.indeterminate when some but not all visible files are checked.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  // Human: Toggle one file row in the bulk selection set without mutating the parent Set in place.
  // Agent: CLONES selectedFileIds; ADDS or REMOVES fileId; CALLS onSelectedFileIdsChange.
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

  // Human: Select or clear every file currently visible in the table (respects type/search filters).
  // Agent: MERGES visible ids into selection or REMOVES them on clear-all.
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

  // Human: Clear drag highlights when the pointer leaves the table or the drag ends.
  // Agent: RESETS dropTargetFolderId and dragDepthRef on dragend.
  const resetDragState = useCallback(() => {
    draggingFileIdRef.current = null;
    setDraggingFileId(null);
    setDropTargetFolderId(null);
    dragDepthRef.current.clear();
  }, []);

  // Human: Start dragging a file row — stash id for styling and for the folder drop handler.
  // Agent: WRITES dataTransfer custom MIME + text/plain fallback.
  function handleFileDragStart(event: DragEvent<HTMLTableRowElement>, fileId: string) {
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

  // Human: Resolve dragged file id from the drop event payload.
  // Agent: READS FILE_DRAG_MIME first, then text/plain.
  function readDraggedFileId(event: DragEvent): string | null {
    const custom = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (custom) return custom;
    const plain = event.dataTransfer.getData("text/plain");
    return plain || draggingFileIdRef.current || draggingFileId;
  }

  // Human: Highlight a folder row while a file is dragged over it.
  // Agent: TRACKS enter/leave depth per folder id to avoid flicker on child elements.
  function handleFolderDragEnter(
    event: DragEvent<HTMLTableRowElement>,
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

  // Human: Accept file drop onto a folder and notify the parent to persist the move.
  // Agent: CALLS onMoveFileToFolder when target differs from the file's current folder_id.
  function handleFolderDrop(
    event: DragEvent<HTMLTableRowElement>,
    folder: FolderItem,
  ) {
    if (!dragEnabled || !onMoveFileToFolder) return;
    event.preventDefault();
    const fileId = readDraggedFileId(event);
    resetDragState();
    if (!fileId) return;

    const file = fileById.get(fileId);
    if (!file || file.folder_id === folder.id) return;

    void onMoveFileToFolder(fileId, folder.id);
  }

  function canDropOnFolder(folderId: string, fileId: string | null): boolean {
    if (!fileId) return false;
    const file = fileById.get(fileId);
    return Boolean(file && file.folder_id !== folderId);
  }
  if (folders.length === 0 && files.length === 0) {
    return <p className="py-6 text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
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
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            {selectionEnabled ? (
              <th className="w-10 pb-3 pr-2 font-medium">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="size-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                  checked={allVisibleSelected}
                  onChange={handleSelectAllVisible}
                  aria-label="Select all files"
                />
              </th>
            ) : null}
            <th className="pb-3 pr-4 font-medium">Name</th>
            <th className="pb-3 pr-4 font-medium">Opened</th>
            <th className="pb-3 pr-4 font-medium">Owner</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => {
            const isDropTarget = dropTargetFolderId === folder.id;
            const dropAllowed = canDropOnFolder(folder.id, draggingFileId);
            return (
            <tr
              key={folder.id}
              data-folder-id={folder.id}
              onDoubleClick={() => onOpenFolder?.(folder)}
              onDragEnter={(event) =>
                handleFolderDragEnter(event, folder.id, draggingFileIdRef.current)
              }
              onDragOver={(event) => {
                if (!dragEnabled || !canDropOnFolder(folder.id, draggingFileIdRef.current)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragLeave={() => handleFolderDragLeave(folder.id)}
              onDrop={(event) => handleFolderDrop(event, folder)}
              className={cn(
                "border-b border-neutral-100 transition-colors hover:bg-neutral-50 cursor-pointer",
                isDropTarget && dropAllowed && "bg-blue-50 ring-2 ring-inset ring-blue-300",
              )}
            >
              {selectionEnabled ? <td className="w-10 py-3 pr-2" aria-hidden /> : null}
              <td className="py-3 pr-4">
                <button
                  type="button"
                  onClick={() => onOpenFolder?.(folder)}
                  className="flex min-w-0 items-start gap-3 text-left"
                >
                  <Folder className="size-[18px] shrink-0 text-amber-500" aria-hidden />
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-neutral-900">{folder.name}</span>
                      <SharedIndicator flags={folderShareFlags[folder.id]} />
                    </div>
                    <span className="text-xs text-neutral-500">{locationLabel} · Folder</span>
                  </div>
                </button>
              </td>
              <td className="py-3 pr-4 whitespace-nowrap text-neutral-700">
                {formatFileOpened(folder.updated_at)}
              </td>
              <td className="py-3 pr-4 whitespace-nowrap capitalize text-neutral-700">
                {ownerLabel}
              </td>
              <td className="py-3">
                <div
                  className="flex items-center justify-end gap-1"
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onOpenFolder?.(folder)}
                    aria-label={`Open ${folder.name}`}
                  >
                    <Folder className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDeleteFolder?.(folder.id)}
                    aria-label={`Delete ${folder.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </td>
            </tr>
            );
          })}
          {paddingTop > 0 ? (
            <tr aria-hidden>
              <td colSpan={columnCount} style={{ height: paddingTop, padding: 0, border: "none" }} />
            </tr>
          ) : null}
          {virtualRows.map((virtualRow) => {
            const file = files[virtualRow.index];
            if (!file) return null;
            const favourited = favouriteIds.has(file.id);
            const isDragging = draggingFileId === file.id;
            const isSelected = selectionEnabled && selectedFileIds.has(file.id);
            const isVideo = file.mime_type?.startsWith("video/") ?? false;
            const isImage = isImageMime(file.mime_type);
            const processing = isFileProcessing(file);
            const canPreviewVideo =
              isVideo && onPreviewVideo !== undefined && !processing;
            const canPreviewImage =
              isImage && onPreviewImage !== undefined && !processing;
            const canPreview = canPreviewVideo || canPreviewImage;
            return (
              <tr
                key={file.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                data-file-id={file.id}
                draggable={dragEnabled && !processing}
                onDragStart={(event) => handleFileDragStart(event, file.id)}
                onDragEnd={resetDragState}
                onClick={(event) => {
                  if (!canPreview) return;
                  const target = event.target;
                  if (!(target instanceof Element)) return;
                  if (target.closest('input[type="checkbox"]') || target.closest("button")) return;
                  if (canPreviewVideo) onPreviewVideo!(file);
                  else onPreviewImage!(file);
                }}
                className={cn(
                  "border-b border-neutral-100 transition-colors hover:bg-neutral-50",
                  dragEnabled && !processing && "cursor-grab active:cursor-grabbing",
                  canPreview && "cursor-pointer",
                  processing && "bg-violet-50/40",
                  isDragging && "opacity-50",
                  isSelected && "bg-blue-50/60",
                )}
              >
                {selectionEnabled ? (
                  <td className="w-10 py-3 pr-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      checked={isSelected}
                      disabled={processing}
                      onChange={(event) => toggleFileSelected(file.id, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select ${file.name}`}
                    />
                  </td>
                ) : null}
                <td className="py-3 pr-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileTypeIcon mimeType={file.mime_type} />
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-neutral-900">{file.name}</span>
                        <SharedIndicator flags={fileShareFlags[file.id]} />
                        {processing ? (
                          <FileProcessingBadge file={file} className="shrink-0 bg-violet-100 text-violet-900" />
                        ) : null}
                      </div>
                      <span className="text-xs text-neutral-500">
                        {locationLabel} · {formatBytes(file.size_bytes)}
                        {file.mime_type ? (
                          <>
                            {" "}
                            ·{" "}
                            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                              {file.mime_type.split("/")[0]}
                            </Badge>
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-4 whitespace-nowrap text-neutral-700">
                  {formatFileOpened(file.updated_at)}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap capitalize text-neutral-700">
                  {ownerLabel}
                </td>
                <td className="py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={processing}
                      onClick={() => onToggleFavourite(file.id)}
                      aria-label={favourited ? `Unfavourite ${file.name}` : `Favourite ${file.name}`}
                      className={cn(
                        favourited && "text-amber-500 hover:text-amber-600",
                        processing && "opacity-40",
                      )}
                    >
                      <Star className={cn("size-4", favourited && "fill-current")} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={processing}
                      onClick={() => onDownload(file)}
                      aria-label={`Download ${file.name}`}
                      className={cn(processing && "opacity-40")}
                    >
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={processing}
                      onClick={() => onDelete(file.id)}
                      aria-label={`Delete ${file.name}`}
                      className={cn(processing && "opacity-40")}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
          {paddingBottom > 0 ? (
            <tr aria-hidden>
              <td colSpan={columnCount} style={{ height: paddingBottom, padding: 0, border: "none" }} />
            </tr>
          ) : null}
        </tbody>
      </table>
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

type FileGridProps = {
  files: FileItem[];
  ownerLabel: string;
  favouriteIds: Set<string>;
  locationLabel?: string;
  emptyMessage: string;
  onToggleFavourite: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  onDownload: (file: FileItem) => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  fileShareFlags?: Record<string, ShareFlags>;
};

// Human: Large mime icon for Home grid tile previews (no thumbnail API yet).
// Agent: READS mime_type; RETURNS larger lucide icon centered in tile header.
function FileGridPreview({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = "size-10 text-blue-600";
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

// Human: Card grid for Home — recently accessed, favourites, and shared buckets.
// Agent: RESPONSIVE grid layout; HOVER reveals star/download/delete actions on each tile.
function FileGrid({
  files,
  ownerLabel,
  favouriteIds,
  locationLabel = "My files",
  emptyMessage,
  onToggleFavourite,
  onDelete,
  onDownload,
  onPreviewVideo,
  onPreviewImage,
  fileShareFlags = {},
}: FileGridProps) {
  if (files.length === 0) {
    return <p className="py-6 text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {files.map((file) => {
        const favourited = favouriteIds.has(file.id);
        const isVideo = file.mime_type?.startsWith("video/") ?? false;
        const isImage = isImageMime(file.mime_type);
        const processing = isFileProcessing(file);
        const canPreviewVideo =
          isVideo && onPreviewVideo !== undefined && !processing;
        const canPreviewImage =
          isImage && onPreviewImage !== undefined && !processing;
        const canPreview = canPreviewVideo || canPreviewImage;
        return (
          <article
            key={file.id}
            data-file-id={file.id}
            onClick={(event) => {
              if (!canPreview) return;
              const target = event.target;
              if (!(target instanceof Element)) return;
              if (target.closest("button")) return;
              if (canPreviewVideo) onPreviewVideo!(file);
              else onPreviewImage!(file);
            }}
            className={cn(
              "group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-blue-200 hover:shadow-sm",
              canPreview && "cursor-pointer",
              processing && "border-violet-200 bg-violet-50/30",
            )}
          >
            <div className="relative flex aspect-[4/3] items-center justify-center bg-[#f3f2f1]">
              <FileGridPreview mimeType={file.mime_type} />
              {processing ? (
                <div className="absolute inset-x-2 top-2 flex justify-center">
                  <FileProcessingBadge file={file} className="bg-violet-100 text-violet-900 shadow-sm" />
                </div>
              ) : null}
              <div className="absolute right-2 top-2 flex gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={processing}
                  className={cn(
                    "size-7 bg-white/90 hover:bg-white",
                    favourited && "text-amber-500 hover:text-amber-600",
                    processing && "opacity-40",
                  )}
                  onClick={() => onToggleFavourite(file.id)}
                  aria-label={favourited ? `Unfavourite ${file.name}` : `Favourite ${file.name}`}
                >
                  <Star className={cn("size-3.5", favourited && "fill-current")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={processing}
                  className={cn("size-7 bg-white/90 hover:bg-white", processing && "opacity-40")}
                  onClick={() => onDownload(file)}
                  aria-label={`Download ${file.name}`}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={processing}
                  className={cn("size-7 bg-white/90 hover:bg-white", processing && "opacity-40")}
                  onClick={() => onDelete(file.id)}
                  aria-label={`Delete ${file.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate text-sm font-medium text-neutral-900" title={file.name}>
                  {file.name}
                </p>
                <SharedIndicator flags={fileShareFlags[file.id]} className="size-3" />
              </div>
              <p className="truncate text-xs text-neutral-500">
                {locationLabel} · {formatFileOpened(file.updated_at)}
              </p>
              <p className="truncate text-xs capitalize text-neutral-400">
                {ownerLabel} · {formatBytes(file.size_bytes)}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// Human: Home dashboard section wrapper (Recently accessed, Favourites, Shared).
// Agent: RENDERS section title + FileGrid tiles for one Home bucket.
function HomeSection({
  title,
  description,
  files,
  ownerLabel,
  favouriteIds,
  locationLabel,
  emptyMessage,
  onToggleFavourite,
  onDelete,
  onDownload,
  onPreviewVideo,
  onPreviewImage,
  fileShareFlags,
}: {
  title: string;
  description: string;
  files: FileItem[];
  ownerLabel: string;
  favouriteIds: Set<string>;
  locationLabel: string;
  emptyMessage: string;
  onToggleFavourite: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  onDownload: (file: FileItem) => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  fileShareFlags?: Record<string, ShareFlags>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        <p className="text-sm text-neutral-500">{description}</p>
      </div>
      <FileGrid
        files={files}
        ownerLabel={ownerLabel}
        favouriteIds={favouriteIds}
        locationLabel={locationLabel}
        emptyMessage={emptyMessage}
        onToggleFavourite={onToggleFavourite}
        onDelete={onDelete}
        onDownload={onDownload}
        onPreviewVideo={onPreviewVideo}
        onPreviewImage={onPreviewImage}
        fileShareFlags={fileShareFlags}
      />
    </section>
  );
}

// Human: Sidebar storage quota bar with explicit fill width so usage is always visible on light theme.
// Agent: RENDERS neutral track + blue fill; ensures non-zero usage shows at least a sliver.
function StorageUsageBar({ usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number }) {
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const fillWidth = usedBytes > 0 ? Math.max(percent, 2) : 0;

  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Storage used"
    >
      <div
        className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
        style={{ width: `${fillWidth}%` }}
      />
    </div>
  );
}

export default function DrivePage() {
  const { user, logout } = useAuth();
  const profileRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>("all");
  const [activeNav, setActiveNav] = useState<NavItemId>("home");
  const [instanceName, setInstanceName] = useState("MediaVault");
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [folderDeletePreview, setFolderDeletePreview] = useState<FolderDeletionPreview | null>(
    null,
  );
  const [folderPreviewLoading, setFolderPreviewLoading] = useState(false);
  const [folderPreviewError, setFolderPreviewError] = useState("");
  const [bulkDeleteItems, setBulkDeleteItems] = useState<BulkDeleteItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerFiles, setFolderPickerFiles] = useState<FileItem[]>([]);
  const [folderPickerStack, setFolderPickerStack] = useState<FolderPickerCrumb[]>([]);
  const [folderPickerFolders, setFolderPickerFolders] = useState<FolderItem[]>([]);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  const [folderPickerError, setFolderPickerError] = useState("");
  const [folderPickerSubmitting, setFolderPickerSubmitting] = useState<"copy" | "move" | null>(
    null,
  );
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(
    () => new Set(getFavouriteFileIds()),
  );
  const [previewVideo, setPreviewVideo] = useState<FileItem | null>(null);
  const [previewImage, setPreviewImage] = useState<FileItem | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<DetailsTarget | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsInitialTab, setDetailsInitialTab] = useState<"details" | "sharing">("details");
  const [fileShareFlags, setFileShareFlags] = useState<Record<string, ShareFlags>>({});
  const [folderShareFlags, setFolderShareFlags] = useState<Record<string, ShareFlags>>({});
  const [fileCount, setFileCount] = useState(0);
  const [hasMoreFiles, setHasMoreFiles] = useState(false);
  const [filesLoadingMore, setFilesLoadingMore] = useState(false);
  const [folderCount, setFolderCount] = useState(0);
  const [hasMoreFolders, setHasMoreFolders] = useState(false);
  const [foldersLoadingMore, setFoldersLoadingMore] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileActionTarget, setMobileActionTarget] = useState<MobileActionTarget | null>(null);

  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const isSearchingMyFiles = activeNav === "my-files" && query.trim().length > 0;
  const serverTypeFilter = typeFilter !== "all" ? typeFilter : undefined;
  const dashboardLoadedRef = useRef(false);

  // Human: Storage summary for the sidebar — fetched once per page session, not every folder open.
  // Agent: GET /dashboard; WRITES instanceName, usedBytes, quotaBytes; CALLS again after mutations.
  const refreshDashboard = useCallback(async () => {
    try {
      const dashboard = await fetchDashboard();
      setInstanceName(dashboard.instance_name);
      setUsedBytes(dashboard.used_bytes);
      setQuotaBytes(dashboard.quota_bytes || 1);
      dashboardLoadedRef.current = true;
    } catch {
      // Human: Dashboard stats are non-critical — a failed fetch must not block browsing.
    }
  }, []);

  // Human: Refresh paperclip indicators after share dialog changes (list rows may be stale).
  // Agent: POST /shares/status; WRITES fileShareFlags + folderShareFlags maps.
  const refreshShareFlags = useCallback(async (fileIds: string[], folderIds: string[]) => {
    if (fileIds.length === 0 && folderIds.length === 0) {
      setFileShareFlags({});
      setFolderShareFlags({});
      return;
    }
    try {
      const status = await fetchShareStatusBulk({
        file_ids: fileIds,
        folder_ids: folderIds,
      });
      setFileShareFlags(status.files);
      setFolderShareFlags(status.folders);
    } catch {
      // Human: Share indicators are non-critical — a failed status poll must not block the drive.
    }
  }, []);

  // Human: Remove selected ids that no longer exist or are still processing on the server.
  // Agent: INTERSECTS selectedFileIds with actionable files; SKIPS setState when unchanged.
  function pruneFileSelection(validFiles: FileItem[]) {
    const validIds = new Set(
      validFiles.filter((file) => !isFileProcessing(file)).map((file) => file.id),
    );
    setSelectedFileIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }

  const refresh = useCallback(
    async (
      search?: string,
      options?: { silent?: boolean; folderId?: string | null; nav?: NavItemId },
    ) => {
      if (!options?.silent) {
        setLoading(true);
      }
      setError("");
      if (!dashboardLoadedRef.current) {
        void refreshDashboard();
      }
      const nav = options?.nav ?? activeNav;
      try {
        const targetFolderId =
          options?.folderId !== undefined ? options.folderId : currentFolderId;

        if (nav === "home" && !search) {
          const homeIds = [
            ...new Set([...getRecentFileIds(), ...getFavouriteFileIds()]),
          ].slice(0, FILES_PAGE_SIZE);
          const { files: homeFiles } = await batchFiles(homeIds, "minimal");
          setFolders([]);
          setFiles(homeFiles);
          setFileCount(homeFiles.length);
          setHasMoreFiles(false);
          setFolderCount(0);
          setHasMoreFolders(false);
          const flags = buildShareFlagMaps(homeFiles, []);
          setFileShareFlags(flags.files);
          setFolderShareFlags({});
          pruneFileSelection(homeFiles);
          return;
        }

        if (search) {
          const listing = await listFiles({
            q: search,
            limit: FILES_PAGE_SIZE,
            offset: 0,
            fields: "minimal",
            type_filter: serverTypeFilter,
          });
          setFolders([]);
          setFiles(listing.files);
          setFileCount(listing.file_count);
          setHasMoreFiles(listing.has_more);
          setFolderCount(0);
          setHasMoreFolders(false);
          const flags = buildShareFlagMaps(listing.files, []);
          setFileShareFlags(flags.files);
          setFolderShareFlags({});
          pruneFileSelection(listing.files);
          return;
        }

        const [folderListing, fileListing] = await Promise.all([
          listFolders({
            parent_id: targetFolderId ?? undefined,
            limit: FILES_PAGE_SIZE,
            offset: 0,
          }),
          listFiles({
            folder_id: targetFolderId ?? undefined,
            limit: FILES_PAGE_SIZE,
            offset: 0,
            fields: "minimal",
            type_filter: serverTypeFilter,
          }),
        ]);
        setFolders(folderListing.folders);
        setFiles(fileListing.files);
        setFileCount(fileListing.file_count);
        setHasMoreFiles(fileListing.has_more);
        setFolderCount(folderListing.folder_count);
        setHasMoreFolders(folderListing.has_more);
        const flags = buildShareFlagMaps(fileListing.files, folderListing.folders);
        setFileShareFlags(flags.files);
        setFolderShareFlags(flags.folders);
        pruneFileSelection(fileListing.files);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [activeNav, currentFolderId, refreshDashboard, serverTypeFilter],
  );

  // Human: Append the next page of files for the open folder or active search.
  // Agent: GET /files with offset=files.length; MERGES rows + share_public flags.
  const loadMoreFiles = useCallback(async () => {
    if (!hasMoreFiles || filesLoadingMore || loading) return;
    setFilesLoadingMore(true);
    setError("");
    try {
      const listing = await listFiles({
        q: isSearchingMyFiles ? query.trim() : undefined,
        folder_id: isSearchingMyFiles ? undefined : (currentFolderId ?? undefined),
        limit: FILES_PAGE_SIZE,
        offset: files.length,
        fields: "minimal",
        type_filter: serverTypeFilter,
      });
      setFiles((prev) => [...prev, ...listing.files]);
      setHasMoreFiles(listing.has_more);
      setFileCount(listing.file_count);
      const flags = buildShareFlagMaps(listing.files, []);
      setFileShareFlags((prev) => ({ ...prev, ...flags.files }));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setFilesLoadingMore(false);
    }
  }, [
    currentFolderId,
    files.length,
    filesLoadingMore,
    hasMoreFiles,
    isSearchingMyFiles,
    loading,
    query,
    serverTypeFilter,
  ]);

  // Human: Append the next page of subfolders when a directory has many children.
  // Agent: GET /folders with offset=folders.length; MERGES folder share flags.
  const loadMoreFolders = useCallback(async () => {
    if (!hasMoreFolders || foldersLoadingMore || loading) return;
    setFoldersLoadingMore(true);
    setError("");
    try {
      const listing = await listFolders({
        parent_id: currentFolderId ?? undefined,
        limit: FILES_PAGE_SIZE,
        offset: folders.length,
      });
      setFolders((prev) => [...prev, ...listing.folders]);
      setHasMoreFolders(listing.has_more);
      setFolderCount(listing.folder_count);
      const flags = buildShareFlagMaps([], listing.folders);
      setFolderShareFlags((prev) => ({ ...prev, ...flags.folders }));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setFoldersLoadingMore(false);
    }
  }, [currentFolderId, folders.length, foldersLoadingMore, hasMoreFolders, loading]);

  // Human: Refresh the drive listing as each file finishes uploading in the corner panel.
  // Agent: SUBSCRIBES upload-manager file events; CALLS refresh silent + dashboard stats.
  useEffect(() => {
    return subscribeUploadFileComplete((fileId) => {
      recordFileAccess(fileId);
      void refreshDashboard();
      void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
        silent: true,
        nav: activeNav,
      });
    });
  }, [activeNav, query, refresh, refreshDashboard]);

  // Human: Poll only processing file rows instead of reloading the entire folder listing.
  // Agent: GET /files/:id every 3s; PATCHES matching rows in files state.
  const processingFileIds = useMemo(
    () => files.filter(isFileProcessing).map((file) => file.id),
    [files],
  );
  const processingIdsKey = processingFileIds.join(",");
  useEffect(() => {
    if (!processingIdsKey) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const updates = await Promise.all(
            processingFileIds.map((fileId) => fetchFile(fileId)),
          );
          setFiles((prev) => {
            const byId = new Map(updates.map((entry) => [entry.file.id, entry.file]));
            return prev.map((file) => byId.get(file.id) ?? file);
          });
        } catch {
          // Human: Processing poll failures are non-critical — next interval retries.
        }
      })();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [processingIdsKey, processingFileIds]);

  // Human: Load file list when the page opens, folder changes, search, or type filter changes.
  // Agent: DEBOUNCES query 300ms on My files; Home uses batch API via refresh().
  useEffect(() => {
    let cancelled = false;
    const searchOnMyFiles = activeNav === "my-files" ? query.trim() : "";
    const delay = searchOnMyFiles ? 300 : 0;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void refresh(searchOnMyFiles || undefined, { nav: activeNav });
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, refresh, activeNav, folderStack, typeFilter]);

  function openFolder(folder: FolderItem) {
    setActiveNav("my-files");
    setSelectedFileIds(new Set());
    // Human: Ignore repeat opens when double-click fires after the first click already navigated.
    // Agent: SKIPS push when folder is already the current breadcrumb leaf.
    setFolderStack((prev) => {
      if (prev.at(-1)?.id === folder.id) return prev;
      return [...prev, { id: folder.id, name: folder.name }];
    });
  }

  function goToFolderIndex(index: number) {
    setSelectedFileIds(new Set());
    if (index < 0) {
      setFolderStack([]);
      return;
    }
    setFolderStack((prev) => prev.slice(0, index + 1));
  }

  // Human: Close the profile menu when clicking outside the top-bar avatar cluster.
  // Agent: LISTENS document mousedown; WRITES profileOpen false when target outside profileRef.
  useEffect(() => {
    if (!profileOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [profileOpen]);

  // Human: Open the delete confirmation dialog for a file row, grid tile, or context menu action.
  // Agent: READS files state for display name; WRITES deleteTarget to show ConfirmDeleteDialog.
  function requestDeleteFile(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    if (!file || isFileProcessing(file)) return;
    setDeleteTarget({ kind: "file", id: fileId, name: file.name });
  }

  // Human: Open the delete confirmation dialog for a folder row action.
  // Agent: FETCHES deletion-preview; WRITES deleteTarget and folder content summary state.
  async function requestDeleteFolder(folderId: string) {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;

    setFolderDeletePreview(null);
    setFolderPreviewError("");
    setFolderPreviewLoading(true);
    setDeleteTarget({ kind: "folder", id: folderId, name: folder.name });

    try {
      const preview = await fetchFolderDeletionPreview(folderId);
      setFolderDeletePreview(preview);
    } catch (e) {
      setFolderPreviewError(getErrorMessage(e));
    } finally {
      setFolderPreviewLoading(false);
    }
  }

  // Human: Clear folder delete preview state when the confirmation dialog closes.
  // Agent: RESETS deleteTarget and preview fields together.
  function closeDeleteDialog() {
    setDeleteTarget(null);
    setFolderDeletePreview(null);
    setFolderPreviewLoading(false);
    setFolderPreviewError("");
  }

  // Human: Refresh drive state after ConfirmDeleteDialog completes a successful delete.
  // Agent: CLEARS file prefs / breadcrumb crumbs; CALLS refresh for current nav view.
  function handleDeleted(target: DeleteTarget) {
    setError("");
    if (target.kind === "file") {
      removeFilePreferences(target.id);
      setFavouriteIds(new Set(getFavouriteFileIds()));
    } else {
      setFolderStack((prev) => prev.filter((crumb) => crumb.id !== target.id));
    }
    void refreshDashboard();
    void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
      nav: activeNav,
    });
  }

  // Human: Persist a drag-and-drop move by updating the file's folder_id on the API.
  // Agent: CALLS moveFile; REFRESHES listing silently so the row disappears from the current folder.
  async function handleMoveFileToFolder(fileId: string, folderId: string) {
    const file = files.find((item) => item.id === fileId);
    if (file && isFileProcessing(file)) return;

    setError("");
    try {
      await moveFile(fileId, folderId);
      await refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
        silent: true,
      });
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  // Human: Load folders for one level of the picker breadcrumb.
  // Agent: GET /folders?parent_id=; WRITES folderPickerFolders + loading flags.
  async function loadFolderPickerLevel(parentId: string | null) {
    setFolderPickerLoading(true);
    setFolderPickerError("");
    try {
      const listing = await listFolders(parentId ? { parent_id: parentId } : undefined);
      setFolderPickerFolders(sortFilesByName(listing.folders));
    } catch (err) {
      setFolderPickerError(getErrorMessage(err));
      setFolderPickerFolders([]);
    } finally {
      setFolderPickerLoading(false);
    }
  }

  function closeFolderPicker() {
    setFolderPickerOpen(false);
    setFolderPickerFiles([]);
    setFolderPickerStack([]);
    setFolderPickerFolders([]);
    setFolderPickerError("");
    setFolderPickerSubmitting(null);
  }

  // Human: Open the folder picker for the current multi-selection.
  // Agent: WRITES folderPickerFiles from selectedFiles; LOADS root folders; OPENS dialog.
  function handleOpenFolderPicker() {
    if (selectedFiles.length < 2) return;
    setFolderPickerFiles(selectedFiles);
    setFolderPickerStack([]);
    setFolderPickerSubmitting(null);
    setFolderPickerError("");
    setFolderPickerOpen(true);
    void loadFolderPickerLevel(null);
  }

  // Human: Navigate the picker breadcrumb and refresh the folder listing for that level.
  // Agent: WRITES folderPickerStack; CALLS loadFolderPickerLevel with leaf id or null.
  function handleFolderPickerNavigate(stack: FolderPickerCrumb[]) {
    setFolderPickerStack(stack);
    void loadFolderPickerLevel(stack.at(-1)?.id ?? null);
  }

  const folderPickerTargetId = folderPickerStack.at(-1)?.id ?? null;

  // Human: Copy every selected file into the folder currently shown in the picker.
  // Agent: SEQUENTIAL POST /files/:id/copy; REFRESHES listing; CLEARS selection on success.
  async function handleFolderPickerCopy() {
    if (folderPickerFiles.length === 0) return;

    setFolderPickerSubmitting("copy");
    setFolderPickerError("");
    setError("");
    try {
      for (const file of folderPickerFiles) {
        await copyFile(file.id, folderPickerTargetId);
      }
      await refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
        silent: true,
      });
      setSelectedFileIds(new Set());
      closeFolderPicker();
    } catch (err) {
      const message = getErrorMessage(err);
      setFolderPickerError(message);
      setError(message);
    } finally {
      setFolderPickerSubmitting(null);
    }
  }

  // Human: Move selected files that are not already in the picker destination folder.
  // Agent: SKIPS same-folder rows; PATCH moveFile per file; REFRESHES; CLEARS selection.
  async function handleFolderPickerMove() {
    const toMove = folderPickerFiles.filter(
      (file) => (file.folder_id ?? null) !== folderPickerTargetId,
    );
    if (toMove.length === 0) {
      setFolderPickerError("Every selected file is already in this folder.");
      return;
    }

    setFolderPickerSubmitting("move");
    setFolderPickerError("");
    setError("");
    try {
      for (const file of toMove) {
        await moveFile(file.id, folderPickerTargetId);
      }
      await refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
        silent: true,
      });
      setSelectedFileIds(new Set());
      closeFolderPicker();
    } catch (err) {
      const message = getErrorMessage(err);
      setFolderPickerError(message);
      setError(message);
    } finally {
      setFolderPickerSubmitting(null);
    }
  }

  function handleDownload(file: FileItem) {
    if (isFileProcessing(file)) return;
    recordFileAccess(file.id);
    enqueueDownload(file);
  }

  // Human: Queue a compressed zip download for the selected folder tree.
  // Agent: CALLS enqueueFolderDownload; SHOWS compressing progress in DownloadTransferPanel.
  function handleDownloadFolder(folder: FolderItem) {
    enqueueFolderDownload(folder);
  }

  // Human: Open the HLS video preview dialog for a stored video file.
  // Agent: SETS previewVideo; VideoPreviewDialog POLLS until hls_ready.
  function handlePreviewVideo(file: FileItem) {
    if (isFileProcessing(file)) return;
    recordFileAccess(file.id);
    setPreviewVideo(file);
  }

  // Human: Open the folder-scoped image gallery on the clicked image.
  // Agent: SETS previewImage; ImagePreviewDialog NAVIGATES siblings sorted by filename.
  function handlePreviewImage(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isImageMime(file.mime_type)) return;
    recordFileAccess(file.id);
    setPreviewImage(file);
  }

  function handleGalleryImageChange(file: FileItem) {
    recordFileAccess(file.id);
    setPreviewImage(file);
  }

  const galleryImages = useMemo(() => {
    if (!previewImage) return [];
    return buildImageGallery(files, previewImage);
  }, [files, previewImage]);

  // Human: Open the public link dialog for one file.
  // Agent: SETS shareTarget + shareDialogOpen; ShareDialog CALLS POST /shares.
  function handleShareFile(file: FileItem) {
    if (isFileProcessing(file)) return;
    setShareTarget({ resource_type: "file", resource_id: file.id, name: file.name });
    setShareDialogOpen(true);
  }

  // Human: Open the public link dialog for one folder.
  // Agent: SETS shareTarget + shareDialogOpen; ShareDialog CALLS POST /shares.
  function handleShareFolder(folder: FolderItem) {
    setShareTarget({ resource_type: "folder", resource_id: folder.id, name: folder.name });
    setShareDialogOpen(true);
  }

  // Human: Re-fetch share indicators after creating or revoking a link from any dialog.
  // Agent: CALLS refreshShareFlags for current visible file/folder ids.
  function handleShareChanged() {
    void refreshShareFlags(
      files.map((file) => file.id),
      folders.map((folder) => folder.id),
    );
  }

  // Human: Open the details dialog on the metadata or sharing tab.
  // Agent: SETS detailsTarget + detailsInitialTab; ResourceDetailsDialog manages tabs.
  function handleDetailsFile(file: FileItem, tab: "details" | "sharing" = "details") {
    if (isFileProcessing(file)) return;
    setDetailsInitialTab(tab);
    setDetailsTarget({ kind: "file", file });
    setDetailsOpen(true);
  }

  function handleDetailsFolder(folder: FolderItem, tab: "details" | "sharing" = "details") {
    setDetailsInitialTab(tab);
    setDetailsTarget({ kind: "folder", folder });
    setDetailsOpen(true);
  }

  function handleToggleFavourite(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    if (file && isFileProcessing(file)) return;
    toggleFavouriteFile(fileId);
    setFavouriteIds(new Set(getFavouriteFileIds()));
  }

  // Human: Resolve selected ids to FileItem rows from the current in-memory listing.
  // Agent: READS files + selectedFileIds; RETURNS items still present in the library cache.
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileIds.has(file.id) && !isFileProcessing(file)),
    [files, selectedFileIds],
  );

  // Human: Queue downloads for checked files — one file directly, multiple as a zip archive.
  // Agent: CALLS enqueueDownload for single selection; CALLS enqueueBulkDownload for 2+ files.
  function handleBulkDownload() {
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length === 1) {
      recordFileAccess(selectedFiles[0]!.id);
      enqueueDownload(selectedFiles[0]!);
    } else {
      for (const file of selectedFiles) {
        recordFileAccess(file.id);
      }
      enqueueBulkDownload(selectedFiles);
    }
    setSelectedFileIds(new Set());
  }

  // Human: Favourite all selected files, or remove favourites when every selected file is starred.
  // Agent: READS favouriteIds; TOGGLES each selected id toward a uniform favourited state.
  function handleBulkToggleFavourite() {
    if (selectedFiles.length === 0) return;
    const allFavourited = selectedFiles.every((file) => favouriteIds.has(file.id));
    for (const file of selectedFiles) {
      const isFavourited = favouriteIds.has(file.id);
      if (allFavourited && isFavourited) {
        toggleFavouriteFile(file.id);
      } else if (!allFavourited && !isFavourited) {
        toggleFavouriteFile(file.id);
      }
    }
    setFavouriteIds(new Set(getFavouriteFileIds()));
    setSelectedFileIds(new Set());
  }

  // Human: Open bulk delete confirmation for the current checkbox selection.
  // Agent: MAPS selectedFiles to BulkDeleteItem list; WRITES bulkDeleteItems for dialog.
  function handleBulkDeleteRequest() {
    if (selectedFiles.length === 0) return;
    setBulkDeleteItems(
      selectedFiles.map((file) => ({
        id: file.id,
        name: file.name,
      })),
    );
  }

  // Human: Refresh drive state after bulk delete succeeds for one or more files.
  // Agent: CLEARS prefs + selection; CALLS refresh for the active My files view.
  function handleBulkDeleted(deletedIds: string[]) {
    setError("");
    for (const fileId of deletedIds) {
      removeFilePreferences(fileId);
    }
    setFavouriteIds(new Set(getFavouriteFileIds()));
    setSelectedFileIds(new Set());
    setBulkDeleteItems([]);
    void refreshDashboard();
    void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
      nav: activeNav,
    });
  }

  const bulkFavouriteLabel =
    selectedFiles.length > 0 &&
    selectedFiles.every((file) => favouriteIds.has(file.id))
      ? "Remove from favourites"
      : "Add to favourites";

  function handleNavChange(nav: NavItemId) {
    setActiveNav(nav);
    setSelectedFileIds(new Set());
    if (nav === "home") {
      setQuery("");
      setTypeFilter("all");
      setFolderStack([]);
    }
  }

  // Human: Open the bottom action sheet for one file or folder row on mobile.
  // Agent: WRITES mobileActionTarget + mobileActionsOpen; USED by FileListView ⋯ button.
  function handleOpenMobileActions(target: MobileActionTarget) {
    setMobileActionTarget(target);
    setMobileActionsOpen(true);
  }

  const usagePercent = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  const nameFilteredFiles =
    activeNav === "home" && query.trim()
      ? files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()))
      : files;
  // Human: Default browser order — A–Z with numeric segments (1, 2, 10 not 1, 10, 2).
  // Agent: MATCHES backend natural_sort_key; RE-SORTS loaded pages for consistent display.
  const browserFiles = useMemo(() => sortFilesByName(nameFilteredFiles), [nameFilteredFiles]);
  const visibleFolders = useMemo(
    () => (isSearchingMyFiles ? [] : sortFilesByName(folders)),
    [folders, isSearchingMyFiles],
  );
  const recentFiles = sortFilesByRecentAccess(nameFilteredFiles, 12);
  const favouriteFiles = pickFavouriteFiles(nameFilteredFiles);
  const sharedFiles: FileItem[] = [];
  const ownerLabel = user?.email?.split("@")[0]?.replace(/[._-]/g, " ") ?? "You";
  const initials = userInitials(user?.email);

  return (
    <DriveContextMenu
      files={files}
      folders={visibleFolders}
      favouriteIds={favouriteIds}
      activeNav={activeNav}
      selectedFileIds={selectedFileIds}
      onDownload={handleDownload}
      onDownloadFolder={handleDownloadFolder}
      onPreviewVideo={handlePreviewVideo}
      onPreviewImage={handlePreviewImage}
      onDelete={requestDeleteFile}
      onDeleteFolder={requestDeleteFolder}
      onToggleFavourite={handleToggleFavourite}
      onUpload={() => setUploadDialogOpen(true)}
      onCreateFolder={() => setCreateFolderDialogOpen(true)}
      onRefresh={() =>
        void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined)
      }
      onNavChange={handleNavChange}
      onShareFile={handleShareFile}
      onShareFolder={handleShareFolder}
      onDetailsFile={handleDetailsFile}
      onDetailsFolder={handleDetailsFolder}
      onCopyToFolder={handleOpenFolderPicker}
      onMoveToFolder={handleOpenFolderPicker}
    >
      {/* Human: Full-viewport shell — header stays fixed; only the main pane scrolls. */}
      {/* Agent: flex h-screen overflow-hidden; WRITES scroll containment on main, not document body. */}
      <div className="flex h-screen flex-col overflow-hidden bg-[#f3f2f1] text-neutral-900">
        <UploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          folderId={activeNav === "my-files" ? currentFolderId : null}
        />
        <CreateFolderDialog
          open={createFolderDialogOpen}
          onOpenChange={setCreateFolderDialogOpen}
          parentFolderId={currentFolderId}
          onFolderCreated={() =>
            void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
              silent: true,
            })
          }
        />
        <VideoPreviewDialog
          file={previewVideo}
          open={previewVideo !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewVideo(null);
          }}
        />
        <ImagePreviewDialog
          images={galleryImages}
          file={previewImage}
          open={previewImage !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewImage(null);
          }}
          onFileChange={handleGalleryImageChange}
        />
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          target={shareTarget}
          onShareChanged={handleShareChanged}
        />
        <ResourceDetailsDialog
          key={
            detailsTarget
              ? `${detailsTarget.kind}-${
                  detailsTarget.kind === "file" ? detailsTarget.file.id : detailsTarget.folder.id
                }-${detailsInitialTab}`
              : "details-closed"
          }
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          target={detailsTarget}
          initialTab={detailsInitialTab}
          onShareChanged={handleShareChanged}
        />
        <ConfirmDeleteDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) closeDeleteDialog();
          }}
          target={deleteTarget}
          folderPreview={folderDeletePreview}
          folderPreviewLoading={folderPreviewLoading}
          folderPreviewError={folderPreviewError}
          onDeleted={handleDeleted}
        />
        <ConfirmBulkDeleteDialog
          open={bulkDeleteItems.length > 0}
          onOpenChange={(open) => {
            if (!open) setBulkDeleteItems([]);
          }}
          items={bulkDeleteItems}
          onDeleted={handleBulkDeleted}
        />
        <FolderPickerDialog
          open={folderPickerOpen}
          onOpenChange={(open) => {
            if (!open) closeFolderPicker();
          }}
          files={folderPickerFiles}
          folderStack={folderPickerStack}
          folders={folderPickerFolders}
          loading={folderPickerLoading}
          error={folderPickerError}
          submitting={folderPickerSubmitting}
          onNavigate={handleFolderPickerNavigate}
          onCopy={handleFolderPickerCopy}
          onMove={handleFolderPickerMove}
        />
        <TransferPanelStack />
        <MobileSidebarSheet
          open={mobileSidebarOpen}
          onOpenChange={setMobileSidebarOpen}
          activeNav={activeNav}
          usedBytes={usedBytes}
          quotaBytes={quotaBytes}
          usagePercent={usagePercent}
          onNavChange={handleNavChange}
          onUpload={() => setUploadDialogOpen(true)}
          onCreateFolder={() => {
            setActiveNav("my-files");
            setCreateFolderDialogOpen(true);
          }}
          storageBar={<StorageUsageBar usedBytes={usedBytes} quotaBytes={quotaBytes} />}
        />
        <MobileFileActionsSheet
          target={mobileActionTarget}
          open={mobileActionsOpen}
          onOpenChange={(open) => {
            setMobileActionsOpen(open);
            if (!open) setMobileActionTarget(null);
          }}
          favouriteIds={favouriteIds}
          onDownload={handleDownload}
          onDownloadFolder={handleDownloadFolder}
          onToggleFavourite={handleToggleFavourite}
          onDelete={requestDeleteFile}
          onDeleteFolder={requestDeleteFolder}
          onShareFile={handleShareFile}
          onShareFolder={handleShareFolder}
          onDetailsFile={handleDetailsFile}
          onDetailsFolder={handleDetailsFolder}
          onCopyToFolder={handleOpenFolderPicker}
          onMoveToFolder={handleOpenFolderPicker}
          bulkSelectionCount={selectedFileIds.size}
        />
      {/* Top bar — profile avatar pinned on the far right */}
      <header className="shrink-0 border-b border-neutral-200 bg-white">
        <div className="grid h-[52px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-neutral-600 lg:hidden"
              aria-label="Open menu"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <LayoutGrid />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden text-neutral-600 lg:inline-flex"
              aria-label="App menu"
            >
              <LayoutGrid />
            </Button>
            <div className="flex size-7 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
              MV
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                Files
              </span>
            </div>
          </div>

          <div className="mx-auto w-full max-w-xl">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input
                className="h-9 rounded-full border-neutral-200 bg-[#f3f2f1] pl-9 shadow-none focus-visible:ring-blue-500/30"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search files"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-neutral-700 md:inline-flex"
            >
              Get more storage
            </Button>
            <Button variant="ghost" size="icon-sm" className="hidden text-neutral-600 sm:inline-flex" aria-label="Settings">
              <Settings />
            </Button>
            <div ref={profileRef} className="relative">
              <button
                type="button"
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
                className="flex size-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800 ring-2 ring-transparent transition hover:ring-blue-200"
              >
                {initials}
              </button>
              {profileOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-neutral-200 bg-white py-1 shadow-md">
                  <p className="truncate px-3 py-2 text-sm text-neutral-500">{user?.email}</p>
                  <Separator />
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
        {/* Left sidebar — pinned from header to viewport bottom; storage block uses mt-auto. */}
        {/* Agent: lg:h-full + overflow-hidden keeps sidebar fixed while main scrolls independently. */}
        <aside className="hidden shrink-0 flex-col gap-4 overflow-hidden border-b border-neutral-200 bg-white px-4 py-4 lg:flex lg:h-full lg:border-b-0 lg:border-r">
          <Button
            className="w-full justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => setUploadDialogOpen(true)}
          >
            <Upload data-icon="inline-start" />
            Create or upload
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center rounded-md border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
            onClick={() => {
              setActiveNav("my-files");
              setCreateFolderDialogOpen(true);
            }}
          >
            <FolderPlus data-icon="inline-start" />
            New folder
          </Button>

          <nav className="flex flex-col gap-0.5" aria-label="Drive navigation">
            <SidebarNavItem
              label="Home"
              active={activeNav === "home"}
              onClick={() => handleNavChange("home")}
            />
            <SidebarNavItem
              label="My files"
              active={activeNav === "my-files"}
              onClick={() => handleNavChange("my-files")}
            />
            <SidebarNavItem label="Shared" active={false} disabled />
            <SidebarNavItem label="Recycle bin" active={false} disabled />
          </nav>

          <Separator className="bg-neutral-200" />

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Browse files by
            </p>
            <SidebarNavItem label="People" active={false} disabled />
          </div>

          <div className="mt-auto flex flex-col gap-3 pt-6">
            <Button variant="ghost" size="sm" className="justify-start px-0 text-blue-700">
              Get more storage
            </Button>
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between text-xs font-medium text-neutral-700">
                <span>Storage</span>
                <span className="tabular-nums">{usagePercent}%</span>
              </div>
              <StorageUsageBar usedBytes={usedBytes} quotaBytes={quotaBytes} />
              <p className="text-xs text-neutral-600">
                {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
              </p>
            </div>
          </div>
        </aside>

        {/* Main content — Home hub vs My files browser; sole vertical scroll region below header. */}
        {/* Agent: min-h-0 overflow-y-auto; READS user scroll; sidebar sibling stays viewport-anchored. */}
        <main
          ref={mainScrollRef}
          className="min-h-0 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 lg:pb-6"
        >
          <div className="flex min-h-full flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:shadow-none md:p-6 lg:border lg:bg-white lg:p-6 lg:shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-semibold text-neutral-900">
                  {activeNav === "home" ? "Home" : "My files"}
                </h1>
                <p className="text-sm text-neutral-500">
                  {activeNav === "home"
                    ? "Recently accessed, favourites, and shared with you"
                    : "Browse everything in your library"}
                </p>
                {activeNav === "my-files" && folderStack.length > 0 ? (
                  <nav
                    className="flex flex-wrap items-center gap-1 text-sm text-neutral-600"
                    aria-label="Folder path"
                  >
                    <button
                      type="button"
                      onClick={() => goToFolderIndex(-1)}
                      className="rounded px-1 font-medium text-blue-700 hover:bg-blue-50"
                    >
                      My files
                    </button>
                    {folderStack.map((crumb, index) => (
                      <span key={crumb.id} className="flex items-center gap-1">
                        <ChevronRight className="size-3.5 text-neutral-400" aria-hidden />
                        <button
                          type="button"
                          onClick={() => goToFolderIndex(index)}
                          className={cn(
                            "rounded px-1 hover:bg-neutral-100",
                            index === folderStack.length - 1
                              ? "font-medium text-neutral-900"
                              : "text-blue-700 hover:bg-blue-50",
                          )}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                ) : null}
              </div>
              {activeNav === "my-files" ? (
                <div className="relative hidden w-full max-w-xs sm:block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                  <Input
                    className="h-9 pl-9"
                    placeholder="Filter by name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Filter files by name"
                  />
                </div>
              ) : null}
            </div>

            {activeNav === "my-files" ? (
              <div className="flex flex-wrap gap-2 lg:flex-wrap">
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
                {TYPE_FILTERS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTypeFilter(id)}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1 text-sm transition-colors",
                      typeFilter === id
                        ? "bg-blue-50 font-medium text-blue-700 ring-1 ring-blue-200"
                        : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
                </div>
                <div className="flex w-full gap-2 lg:hidden">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setCreateFolderDialogOpen(true)}
                  >
                    <FolderPlus data-icon="inline-start" />
                    New folder
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Separator className="hidden bg-neutral-200 lg:block" />

            {loading ? (
              <p className="py-12 text-center text-sm text-neutral-500">Loading files…</p>
            ) : activeNav === "home" ? (
              <div className="flex flex-col gap-8">
                <HomeSection
                  title="Recently accessed"
                  description="Files you opened or downloaded recently"
                  files={recentFiles}
                  ownerLabel={ownerLabel}
                  favouriteIds={favouriteIds}
                  locationLabel="My files"
                  emptyMessage="No recent files yet. Open or download something from My files."
                  onToggleFavourite={handleToggleFavourite}
                  onDelete={requestDeleteFile}
                  onDownload={handleDownload}
                  onPreviewVideo={handlePreviewVideo}
                  onPreviewImage={handlePreviewImage}
                  fileShareFlags={fileShareFlags}
                />
                <HomeSection
                  title="Favourites"
                  description="Files you starred for quick access"
                  files={favouriteFiles}
                  ownerLabel={ownerLabel}
                  favouriteIds={favouriteIds}
                  locationLabel="My files"
                  emptyMessage="No favourites yet. Star a file to pin it here."
                  onToggleFavourite={handleToggleFavourite}
                  onDelete={requestDeleteFile}
                  onDownload={handleDownload}
                  onPreviewVideo={handlePreviewVideo}
                  onPreviewImage={handlePreviewImage}
                  fileShareFlags={fileShareFlags}
                />
                <HomeSection
                  title="Shared with you"
                  description="Files other people shared with your account"
                  files={sharedFiles}
                  ownerLabel={ownerLabel}
                  favouriteIds={favouriteIds}
                  locationLabel="Shared"
                  emptyMessage="Nothing shared with you yet."
                  onToggleFavourite={handleToggleFavourite}
                  onDelete={requestDeleteFile}
                  onDownload={handleDownload}
                  onPreviewVideo={handlePreviewVideo}
                  onPreviewImage={handlePreviewImage}
                  fileShareFlags={fileShareFlags}
                />
              </div>
            ) : visibleFolders.length === 0 && browserFiles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <FileIcon className="size-10 text-neutral-400" />
                <p className="font-medium text-neutral-900">Nothing here yet</p>
                <p className="text-sm text-neutral-500">
                  Create a folder, upload a file, or change your search and filters.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCreateFolderDialogOpen(true)}
                  >
                    <FolderPlus data-icon="inline-start" />
                    New folder
                  </Button>
                  <Button
                    className="bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => setUploadDialogOpen(true)}
                  >
                    <Upload data-icon="inline-start" />
                    Upload files
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <BulkActionsBar
                  selectedCount={selectedFiles.length}
                  favouriteLabel={bulkFavouriteLabel}
                  onDownload={handleBulkDownload}
                  onToggleFavourite={handleBulkToggleFavourite}
                  onDelete={handleBulkDeleteRequest}
                  onClearSelection={() => setSelectedFileIds(new Set())}
                />
                <div className="hidden lg:block">
                <FileTable
                folders={visibleFolders}
                files={browserFiles}
                ownerLabel={ownerLabel}
                favouriteIds={favouriteIds}
                selectable
                selectedFileIds={selectedFileIds}
                onSelectedFileIdsChange={setSelectedFileIds}
                dragEnabled={!isSearchingMyFiles}
                locationLabel={
                  folderStack.length > 0
                    ? folderStack[folderStack.length - 1]?.name ?? "My files"
                    : "My files"
                }
                emptyMessage="No files in your library."
                onOpenFolder={openFolder}
                onDeleteFolder={requestDeleteFolder}
                onMoveFileToFolder={(fileId, folderId) =>
                  void handleMoveFileToFolder(fileId, folderId)
                }
                onToggleFavourite={handleToggleFavourite}
                onDelete={requestDeleteFile}
                onDownload={handleDownload}
                onPreviewVideo={handlePreviewVideo}
                onPreviewImage={handlePreviewImage}
                fileShareFlags={fileShareFlags}
                folderShareFlags={folderShareFlags}
                hasMoreFiles={hasMoreFiles}
                loadingMoreFiles={filesLoadingMore}
                onLoadMoreFiles={() => void loadMoreFiles()}
                hasMoreFolders={hasMoreFolders}
                loadingMoreFolders={foldersLoadingMore}
                onLoadMoreFolders={() => void loadMoreFolders()}
                scrollElementRef={mainScrollRef}
              />
                </div>
                <FileListView
                  folders={visibleFolders}
                  files={browserFiles}
                  ownerLabel={ownerLabel}
                  favouriteIds={favouriteIds}
                  selectable
                  selectedFileIds={selectedFileIds}
                  onSelectedFileIdsChange={setSelectedFileIds}
                  locationLabel={
                    folderStack.length > 0
                      ? folderStack[folderStack.length - 1]?.name ?? "My files"
                      : "My files"
                  }
                  emptyMessage="No files in your library."
                  onOpenFolder={openFolder}
                  onToggleFavourite={handleToggleFavourite}
                  onDelete={requestDeleteFile}
                  onDownload={handleDownload}
                  onPreviewVideo={handlePreviewVideo}
                  onPreviewImage={handlePreviewImage}
                  fileShareFlags={fileShareFlags}
                  folderShareFlags={folderShareFlags}
                  hasMoreFiles={hasMoreFiles}
                  loadingMoreFiles={filesLoadingMore}
                  onLoadMoreFiles={() => void loadMoreFiles()}
                  hasMoreFolders={hasMoreFolders}
                  loadingMoreFolders={foldersLoadingMore}
                  onLoadMoreFolders={() => void loadMoreFolders()}
                  scrollElementRef={mainScrollRef}
                  onOpenActions={handleOpenMobileActions}
                />
              </div>
            )}

            <p className="mt-auto hidden text-xs text-neutral-500 lg:block">
              {instanceName}
              {activeNav === "home"
                ? ` · ${recentFiles.length} recent · ${favouriteFiles.length} favourites`
                : ` · ${folderCount} folder${folderCount === 1 ? "" : "s"} · ${files.length} of ${fileCount} file${fileCount === 1 ? "" : "s"}`}
            </p>
          </div>
        </main>
      </div>
      <MobileBottomNav
        activeNav={activeNav}
        onNavChange={handleNavChange}
        onUpload={() => setUploadDialogOpen(true)}
      />
      </div>
    </DriveContextMenu>
  );
}
