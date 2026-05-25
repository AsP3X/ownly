// Human: OneDrive-style drive shell — top bar, sidebar, recent files table on a light theme.
// Agent: CALLS listFiles/uploadFile/deleteFile/fetchDashboard; READS auth user for profile chip.

import { useCallback, useEffect, useRef, useState } from "react";
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
  deleteFile,
  deleteFolder,
  fetchDashboard,
  getErrorMessage,
  listFiles,
  listFolders,
  type FileItem,
  type FolderItem,
} from "@/api/client";
import { CreateFolderDialog } from "@/components/drive/CreateFolderDialog";
import { DriveContextMenu } from "@/components/drive/DriveContextMenu";
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
  onOpenFolder?: (folder: FolderItem) => void;
  onDeleteFolder?: (folderId: string) => void;
  onToggleFavourite: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  onDownload: (file: FileItem) => void;
};

// Human: Reusable file rows table for the My files browser, with optional folder rows first.
// Agent: RENDERS folder navigation + download/delete/favourite actions; CALLS onOpenFolder for drill-down.
function FileTable({
  folders = [],
  files,
  ownerLabel,
  favouriteIds,
  locationLabel = "My files",
  emptyMessage,
  onOpenFolder,
  onDeleteFolder,
  onToggleFavourite,
  onDelete,
  onDownload,
}: FileTableProps) {
  if (folders.length === 0 && files.length === 0) {
    return <p className="py-6 text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="pb-3 pr-4 font-medium">Name</th>
            <th className="pb-3 pr-4 font-medium">Opened</th>
            <th className="pb-3 pr-4 font-medium">Owner</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr
              key={folder.id}
              data-folder-id={folder.id}
              className="border-b border-neutral-100 transition-colors hover:bg-neutral-50"
            >
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
                <div className="flex items-center justify-end gap-1">
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
          ))}
          {files.map((file) => {
            const favourited = favouriteIds.has(file.id);
            return (
              <tr
                key={file.id}
                data-file-id={file.id}
                className="border-b border-neutral-100 transition-colors hover:bg-neutral-50"
              >
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
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(
    () => new Set(getFavouriteFileIds()),
  );

  const currentFolderId = folderStack.at(-1)?.id ?? null;

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
        } else {
          const [folderListing, fileListing] = await Promise.all([
            listFolders(targetFolderId ? { parent_id: targetFolderId } : undefined),
            listFiles(targetFolderId ? { folder_id: targetFolderId } : undefined),
          ]);
          setFolders(folderListing.folders);
          setFiles(fileListing.files);
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
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function goToFolderIndex(index: number) {
    if (index < 0) {
      setFolderStack([]);
      return;
    }
    setFolderStack((prev) => prev.slice(0, index + 1));
  }

  async function handleDeleteFolder(id: string) {
    setError("");
    try {
      await deleteFolder(id);
      setFolderStack((prev) => prev.filter((crumb) => crumb.id !== id));
      await refresh(activeNav === "my-files" ? query.trim() || undefined : undefined);
    } catch (e) {
      setError(getErrorMessage(e));
    }
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

  async function handleDelete(id: string) {
    setError("");
    try {
      await deleteFile(id);
      removeFilePreferences(id);
      setFavouriteIds(new Set(getFavouriteFileIds()));
      await refresh(activeNav === "my-files" ? query.trim() || undefined : undefined);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  function handleDownload(file: FileItem) {
    recordFileAccess(file.id);
    enqueueDownload(file);
  }

  function handleToggleFavourite(fileId: string) {
    toggleFavouriteFile(fileId);
    setFavouriteIds(new Set(getFavouriteFileIds()));
  }

  function handleNavChange(nav: NavItemId) {
    setActiveNav(nav);
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
      onDelete={(id) => void handleDelete(id)}
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
                  onDelete={(id) => void handleDelete(id)}
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
                  onDelete={(id) => void handleDelete(id)}
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
                  onDelete={(id) => void handleDelete(id)}
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
              <FileTable
                folders={visibleFolders}
                files={browserFiles}
                ownerLabel={ownerLabel}
                favouriteIds={favouriteIds}
                locationLabel={
                  folderStack.length > 0
                    ? folderStack[folderStack.length - 1]?.name ?? "My files"
                    : "My files"
                }
                emptyMessage="No files in your library."
                onOpenFolder={openFolder}
                onDeleteFolder={(id) => void handleDeleteFolder(id)}
                onToggleFavourite={handleToggleFavourite}
                onDelete={(id) => void handleDelete(id)}
                onDownload={handleDownload}
              />
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
