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
} from "react";
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
  fetchDashboard,
  getErrorMessage,
  listFiles,
  listFolders,
  moveFile,
  type FileItem,
  type FolderItem,
} from "@/api/client";
import { BulkActionsBar } from "@/components/drive/BulkActionsBar";
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
import { VideoPreviewDialog } from "@/components/drive/VideoPreviewDialog";
import { DownloadTransferPanel } from "@/components/drive/DownloadTransferPanel";
import { UploadDialog } from "@/components/drive/UploadDialog";
import { enqueueDownload } from "@/lib/download-manager";
import { useAuth } from "@/hooks/useAuth";
import {
  fileMatchesTypeFilter,
  formatBytes,
  formatFileOpened,
  userInitials,
  type FileTypeFilter,
} from "@/lib/utils-app";
import {
  getFavouriteFileIds,
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
};

// Human: MIME payload key for HTML5 drag — keeps drop handler independent of React state timing.
// Agent: SET on dragstart; READ on drop to resolve which file was moved.
const FILE_DRAG_MIME = "application/x-mediavault-file-id";

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
}: FileTableProps) {
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const dragDepthRef = useRef<Map<string, number>>(new Map());
  const selectAllRef = useRef<HTMLInputElement>(null);
  // Human: Ref mirrors dragging id so dragOver handlers see it before React re-renders.
  // Agent: WRITES in dragstart; READS in folder dragenter/over; CLEARS on dragend.
  const draggingFileIdRef = useRef<string | null>(null);

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const selectionEnabled = selectable && selectedFileIds !== undefined && onSelectedFileIdsChange !== undefined;
  const visibleFileIds = useMemo(() => files.map((file) => file.id), [files]);
  const selectedVisibleCount = selectionEnabled
    ? visibleFileIds.filter((id) => selectedFileIds.has(id)).length
    : 0;
  const allVisibleSelected =
    selectionEnabled && visibleFileIds.length > 0 && selectedVisibleCount === visibleFileIds.length;
  const someVisibleSelected =
    selectionEnabled && selectedVisibleCount > 0 && selectedVisibleCount < visibleFileIds.length;

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
      for (const fileId of visibleFileIds) {
        next.add(fileId);
      }
    } else {
      for (const fileId of visibleFileIds) {
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
                    <span className="truncate font-medium text-neutral-900">{folder.name}</span>
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
          {files.map((file) => {
            const favourited = favouriteIds.has(file.id);
            const isDragging = draggingFileId === file.id;
            const isSelected = selectionEnabled && selectedFileIds.has(file.id);
            return (
              <tr
                key={file.id}
                data-file-id={file.id}
                draggable={dragEnabled}
                onDragStart={(event) => handleFileDragStart(event, file.id)}
                onDragEnd={resetDragState}
                className={cn(
                  "border-b border-neutral-100 transition-colors hover:bg-neutral-50",
                  dragEnabled && "cursor-grab active:cursor-grabbing",
                  isDragging && "opacity-50",
                  isSelected && "bg-blue-50/60",
                )}
              >
                {selectionEnabled ? (
                  <td className="w-10 py-3 pr-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                      checked={isSelected}
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
                      <span className="truncate font-medium text-neutral-900">{file.name}</span>
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
                      onClick={() => onToggleFavourite(file.id)}
                      aria-label={favourited ? `Unfavourite ${file.name}` : `Favourite ${file.name}`}
                      className={cn(favourited && "text-amber-500 hover:text-amber-600")}
                    >
                      <Star className={cn("size-4", favourited && "fill-current")} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDownload(file)}
                      aria-label={`Download ${file.name}`}
                    >
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(file.id)}
                      aria-label={`Delete ${file.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
}: FileGridProps) {
  if (files.length === 0) {
    return <p className="py-6 text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {files.map((file) => {
        const favourited = favouriteIds.has(file.id);
        return (
          <article
            key={file.id}
            data-file-id={file.id}
            className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-blue-200 hover:shadow-sm"
          >
            <div className="relative flex aspect-[4/3] items-center justify-center bg-[#f3f2f1]">
              <FileGridPreview mimeType={file.mime_type} />
              <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "size-7 bg-white/90 hover:bg-white",
                    favourited && "text-amber-500 hover:text-amber-600",
                  )}
                  onClick={() => onToggleFavourite(file.id)}
                  aria-label={favourited ? `Unfavourite ${file.name}` : `Favourite ${file.name}`}
                >
                  <Star className={cn("size-3.5", favourited && "fill-current")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 bg-white/90 hover:bg-white"
                  onClick={() => onDownload(file)}
                  aria-label={`Download ${file.name}`}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 bg-white/90 hover:bg-white"
                  onClick={() => onDelete(file.id)}
                  aria-label={`Delete ${file.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1 px-3 py-2.5">
              <p className="truncate text-sm font-medium text-neutral-900" title={file.name}>
                {file.name}
              </p>
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
  const [bulkDeleteItems, setBulkDeleteItems] = useState<BulkDeleteItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(
    () => new Set(getFavouriteFileIds()),
  );
  const [previewVideo, setPreviewVideo] = useState<FileItem | null>(null);

  const currentFolderId = folderStack.at(-1)?.id ?? null;

  // Human: Remove selected ids that no longer exist in the current file listing (delete, move, refresh).
  // Agent: INTERSECTS selectedFileIds with validFiles; SKIPS setState when nothing changed.
  function pruneFileSelection(validFiles: FileItem[]) {
    const validIds = new Set(validFiles.map((file) => file.id));
    setSelectedFileIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }

  const refresh = useCallback(
    async (
      search?: string,
      options?: { silent?: boolean; folderId?: string | null },
    ) => {
      if (!options?.silent) {
        setLoading(true);
      }
      setError("");
      try {
        const targetFolderId =
          options?.folderId !== undefined ? options.folderId : currentFolderId;
        const dashboard = await fetchDashboard();
        setInstanceName(dashboard.instance_name);
        setUsedBytes(dashboard.used_bytes);
        setQuotaBytes(dashboard.quota_bytes || 1);

        if (search) {
          const listing = await listFiles({ q: search });
          setFolders([]);
          setFiles(listing.files);
          pruneFileSelection(listing.files);
        } else {
          const [folderListing, fileListing] = await Promise.all([
            listFolders(targetFolderId ? { parent_id: targetFolderId } : undefined),
            listFiles(targetFolderId ? { folder_id: targetFolderId } : undefined),
          ]);
          setFolders(folderListing.folders);
          setFiles(fileListing.files);
          pruneFileSelection(fileListing.files);
        }
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [currentFolderId],
  );

  // Human: Refresh file list and quota after uploads without replacing the whole view with a spinner.
  // Agent: CALLS refresh silent; WRITES recent access for uploaded ids so Home shows new files.
  const handleUploadsComplete = useCallback(
    ({ fileIds }: { fileIds: string[] }) => {
      for (const fileId of fileIds) {
        recordFileAccess(fileId);
      }
      void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
        silent: true,
      });
    },
    [activeNav, query, refresh],
  );

  // Human: Load dashboard + file list when the page opens or the debounced search query changes.
  // Agent: DEBOUNCES query 300ms on My files; Home loads full library without name filter.
  useEffect(() => {
    let cancelled = false;
    const searchOnMyFiles = activeNav === "my-files" ? query.trim() : "";
    const delay = searchOnMyFiles ? 300 : 0;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void refresh(searchOnMyFiles || undefined);
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, refresh, activeNav, folderStack]);

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
    if (!file) return;
    setDeleteTarget({ kind: "file", id: fileId, name: file.name });
  }

  // Human: Open the delete confirmation dialog for a folder row action.
  // Agent: READS folders state for display name; WRITES deleteTarget.
  function requestDeleteFolder(folderId: string) {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    setDeleteTarget({ kind: "folder", id: folderId, name: folder.name });
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
    void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined);
  }

  // Human: Persist a drag-and-drop move by updating the file's folder_id on the API.
  // Agent: CALLS moveFile; REFRESHES listing silently so the row disappears from the current folder.
  async function handleMoveFileToFolder(fileId: string, folderId: string) {
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

  function handleDownload(file: FileItem) {
    recordFileAccess(file.id);
    enqueueDownload(file);
  }

  // Human: Open the HLS video preview dialog for a stored video file.
  // Agent: SETS previewVideo; VideoPreviewDialog POLLS until hls_ready.
  function handlePreviewVideo(file: FileItem) {
    recordFileAccess(file.id);
    setPreviewVideo(file);
  }

  function handleToggleFavourite(fileId: string) {
    toggleFavouriteFile(fileId);
    setFavouriteIds(new Set(getFavouriteFileIds()));
  }

  // Human: Resolve selected ids to FileItem rows from the current in-memory listing.
  // Agent: READS files + selectedFileIds; RETURNS items still present in the library cache.
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileIds.has(file.id)),
    [files, selectedFileIds],
  );

  // Human: Queue downloads for every checked file and record recent access for Home.
  // Agent: CALLS enqueueDownload per selection; CLEARS bulk selection after enqueue.
  function handleBulkDownload() {
    for (const file of selectedFiles) {
      recordFileAccess(file.id);
      enqueueDownload(file);
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
    void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined);
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

  const usagePercent = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  const nameFilteredFiles =
    activeNav === "home" && query.trim()
      ? files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()))
      : files;
  const browserFiles = files.filter((file) => fileMatchesTypeFilter(file.mime_type, typeFilter));
  const isSearchingMyFiles = activeNav === "my-files" && query.trim().length > 0;
  const visibleFolders = isSearchingMyFiles ? [] : folders;
  const recentFiles = sortFilesByRecentAccess(nameFilteredFiles, 12);
  const favouriteFiles = pickFavouriteFiles(nameFilteredFiles);
  const sharedFiles: FileItem[] = [];
  const ownerLabel = user?.email?.split("@")[0]?.replace(/[._-]/g, " ") ?? "You";
  const initials = userInitials(user?.email);

  return (
    <DriveContextMenu
      files={files}
      favouriteIds={favouriteIds}
      activeNav={activeNav}
      onDownload={handleDownload}
      onPreviewVideo={handlePreviewVideo}
      onDelete={requestDeleteFile}
      onToggleFavourite={handleToggleFavourite}
      onUpload={() => setUploadDialogOpen(true)}
      onCreateFolder={() => setCreateFolderDialogOpen(true)}
      onRefresh={() =>
        void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined)
      }
      onNavChange={handleNavChange}
    >
      <div className="min-h-screen bg-[#f3f2f1] text-neutral-900">
        <UploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          folderId={activeNav === "my-files" ? currentFolderId : null}
          onUploadsComplete={handleUploadsComplete}
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
        <ConfirmDeleteDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          target={deleteTarget}
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
        <DownloadTransferPanel />
      {/* Top bar — profile avatar pinned on the far right */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="grid h-[52px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" className="text-neutral-600" aria-label="App menu">
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
            <Button variant="ghost" size="icon-sm" className="text-neutral-600" aria-label="Settings">
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

      <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Left sidebar */}
        <aside className="flex flex-col gap-4 border-b border-neutral-200 bg-white px-4 py-4 lg:border-b-0 lg:border-r">
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

        {/* Main content — Home hub vs My files browser */}
        <main className="p-4 md:p-6">
          <div className="flex min-h-[640px] flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm md:p-6">
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
                <div className="relative w-full max-w-xs">
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
              <div className="flex flex-wrap gap-2">
                {TYPE_FILTERS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTypeFilter(id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm transition-colors",
                      typeFilter === id
                        ? "bg-blue-50 font-medium text-blue-700 ring-1 ring-blue-200"
                        : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Separator className="bg-neutral-200" />

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
              />
              </div>
            )}

            <p className="mt-auto text-xs text-neutral-500">
              {instanceName}
              {activeNav === "home"
                ? ` · ${recentFiles.length} recent · ${favouriteFiles.length} favourites`
                : ` · ${visibleFolders.length} folder${visibleFolders.length === 1 ? "" : "s"} · ${browserFiles.length} file${browserFiles.length === 1 ? "" : "s"} shown`}
            </p>
          </div>
        </main>
      </div>
      </div>
    </DriveContextMenu>
  );
}
