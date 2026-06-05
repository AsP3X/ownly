// Human: Drive shell — sidebar, Home overview, and My Cloud explorer per Pencil wireframes.
// Agent: CALLS listFiles/uploadFile/fetchDashboard; READS auth user for profile chip.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  batchFiles,
  buildShareFlagMaps,
  fetchFile,
  fetchFolderDeletionPreview,
  fetchRecycleBin,
  fetchShareStatusBulk,
  fetchSharedByMe,
  fetchSharedWithMe,
  FILES_PAGE_SIZE,
  getErrorMessage,
  copyFile,
  listFiles,
  listFolders,
  moveFile,
  type FileItem,
  type FolderDeletionPreview,
  type FolderItem,
  type RecycleBinResponse,
  type ShareFlags,
  type SharedByMeItem,
  type SharedByMeMetrics,
  type SharedWithMeItem,
} from "@/api/client";
import { BulkActionsBar } from "@/components/drive/BulkActionsBar";
import {
  MobileFileActionsSheet,
  type MobileActionTarget,
} from "@/components/drive/MobileFileActionsSheet";
import { MobileBottomNav } from "@/components/drive/MobileBottomNav";
import { DriveDesktopTopbar } from "@/components/drive/DriveDesktopTopbar";
import { MobileDriveHeader } from "@/components/drive/MobileDriveHeader";
import { DriveCloudExplorer } from "@/components/drive/DriveCloudExplorer";
import { DriveOverviewPanel } from "@/components/drive/DriveOverviewPanel";
import { DriveSidebar, type DriveNavId } from "@/components/drive/DriveSidebar";
import { SharedFilesPanel } from "@/components/drive/SharedFilesPanel";
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
import { DynamicImportPreview, loadAudioPreviewDialog, loadExcelSpreadsheetDialog, loadImagePreviewDialog, loadPdfPreviewDialog, loadTextCodeEditorDialog, loadVideoPreviewDialog } from "@/lib/dynamic-import-preview";
import { TransferPanelStack } from "@/components/drive/TransferPanelStack";
import { UploadDialog } from "@/components/drive/UploadDialog";
import { effectiveRemainingFromDashboard } from "@/lib/upload-storage-capacity";
import { RecycleBinPanel } from "@/components/drive/RecycleBinPanel";
import {
  subscribeUploadFileComplete,
  subscribeUploadFileRegistered,
} from "@/lib/upload-manager";
import { isFileProcessing } from "@/lib/file-processing";
import { enqueueDownload, enqueueBulkDownload, enqueueFolderDownload } from "@/lib/download-manager";
import { useInstanceName } from "@/hooks/useInstanceName";
import { useAuth } from "@/hooks/useAuth";
import { useDriveUrlState } from "@/hooks/useDriveUrlState";
import {
  buildAudioGallery,
  buildImageGallery,
  buildTextCodeGallery,
  buildVideoGallery,
  isAudioMime,
  isImageMime,
  isPdfMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
  sortFilesByName,
  userInitials,
  userRoleLabel,
  type FileTypeFilter,
} from "@/lib/utils-app";
import { displayNameFromEmail } from "@/lib/public-share-format";
import {
  getFavouriteFileIds,
  getRecentFileIds,
  recordFileAccess,
  removeFilePreferences,
  sortFilesByRecentAccess,
  toggleFavouriteFile,
} from "@/lib/drive-preferences";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

type NavItemId = DriveNavId;
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
  const { instanceName, dashboard, refreshDashboard: refreshDashboardShared } = useInstanceName();
  // Human: Mobile profile menu anchor — desktop topbar uses an inline Sign Out button instead.
  // Agent: mobileProfileRef; WRITTEN by MobileDriveHeader; READ by outside-click dismiss handler.
  const mobileProfileRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>("all");
  const [activeNav, setActiveNav] = useState<NavItemId>("home");
  // Human: Mirror drive view/folder/search into the URL so reload restores the same screen.
  // Agent: CALLS useDriveUrlState; READS/WRITES ?view &folder &q &type on pathname /.
  useDriveUrlState({
    activeNav,
    folderStack,
    query,
    typeFilter,
    setActiveNav,
    setFolderStack,
    setQuery,
    setTypeFilter,
  });
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(1);
  const [effectiveRemainingBytes, setEffectiveRemainingBytes] = useState(
    Number.POSITIVE_INFINITY,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const profileDisplayName = useMemo(
    () => (user?.email ? displayNameFromEmail(user.email) : "Account"),
    [user],
  );
  const profileRoleLabel = useMemo(() => userRoleLabel(user?.role), [user]);

  // Human: End the session from profile menus — mousedown avoids click being swallowed by overlapping layers.
  // Agent: WRITES profileOpen false; CALLS logout; USED by desktop + mobile profile menus.
  const handleSignOut = useCallback(() => {
    setProfileOpen(false);
    logout();
  }, [logout]);

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
  const [previewPdf, setPreviewPdf] = useState<FileItem | null>(null);
  const [previewText, setPreviewText] = useState<FileItem | null>(null);
  const [previewSpreadsheet, setPreviewSpreadsheet] = useState<FileItem | null>(null);
  const [previewAudio, setPreviewAudio] = useState<FileItem | null>(null);
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
  const [recycleBinData, setRecycleBinData] = useState<RecycleBinResponse | null>(null);
  const [recycleBinError, setRecycleBinError] = useState("");
  const [sharedWithMeItems, setSharedWithMeItems] = useState<SharedWithMeItem[]>([]);
  const [sharedByMeItems, setSharedByMeItems] = useState<SharedByMeItem[]>([]);
  const [sharedByMeMetrics, setSharedByMeMetrics] = useState<SharedByMeMetrics | null>(null);
  const [sharedFilesLoading, setSharedFilesLoading] = useState(false);
  const [sharedFilesError, setSharedFilesError] = useState("");

  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const isSearchingMyFiles = activeNav === "my-files" && query.trim().length > 0;
  const serverTypeFilter = typeFilter !== "all" ? typeFilter : undefined;
  const dashboardLoadedRef = useRef(false);

  // Human: Mirror shared dashboard stats into local drive UI state when the provider fetch completes.
  // Agent: READS dashboard from InstanceNameProvider; WRITES used/quota/effective remaining bytes.
  useEffect(() => {
    if (!dashboard) return;
    setUsedBytes(dashboard.used_bytes);
    setQuotaBytes(dashboard.quota_bytes || 1);
    setEffectiveRemainingBytes(effectiveRemainingFromDashboard(dashboard));
    dashboardLoadedRef.current = true;
  }, [dashboard]);

  // Human: Storage summary for the sidebar and upload preflight — includes network node headroom.
  // Agent: CALLS shared refreshDashboard; WRITES local quota state from returned payload.
  const refreshDashboard = useCallback(async (): Promise<number> => {
    const nextDashboard = await refreshDashboardShared();
    if (!nextDashboard) {
      return Number.POSITIVE_INFINITY;
    }
    setUsedBytes(nextDashboard.used_bytes);
    setQuotaBytes(nextDashboard.quota_bytes || 1);
    const effective = effectiveRemainingFromDashboard(nextDashboard);
    setEffectiveRemainingBytes(effective);
    dashboardLoadedRef.current = true;
    return effective;
  }, [refreshDashboardShared]);

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
        if (nav === "recycle-bin") {
          setFolders([]);
          setFiles([]);
          setFileCount(0);
          setHasMoreFiles(false);
          setFolderCount(0);
          setHasMoreFolders(false);
          setFileShareFlags({});
          setFolderShareFlags({});
          setSelectedFileIds(new Set());
          try {
            const data = await fetchRecycleBin();
            setRecycleBinData(data);
            setRecycleBinError("");
          } catch (err) {
            setRecycleBinData(null);
            setRecycleBinError(getErrorMessage(err));
          }
          return;
        }

        if (nav === "shared-files") {
          setFolders([]);
          setFiles([]);
          setFileCount(0);
          setHasMoreFiles(false);
          setFolderCount(0);
          setHasMoreFolders(false);
          setFileShareFlags({});
          setFolderShareFlags({});
          setSelectedFileIds(new Set());
          setRecycleBinData(null);
          setRecycleBinError("");
          return;
        }

        const targetFolderId =
          options?.folderId !== undefined ? options.folderId : currentFolderId;

        if (nav === "home" && !search) {
          const recentIds = getRecentFileIds().slice(0, FILES_PAGE_SIZE);
          const [folderListing, { files: recentBatch }] = await Promise.all([
            listFolders({ limit: FILES_PAGE_SIZE, offset: 0 }),
            batchFiles(recentIds, "minimal"),
          ]);
          setFolders(folderListing.folders);
          setFiles(recentBatch);
          setFileCount(recentBatch.length);
          setHasMoreFiles(false);
          setFolderCount(folderListing.folder_count);
          setHasMoreFolders(folderListing.has_more);
          const flags = buildShareFlagMaps(recentBatch, folderListing.folders);
          setFileShareFlags(flags.files);
          setFolderShareFlags(flags.folders);
          pruneFileSelection(recentBatch);
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

  // Human: Load Shared Files tab data when the sidebar nav selects that view.
  // Agent: GET /shares/with-me + /shares/by-me; WRITES shared* state for SharedFilesPanel.
  const refreshSharedFiles = useCallback(async () => {
    setSharedFilesLoading(true);
    setSharedFilesError("");
    try {
      const [withMe, byMe] = await Promise.all([fetchSharedWithMe(), fetchSharedByMe()]);
      setSharedWithMeItems(withMe.items);
      setSharedByMeItems(byMe.items);
      setSharedByMeMetrics(byMe.metrics);
    } catch (err) {
      setSharedFilesError(getErrorMessage(err));
    } finally {
      setSharedFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeNav !== "shared-files") return;
    void refreshSharedFiles();
  }, [activeNav, refreshSharedFiles]);

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

  // Human: Refresh the drive listing when the server registers a new upload so row badges show ingest progress.
  // Agent: SUBSCRIBES subscribeUploadFileRegistered; CALLS refresh silent on POST /files/upload response.
  useEffect(() => {
    return subscribeUploadFileRegistered(() => {
      void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
        silent: true,
        nav: activeNav,
      });
    });
  }, [activeNav, query, refresh]);

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

  // Human: Close the mobile profile menu when clicking outside the avatar cluster.
  // Agent: LISTENS document mousedown; READS mobileProfileRef; WRITES profileOpen false when outside.
  useEffect(() => {
    if (!profileOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const insideMobile = mobileProfileRef.current?.contains(target) ?? false;
      if (!insideMobile) {
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

  // Human: Open the in-browser PDF viewer for stored application/pdf files.
  // Agent: SETS previewPdf; PdfPreviewDialog FETCHES bytes and RENDERS pages via pdf.js.
  function handlePreviewPdf(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isPdfMime(file.mime_type)) return;
    recordFileAccess(file.id);
    setPreviewPdf(file);
  }

  // Human: Open the in-browser text/code editor for editable plain-text and source files.
  // Agent: SETS previewText; TextCodeEditorDialog FETCHES bytes and RENDERS themed editor chrome.
  function handlePreviewText(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isTextCodePreviewMime(file.mime_type, file.name)) return;
    recordFileAccess(file.id);
    setPreviewText(file);
  }

  // Human: Open the Excel-style spreadsheet dialog for .xlsx/.xls/.ods workbooks.
  // Agent: SETS previewSpreadsheet; ExcelSpreadsheetDialog FETCHES blob and PARSES via SheetJS.
  function handlePreviewSpreadsheet(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isSpreadsheetPreviewMime(file.mime_type, file.name)) return;
    recordFileAccess(file.id);
    setPreviewSpreadsheet(file);
  }

  // Human: Open the Aurora-style audio player for stored audio/* files.
  // Agent: SETS previewAudio; AudioPreviewDialog FETCHES blob URL and RENDERS transport UI.
  function handlePreviewAudio(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isAudioMime(file.mime_type)) return;
    recordFileAccess(file.id);
    setPreviewAudio(file);
  }

  function handleGalleryImageChange(file: FileItem) {
    recordFileAccess(file.id);
    setPreviewImage(file);
  }

  const galleryImages = useMemo(() => {
    if (!previewImage) return [];
    return buildImageGallery(files, previewImage);
  }, [files, previewImage]);

  const galleryAudio = useMemo(() => {
    if (!previewAudio) return [];
    return buildAudioGallery(files, previewAudio);
  }, [files, previewAudio]);

  const galleryVideos = useMemo(() => {
    if (!previewVideo) return [];
    return buildVideoGallery(files, previewVideo);
  }, [files, previewVideo]);

  const galleryTextFiles = useMemo(() => {
    if (!previewText) return [];
    return buildTextCodeGallery(files, previewText);
  }, [files, previewText]);

  const textEditorBranchLabel = folderStack.at(-1)?.name ?? "My Cloud";

  function handleGalleryAudioChange(file: FileItem) {
    recordFileAccess(file.id);
    setPreviewAudio(file);
  }

  function handleGalleryTextChange(file: FileItem) {
    recordFileAccess(file.id);
    setPreviewText(file);
  }

  function handleTextFileSaved(previousId: string, savedFile: FileItem) {
    setFiles((current) =>
      current.map((item) => (item.id === previousId ? savedFile : item)),
    );
    void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
      silent: true,
      nav: activeNav,
    });
  }

  function handleSpreadsheetFileSaved(previousId: string, savedFile: FileItem) {
    setFiles((current) =>
      current.map((item) => (item.id === previousId ? savedFile : item)),
    );
    setPreviewSpreadsheet(savedFile);
    void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
      silent: true,
      nav: activeNav,
    });
  }

  function handleGalleryVideoChange(file: FileItem) {
    recordFileAccess(file.id);
    setPreviewVideo(file);
  }

  // Human: Sync selected poster index into drive listings after the thumbnail picker saves.
  // Agent: UPDATES files + previewVideo rows; KEEPS grid ExplorerVideoThumbnail key in sync.
  function handleVideoThumbnailSelected(file: FileItem, selectedIndex: number) {
    const patch = (item: FileItem): FileItem =>
      item.id === file.id ? { ...item, video_thumbnail_selected_index: selectedIndex } : item;
    setFiles((current) => current.map(patch));
    setPreviewVideo((current) => (current?.id === file.id ? patch(current) : current));
    setDetailsTarget((current) =>
      current?.kind === "file" && current.file.id === file.id
        ? { kind: "file", file: patch(current.file) }
        : current,
    );
  }

  // Human: Sync thumbnail job fields into drive listings after regenerate or polling updates.
  // Agent: MERGES video_thumbnail_* from API; UPDATES files, details, and preview video rows.
  function handleVideoThumbnailUpdated(file: FileItem) {
    const patch = (item: FileItem): FileItem =>
      item.id === file.id
        ? {
            ...item,
            video_thumbnail_ready: file.video_thumbnail_ready,
            video_thumbnail_status: file.video_thumbnail_status,
            video_thumbnail_error: file.video_thumbnail_error,
            video_thumbnail_progress: file.video_thumbnail_progress,
            video_thumbnail_selected_index: file.video_thumbnail_selected_index,
          }
        : item;
    setFiles((current) => current.map(patch));
    setPreviewVideo((current) => (current?.id === file.id ? patch(current) : current));
    setDetailsTarget((current) =>
      current?.kind === "file" && current.file.id === file.id
        ? { kind: "file", file: patch(current.file) }
        : current,
    );
  }

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
    if (activeNav === "shared-files") {
      void refreshSharedFiles();
    }
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
    if (nav === "home" || nav === "recycle-bin" || nav === "shared-files") {
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
  // Human: File ids in the current explorer listing that accept bulk selection (skips processing).
  // Agent: READS browserFiles; USED by Select all control and Ctrl+A on My files.
  const selectableBrowserFileIds = useMemo(
    () => browserFiles.filter((file) => !isFileProcessing(file)).map((file) => file.id),
    [browserFiles],
  );
  const allBrowserFilesSelected =
    selectableBrowserFileIds.length > 0 &&
    selectableBrowserFileIds.every((fileId) => selectedFileIds.has(fileId));

  // Human: Add every visible, selectable file to the current bulk selection.
  // Agent: MERGES selectableBrowserFileIds into selectedFileIds Set.
  const handleSelectAllBrowserFiles = useCallback(() => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      for (const fileId of selectableBrowserFileIds) {
        next.add(fileId);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [selectableBrowserFileIds]);

  const visibleFolders = useMemo(
    () => (isSearchingMyFiles ? [] : sortFilesByName(folders)),
    [folders, isSearchingMyFiles],
  );
  const recentFiles = sortFilesByRecentAccess(nameFilteredFiles, 12);
  const overviewFolders = useMemo(
    () => (activeNav === "home" ? sortFilesByName(folders) : []),
    [activeNav, folders],
  );
  const initials = userInitials(user?.email);

  // Human: Ctrl+A (Cmd+A on macOS) selects all files in the current folder listing.
  // Agent: LISTENS document keydown on my-files; SKIPS inputs and contenteditable targets.
  useEffect(() => {
    if (activeNav !== "my-files" || selectableBrowserFileIds.length === 0) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          return;
        }
        if (target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      handleSelectAllBrowserFiles();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeNav, handleSelectAllBrowserFiles, selectableBrowserFileIds.length]);

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
      onPreviewPdf={handlePreviewPdf}
      onPreviewText={handlePreviewText}
      onPreviewSpreadsheet={handlePreviewSpreadsheet}
      onPreviewAudio={handlePreviewAudio}
      onDelete={requestDeleteFile}
      onDeleteFolder={requestDeleteFolder}
      onBulkDelete={handleBulkDeleteRequest}
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
          effectiveRemainingBytes={effectiveRemainingBytes}
          onRefreshStorageLimits={refreshDashboard}
          onLibraryChanged={() =>
            void refresh(activeNav === "my-files" ? query.trim() || undefined : undefined, {
              silent: true,
              nav: activeNav,
            })
          }
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
        {/* Human: Media preview dialogs load dedicated chunks on first open via dynamic import(). */}
        {/* Agent: DynamicImportPreview + load*PreviewDialog; MOUNTS only when preview state is non-null. */}
        {previewVideo !== null ? (
          <DynamicImportPreview
            loader={loadVideoPreviewDialog}
            previewProps={{
              videos: galleryVideos,
              file: previewVideo,
              open: true,
              onOpenChange: (open) => {
                if (!open) setPreviewVideo(null);
              },
              onFileChange: handleGalleryVideoChange,
              onDownload: handleDownload,
              onShare: handleShareFile,
            }}
          />
        ) : null}
        {previewImage !== null ? (
          <DynamicImportPreview
            loader={loadImagePreviewDialog}
            previewProps={{
              images: galleryImages,
              file: previewImage,
              open: true,
              onOpenChange: (open) => {
                if (!open) setPreviewImage(null);
              },
              onFileChange: handleGalleryImageChange,
              onDownload: handleDownload,
              onShare: handleShareFile,
            }}
          />
        ) : null}
        {previewPdf !== null ? (
          <DynamicImportPreview
            loader={loadPdfPreviewDialog}
            previewProps={{
              file: previewPdf,
              open: true,
              onOpenChange: (open) => {
                if (!open) setPreviewPdf(null);
              },
              onDownload: handleDownload,
            }}
          />
        ) : null}
        {previewText !== null ? (
          <DynamicImportPreview
            loader={loadTextCodeEditorDialog}
            previewProps={{
              tabs: galleryTextFiles,
              file: previewText,
              open: true,
              branchLabel: textEditorBranchLabel,
              onOpenChange: (open) => {
                if (!open) setPreviewText(null);
              },
              onFileChange: handleGalleryTextChange,
              onFileSaved: handleTextFileSaved,
            }}
          />
        ) : null}
        {previewSpreadsheet !== null ? (
          <DynamicImportPreview
            loader={loadExcelSpreadsheetDialog}
            previewProps={{
              file: previewSpreadsheet,
              open: true,
              onOpenChange: (open) => {
                if (!open) setPreviewSpreadsheet(null);
              },
              onFileSaved: handleSpreadsheetFileSaved,
              onShare: handleShareFile,
            }}
          />
        ) : null}
        {previewAudio !== null ? (
          <DynamicImportPreview
            loader={loadAudioPreviewDialog}
            previewProps={{
              tracks: galleryAudio,
              file: previewAudio,
              open: true,
              onOpenChange: (open) => {
                if (!open) setPreviewAudio(null);
              },
              onFileChange: handleGalleryAudioChange,
            }}
          />
        ) : null}
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
          onThumbnailSelected={handleVideoThumbnailSelected}
          onThumbnailUpdated={handleVideoThumbnailUpdated}
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
          onBulkDelete={handleBulkDeleteRequest}
          onShareFile={handleShareFile}
          onShareFolder={handleShareFolder}
          onDetailsFile={handleDetailsFile}
          onDetailsFolder={handleDetailsFolder}
          onCopyToFolder={handleOpenFolderPicker}
          onMoveToFolder={handleOpenFolderPicker}
          selectedFileIds={selectedFileIds}
          bulkSelectionCount={selectedFileIds.size}
        />
      <MobileDriveHeader
        activeNav={activeNav}
        folderStack={folderStack}
        query={query}
        onQueryChange={setQuery}
        displayName={profileDisplayName}
        roleLabel={profileRoleLabel}
        initials={initials}
        email={user?.email}
        isAdmin={user?.role === "admin"}
        profileOpen={profileOpen}
        profileRef={mobileProfileRef}
        onProfileToggle={() => setProfileOpen((open) => !open)}
        onLogout={handleSignOut}
        onMenuOpen={() => setMobileSidebarOpen(true)}
        onUpload={() => setUploadDialogOpen(true)}
        onCreateFolder={() => {
          setActiveNav("my-files");
          setCreateFolderDialogOpen(true);
        }}
        onBack={() => goToFolderIndex(folderStack.length - 2)}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1">
        <DriveSidebar
          activeNav={activeNav}
          usedBytes={usedBytes}
          quotaBytes={quotaBytes}
          onNavChange={handleNavChange}
        />

        {/* Main column — Pencil Main Content Area: desktop topbar + scrollable body on #F7F8FA. */}
        {/* Agent: flex col on lg; topbar shrink-0; mainScrollRef on inner pane for explorer scroll sync. */}
        <main
          className={cn(
            "relative flex min-h-0 flex-col overflow-hidden",
            activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files"
              ? "bg-[#F7F8FA]"
              : "bg-[#f3f2f1] lg:bg-[#F7F8FA]",
          )}
        >
          <DriveDesktopTopbar
            displayName={profileDisplayName}
            roleLabel={profileRoleLabel}
            initials={initials}
            email={user?.email}
            isAdmin={user?.role === "admin"}
            onSignOut={handleSignOut}
            className={cn(
              "mx-4 mt-4 max-lg:hidden lg:mx-12 lg:mt-0",
              activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files" ? "mb-8" : "mb-6",
            )}
          />

          <div
            ref={mainScrollRef}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-4 md:p-6 lg:px-12 lg:pb-12 lg:pt-0",
            )}
          >
          <div
            className={cn(
              "flex min-h-full flex-col gap-4 max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:shadow-none",
              activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files"
                ? "lg:min-h-full"
                : "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm md:p-6 lg:flex lg:min-h-full lg:gap-4 lg:p-6",
            )}
          >
            <div
              className={cn(
                "hidden flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex",
                (activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files") && "lg:hidden",
              )}
            >
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-semibold text-neutral-900">
                  {activeNav === "recycle-bin" ? "Recycle bin" : "Library"}
                </h1>
                <p className="text-sm text-neutral-500">
                  {activeNav === "recycle-bin"
                    ? "Restore deleted files and folders, or remove them permanently"
                    : "Browse everything in your library"}
                </p>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Separator
              className={cn(
                "hidden bg-neutral-200 lg:block",
                (activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files") && "lg:hidden",
              )}
            />

            {loading && activeNav !== "shared-files" ? (
              <p className="py-12 text-center text-sm text-neutral-500">Loading files…</p>
            ) : activeNav === "recycle-bin" ? (
              <RecycleBinPanel
                data={recycleBinData}
                loading={loading}
                error={recycleBinError}
                onRefresh={() =>
                  void refresh(undefined, { nav: "recycle-bin", silent: true })
                }
                onChanged={() => void refreshDashboard()}
              />
            ) : activeNav === "shared-files" ? (
              <SharedFilesPanel
                withMeItems={sharedWithMeItems}
                byMeItems={sharedByMeItems}
                byMeMetrics={sharedByMeMetrics}
                loadingWithMe={sharedFilesLoading}
                loadingByMe={sharedFilesLoading}
                error={sharedFilesError}
                onShareNavigate={() => handleNavChange("my-files")}
                onManageShare={(target) => {
                  setShareTarget(target);
                  setShareDialogOpen(true);
                }}
                onRefreshWithMe={() => void refreshSharedFiles()}
              />
            ) : activeNav === "home" ? (
              <DriveOverviewPanel
                folders={overviewFolders}
                recentFiles={recentFiles}
                usedBytes={usedBytes}
                quotaBytes={quotaBytes}
                fileShareFlags={fileShareFlags}
                folderShareFlags={folderShareFlags}
                onOpenFolder={openFolder}
                onCreateFolder={() => {
                  setActiveNav("my-files");
                  setCreateFolderDialogOpen(true);
                }}
                onUpload={() => setUploadDialogOpen(true)}
                onViewAllFiles={() => handleNavChange("my-files")}
                onPreviewVideo={handlePreviewVideo}
                onPreviewImage={handlePreviewImage}
                onPreviewPdf={handlePreviewPdf}
                onPreviewText={handlePreviewText}
                onPreviewSpreadsheet={handlePreviewSpreadsheet}
                onPreviewAudio={handlePreviewAudio}
              />
            ) : activeNav === "my-files" ? (
              <div className="flex flex-col gap-4">
                <BulkActionsBar
                  selectedCount={selectedFiles.length}
                  selectableCount={selectableBrowserFileIds.length}
                  allSelected={allBrowserFilesSelected}
                  onSelectAll={handleSelectAllBrowserFiles}
                  favouriteLabel={bulkFavouriteLabel}
                  onDownload={handleBulkDownload}
                  onToggleFavourite={handleBulkToggleFavourite}
                  onDelete={handleBulkDeleteRequest}
                  onClearSelection={() => setSelectedFileIds(new Set())}
                />
                <DriveCloudExplorer
                  folderStack={folderStack}
                  folders={visibleFolders}
                  files={browserFiles}
                  query={query}
                  onQueryChange={setQuery}
                  typeFilter={typeFilter}
                  onTypeFilterChange={setTypeFilter}
                  typeFilterOptions={TYPE_FILTERS}
                  isSearching={isSearchingMyFiles}
                  dragEnabled={!isSearchingMyFiles}
                  selectable
                  selectedFileIds={selectedFileIds}
                  onSelectedFileIdsChange={setSelectedFileIds}
                  fileShareFlags={fileShareFlags}
                  folderShareFlags={folderShareFlags}
                  hasMoreFiles={hasMoreFiles}
                  loadingMoreFiles={filesLoadingMore}
                  onLoadMoreFiles={() => void loadMoreFiles()}
                  hasMoreFolders={hasMoreFolders}
                  loadingMoreFolders={foldersLoadingMore}
                  onLoadMoreFolders={() => void loadMoreFolders()}
                  scrollElementRef={mainScrollRef}
                  onNavigateHome={() => handleNavChange("home")}
                  onNavigateMyCloudRoot={() => goToFolderIndex(-1)}
                  onGoToFolderIndex={goToFolderIndex}
                  onOpenFolder={openFolder}
                  onCreateFolder={() => setCreateFolderDialogOpen(true)}
                  onUpload={() => setUploadDialogOpen(true)}
                  onMoveFileToFolder={(fileId, folderId) =>
                    void handleMoveFileToFolder(fileId, folderId)
                  }
                  onPreviewVideo={handlePreviewVideo}
                  onPreviewImage={handlePreviewImage}
                  onPreviewPdf={handlePreviewPdf}
                  onPreviewText={handlePreviewText}
                  onPreviewSpreadsheet={handlePreviewSpreadsheet}
                  onPreviewAudio={handlePreviewAudio}
                  onOpenActions={handleOpenMobileActions}
                />
              </div>
            ) : null}

            <p className="mt-auto hidden text-xs text-neutral-500 lg:block">
              {instanceName}
              {activeNav === "home"
                ? ` · ${overviewFolders.length} folder${overviewFolders.length === 1 ? "" : "s"} · ${recentFiles.length} recent`
                : activeNav === "shared-files"
                  ? " · Files shared with you and by you"
                : activeNav === "recycle-bin"
                  ? " · Deleted items are kept for 30 days"
                  : ` · ${folderCount} folder${folderCount === 1 ? "" : "s"} · ${files.length} of ${fileCount} file${fileCount === 1 ? "" : "s"}`}
            </p>
          </div>
          </div>
        </main>
      </div>
      <MobileBottomNav
        activeNav={activeNav}
        onNavChange={handleNavChange}
        onUpload={() => setUploadDialogOpen(true)}
        onMenuOpen={() => setMobileSidebarOpen(true)}
      />
      </div>
    </DriveContextMenu>
  );
}
