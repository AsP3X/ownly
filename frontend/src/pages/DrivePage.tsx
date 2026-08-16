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
  FILES_INITIAL_PAGE_SIZE,
  FILES_PAGE_SIZE,
  getErrorMessage,
  copyFile,
  renameFile,
  renameFolder,
  reprocessFileHls,
  addFavouriteFiles,
  removeFavouriteFiles,
  listFiles,
  listFolders,
  moveFile,
  moveFolder,
  restoreRecycleBinItems,
  uploadFileWithProgress,
  type FileItem,
  type FolderDeletionPreview,
  type FolderItem,
  type FolderPathSegment,
  type RecycleBinResponse,
  type ShareFlags,
  type SharedByMeItem,
  type SharedByMeMetrics,
  type SharedWithMeItem,
} from "@/api/client";
import { BulkActionsBar } from "@/components/drive/BulkActionsBar";
import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";
import {
  MobileFileActionsSheet,
  type MobileActionTarget,
} from "@/components/drive/MobileFileActionsSheet";
import { MobileBottomNav } from "@/components/drive/MobileBottomNav";
import { DriveDesktopTopbar } from "@/components/drive/DriveDesktopTopbar";
import { MobileDriveHeader } from "@/components/drive/MobileDriveHeader";
import {
  DriveCloudExplorer,
  type ExplorerListMode,
} from "@/components/drive/DriveCloudExplorer";
import { DriveCommandPalette } from "@/components/drive/DriveCommandPalette";
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
import { NewDocumentDialog } from "@/components/drive/NewDocumentDialog";
import { RenameDialog, type RenameTarget } from "@/components/drive/RenameDialog";
import { FolderPickerDialog, type FolderPickerCrumb } from "@/components/drive/FolderPickerDialog";
import { ShareDialog, type ShareTarget } from "@/components/drive/ShareDialog";
import {
  ResourceDetailsDialog,
  type DetailsTarget,
} from "@/components/drive/ResourceDetailsDialog";
import { DynamicImportPreview, loadAudioPreviewDialog, loadEpubPreviewDialog, loadExcelSpreadsheetDialog, loadImagePreviewDialog, loadPdfPreviewDialog, loadRtfEditorDialog, loadTextCodeEditorDialog, loadVideoPreviewDialog } from "@/lib/dynamic-import-preview";
import { UploadDialog } from "@/components/drive/UploadDialog";
import { abortAllResumableUploadSessions } from "@/lib/resumable-upload";
import {
  displayedStorageUsedBytes,
  limitingStorageKind,
  remainingForNewUpload,
  type StorageLimitKind,
} from "@/lib/upload-storage-capacity";
import { RecycleBinPanel } from "@/components/drive/RecycleBinPanel";
import {
  subscribeUploadFileComplete,
  subscribeUploadFileIngestProgress,
  subscribeUploadFileRegistered,
  clearCancelledHlsReprocessItems,
  getUploadBatch,
  trackActiveHlsEncodeJobs,
  trackHlsReprocessFiles,
} from "@/lib/upload-manager";
import {
  mergeExplorerFileRow,
  patchExplorerFileRows,
  shouldReflectUploadInFileList,
  type ExplorerFileListContext,
} from "@/lib/explorer-file-list-updates";
import {
  canRebuildVideoStream,
  isFileProcessing,
  shouldPollFileThumbnail,
} from "@/lib/file-processing";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  captureMoveOrigins,
  describeMoveFailure,
  describeMoveSummary,
  describeMoveUndoneSummary,
  describeRecycleSummary,
  describeRestoreSummary,
  formatItemCount,
  UNDOABLE_TOAST_MS,
  type MoveOrigin,
} from "@/lib/drive-actions";
import { ROOT_FOLDER_LABEL } from "@/lib/folder-path";
import { loadFavouriteFileIds } from "@/lib/favourites";
import {
  buildNewDocumentFile,
  uniqueDocumentName,
  type NewDocumentTemplate,
} from "@/lib/new-document";
import type { DriveCommandActionId } from "@/lib/drive-command-palette";
import {
  resetExplorerThumbnailWarmScope,
  touchCachedExplorerThumbnailsForFiles,
  warmExplorerThumbnailCache,
} from "@/lib/explorer-thumbnail-prefetch";
import { enqueueDownload, enqueueBulkDownload, enqueueFolderDownload } from "@/lib/download-manager";
import { useInstanceName } from "@/hooks/useInstanceName";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAuth } from "@/hooks/useAuth";
import { useDriveUrlState } from "@/hooks/useDriveUrlState";
import {
  buildAudioGallery,
  buildImageGallery,
  buildTextCodeGallery,
  buildVideoGallery,
  isAudioMime,
  isImageMime,
  isEpubMime,
  isPdfMime,
  isRtfPreviewMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
  sortFilesByName,
  sortExplorerFiles,
  userInitials,
  userRoleLabel,
  type FileTypeFilter,
} from "@/lib/utils-app";
import { displayNameFromEmail } from "@/lib/public-share-format";
import {
  getRecentFileIds,
  readExplorerFileSort,
  readExplorerViewMode,
  recordFileAccess,
  removeFilePreferences,
  sortFilesByRecentAccess,
  writeExplorerFileSort,
  writeExplorerViewMode,
  explorerFileSortToApiParam,
  type ExplorerFileSort,
  type ExplorerViewMode,
} from "@/lib/drive-preferences";
import { cn } from "@/lib/utils";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type NavItemId = DriveNavId;
type FolderCrumb = { id: string; name: string };

/**
 * Human: Where-you-are label for the desktop topbar, one per sidebar section.
 * Agent: `my-files` is absent on purpose — that view shows the breadcrumb trail instead.
 */
const DRIVE_NAV_TITLES: Record<NavItemId, string> = {
  home: "My Cloud",
  "my-files": "My Cloud",
  favourites: "Favourites",
  "shared-files": "Shared Files",
  "recycle-bin": "Recycle bin",
};

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
      className="h-2.5 w-full overflow-hidden rounded-full bg-edge"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Storage used"
    >
      <div
        className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
        style={{ width: `${fillWidth}%` }}
      />
    </div>
  );
}

export default function DrivePage() {
  const { user, logout, isAdmin } = useAuth();
  const { instanceName, dashboard, refreshDashboard: refreshDashboardShared } = useInstanceName();
  // Human: Mobile profile menu anchor — desktop topbar uses an inline Sign Out button instead.
  // Agent: mobileProfileRef; WRITTEN by MobileDriveHeader; READ by outside-click dismiss handler.
  const mobileProfileRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadDropFiles, setUploadDropFiles] = useState<File[] | undefined>(undefined);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>("all");
  const [fileSort, setFileSort] = useState<ExplorerFileSort>(() => readExplorerFileSort());
  // Human: Explorer layout (thumbnail grid vs detail rows), restored from the user's last choice.
  // Agent: READS ownly_explorer_view_mode on mount; WRITES via handleViewModeChange.
  const [viewMode, setViewMode] = useState<ExplorerViewMode>(() => readExplorerViewMode());
  const [activeNav, setActiveNav] = useState<NavItemId>("home");
  // Human: Mirror drive view/folder/search into the URL so reload restores the same screen.
  // Agent: CALLS useDriveUrlState; READS/WRITES ?view &folder &q &type on pathname /.
  useDriveUrlState({
    activeNav,
    folderStack,
    query: committedQuery,
    typeFilter,
    setActiveNav,
    setFolderStack,
    setQuery: (value) => {
      setQuery(value);
      setCommittedQuery(value);
    },
    setTypeFilter,
  });
  const [usedBytes, setUsedBytes] = useState(0);
  const [reservedBytes, setReservedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(1);
  const [effectiveRemainingBytes, setEffectiveRemainingBytes] = useState(
    Number.POSITIVE_INFINITY,
  );
  const [storageLimitKind, setStorageLimitKind] = useState<StorageLimitKind>("quota");
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

  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [newDocumentError, setNewDocumentError] = useState("");
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [folderDeletePreview, setFolderDeletePreview] = useState<FolderDeletionPreview | null>(
    null,
  );
  const [folderPreviewLoading, setFolderPreviewLoading] = useState(false);
  const [folderPreviewError, setFolderPreviewError] = useState("");
  const [bulkDeleteItems, setBulkDeleteItems] = useState<BulkDeleteItem[]>([]);
  // Human: True while bulk stream rebuild requests are in flight for the current selection.
  // Agent: WRITES true around reprocessFileHls loop; DISABLES rebuild button on BulkActionsBar.
  const [bulkRebuildingStreams, setBulkRebuildingStreams] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  // Human: Synchronous mirror of selectedFileIds — mobile taps read/write this between React commits.
  // Agent: WRITES on every selection mutation; READ by handleTapToggleFileSelection before setState.
  const selectedFileIdsRef = useRef<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(() => new Set());
  // Human: Synchronous mirror of selectedFolderIds — keeps checkbox toggles consistent between commits.
  // Agent: WRITES on every folder selection mutation; READ by handleSelectedFolderIdsChange updater.
  const selectedFolderIdsRef = useRef<Set<string>>(new Set());
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerFiles, setFolderPickerFiles] = useState<FileItem[]>([]);
  const [folderPickerFoldersToMove, setFolderPickerFoldersToMove] = useState<FolderItem[]>([]);
  const [folderPickerStack, setFolderPickerStack] = useState<FolderPickerCrumb[]>([]);
  const [folderPickerFolders, setFolderPickerFolders] = useState<FolderItem[]>([]);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  const [folderPickerError, setFolderPickerError] = useState("");
  const [folderPickerSubmitting, setFolderPickerSubmitting] = useState<"copy" | "move" | null>(
    null,
  );
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(() => new Set());
  const [previewVideo, setPreviewVideo] = useState<FileItem | null>(null);
  const [previewImage, setPreviewImage] = useState<FileItem | null>(null);
  const [previewPdf, setPreviewPdf] = useState<FileItem | null>(null);
  const [previewEpub, setPreviewEpub] = useState<FileItem | null>(null);
  const [previewText, setPreviewText] = useState<FileItem | null>(null);
  const [previewRtf, setPreviewRtf] = useState<FileItem | null>(null);
  /** Human: Shared-with-me edit grants open collab; view grants stay read-only. */
  const [previewRtfCanEdit, setPreviewRtfCanEdit] = useState(true);
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Human: Topbar slot the explorer portals its folder trail into on desktop.
  // Agent: STATE (not a ref) so the explorer re-renders once the node exists.
  const [topbarBreadcrumbSlot, setTopbarBreadcrumbSlot] = useState<HTMLDivElement | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileActionTarget, setMobileActionTarget] = useState<MobileActionTarget | null>(null);
  const [explorerDragActive, setExplorerDragActive] = useState(false);
  const [explorerTouchScrollLocked, setExplorerTouchScrollLocked] = useState(false);
  // Human: Mobile-only tap-to-select mode — entered via context menu or action sheet "Select".
  // Agent: WRITES true after onEnterMobileSelection; READ by explorer tiles + touch drag batch moves.
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
  const isDesktopViewport = useIsDesktopPlayer(true);
  const [recycleBinData, setRecycleBinData] = useState<RecycleBinResponse | null>(null);
  const [recycleBinError, setRecycleBinError] = useState("");
  const [sharedWithMeItems, setSharedWithMeItems] = useState<SharedWithMeItem[]>([]);
  const [sharedByMeItems, setSharedByMeItems] = useState<SharedByMeItem[]>([]);
  const [sharedByMeMetrics, setSharedByMeMetrics] = useState<SharedByMeMetrics | null>(null);
  const [sharedFilesLoading, setSharedFilesLoading] = useState(false);
  const [sharedFilesError, setSharedFilesError] = useState("");

  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const isSearchingMyFiles = activeNav === "my-files" && committedQuery.length > 0;
  // Human: Favourites and search are flat lists — no folder section, no drop targets, no trail.
  const explorerListMode: ExplorerListMode =
    activeNav === "favourites" ? "favourites" : isSearchingMyFiles ? "search" : "folder";
  // Human: A library that has never stored a byte, viewed at its root — show onboarding, not "nothing here".
  // Agent: READS dashboard usedBytes; false as soon as anything is uploaded or the user browses deeper.
  const isFirstRunLibrary =
    activeNav === "my-files" &&
    currentFolderId === null &&
    usedBytes === 0 &&
    committedQuery.length === 0 &&
    typeFilter === "all";
  const serverTypeFilter = typeFilter !== "all" ? typeFilter : undefined;
  const serverFileSort = explorerFileSortToApiParam(fileSort);
  const dashboardLoadedRef = useRef(false);
  const explorerListContextRef = useRef<ExplorerFileListContext>({
    activeNav: "home",
    currentFolderId: null,
    searchQuery: "",
    typeFilter: "all",
  });
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Human: Keep upload listener context fresh without resubscribing on every nav/filter change.
  // Agent: WRITES explorerListContextRef in effect; READ by applyExplorerUploadFile callbacks.
  useEffect(() => {
    explorerListContextRef.current = {
      activeNav,
      currentFolderId,
      searchQuery:
        activeNav === "my-files" || (activeNav === "home" && committedQuery.length > 0)
          ? committedQuery
          : "",
      typeFilter,
    };
  }, [activeNav, currentFolderId, committedQuery, typeFilter]);

  // Human: Warm the in-memory thumbnail LRU after listing fetches — fewer requests while scrolling.
  // Agent: TOUCHES existing keys; QUEUES low-priority prefetch for ready image/video thumbs.
  const primeExplorerThumbnailCache = useCallback(
    (rows: FileItem[]) => {
      const scope = `${activeNav}:${currentFolderId ?? "root"}:${
        activeNav === "my-files" && committedQuery ? committedQuery : ""
      }`;
      resetExplorerThumbnailWarmScope(scope);
      touchCachedExplorerThumbnailsForFiles(rows);
      warmExplorerThumbnailCache(rows, scope);
    },
    [activeNav, currentFolderId, committedQuery],
  );

  // Human: Insert or patch one uploaded file in local listing state without reloading the folder.
  // Agent: MERGES row via mergeExplorerFileRow; SKIPS setState when row already matches.
  const applyExplorerUploadFile = useCallback((file: FileItem) => {
    const context = explorerListContextRef.current;
    if (!shouldReflectUploadInFileList(file, context)) {
      return;
    }
    let fileCountDelta = 0;
    setFiles((prev) => {
      const merged = mergeExplorerFileRow(prev, file);
      if (!merged.changed) {
        return prev;
      }
      fileCountDelta = merged.fileCountDelta;
      return merged.files;
    });
    if (fileCountDelta > 0) {
      setFileCount((count) => count + fileCountDelta);
    }
  }, []);

  // Human: Storage summary for the sidebar and upload preflight — includes network node headroom.
  // Agent: CALLS shared refreshDashboard; WRITES local quota state from returned payload.
  const applyDashboardStats = useCallback(
    (nextDashboard: {
      used_bytes: number;
      reserved_bytes?: number | null;
      quota_bytes: number;
      network_remaining_bytes?: number | null;
      effective_remaining_bytes?: number | null;
    }) => {
      const localInFlight = (getUploadBatch()?.items ?? []).some(
        (item) => item.status === "uploading" || item.status === "queued",
      );
      setUsedBytes(nextDashboard.used_bytes);
      setReservedBytes(nextDashboard.reserved_bytes ?? 0);
      setQuotaBytes(nextDashboard.quota_bytes || 1);
      const remaining = remainingForNewUpload(nextDashboard, { hasLocalInFlight: localInFlight });
      const limitKind = limitingStorageKind(nextDashboard);
      setEffectiveRemainingBytes(remaining);
      setStorageLimitKind(limitKind);
      dashboardLoadedRef.current = true;
      return { remainingBytes: remaining, limitKind };
    },
    [],
  );

  const refreshDashboard = useCallback(async (): Promise<{
    remainingBytes: number;
    limitKind: StorageLimitKind;
  }> => {
    const nextDashboard = await refreshDashboardShared();
    if (!nextDashboard) {
      return { remainingBytes: Number.POSITIVE_INFINITY, limitKind: "none" };
    }
    return applyDashboardStats(nextDashboard);
  }, [applyDashboardStats, refreshDashboardShared]);

  // Human: Upload preflight only — drop leftover reservations from a failed browser session, then remeasure.
  // Agent: NOT used by ordinary dashboard refreshes (those must not abort another tab's in-flight upload).
  const prepareUploadStorageLimits = useCallback(async (): Promise<{
    remainingBytes: number;
    limitKind: StorageLimitKind;
  }> => {
    let nextDashboard = await refreshDashboardShared();
    if (!nextDashboard) {
      return { remainingBytes: Number.POSITIVE_INFINITY, limitKind: "none" };
    }
    const localInFlight = (getUploadBatch()?.items ?? []).some(
      (item) => item.status === "uploading" || item.status === "queued",
    );
    if ((nextDashboard.reserved_bytes ?? 0) > 0 && !localInFlight) {
      await abortAllResumableUploadSessions().catch(() => {
        // Human: Best-effort — leftover reservations still expire server-side.
      });
      nextDashboard = (await refreshDashboardShared()) ?? nextDashboard;
    }
    return applyDashboardStats(nextDashboard);
  }, [applyDashboardStats, refreshDashboardShared]);

  // Human: Mirror shared dashboard stats into local drive UI state when the provider fetch completes.
  // Agent: READS dashboard from InstanceNameProvider; WRITES used/quota/effective remaining bytes.
  useEffect(() => {
    if (!dashboard) return;
    applyDashboardStats(dashboard);
  }, [applyDashboardStats, dashboard]);

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
      if (next.size === prev.size) return prev;
      selectedFileIdsRef.current = next;
      return next;
    });
  }

  // Human: Drop folder selections that disappeared from the current listing after refresh.
  // Agent: INTERSECTS selectedFolderIds with visible folder ids; SKIPS setState when unchanged.
  function pruneFolderSelection(validFolders: FolderItem[]) {
    const validIds = new Set(validFolders.map((folder) => folder.id));
    setSelectedFolderIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      if (next.size === prev.size) return prev;
      selectedFolderIdsRef.current = next;
      return next;
    });
  }

  // Human: Publish a new selection Set to React state and the synchronous ref together.
  // Agent: WRITES selectedFileIdsRef + setSelectedFileIds; CLEARS mobileSelectionMode when empty.
  function commitFileSelection(next: Set<string>) {
    const committed = new Set(next);
    selectedFileIdsRef.current = committed;
    setSelectedFileIds(committed);
    if (committed.size === 0 && selectedFolderIdsRef.current.size === 0) {
      setMobileSelectionMode(false);
    }
  }

  // Human: Publish folder checkbox selection to React state and the synchronous ref together.
  // Agent: WRITES selectedFolderIdsRef + setSelectedFolderIds.
  function commitFolderSelection(next: Set<string>) {
    const committed = new Set(next);
    selectedFolderIdsRef.current = committed;
    setSelectedFolderIds(committed);
  }

  const refresh = useCallback(
    async (
      search?: string,
      options?: {
        silent?: boolean;
        folderId?: string | null;
        nav?: NavItemId;
        fileSort?: ExplorerFileSort;
      },
    ) => {
      if (!options?.silent) {
        setLoading(true);
      }
      setError("");
      if (!dashboardLoadedRef.current) {
        void refreshDashboard();
      }
      const nav = options?.nav ?? activeNav;
      const listSort = explorerFileSortToApiParam(options?.fileSort ?? fileSort);
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
          clearFileSelectionState();
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
          clearFileSelectionState();
          setRecycleBinData(null);
          setRecycleBinError("");
          return;
        }

        // Human: Favourites is a flat view of starred files, wherever they live in the tree.
        // Agent: RESOLVES the current star ids through /files/batch, the same route Home uses
        //        for recents; no folders, so the explorer renders it without a trail.
        if (nav === "favourites") {
          const starred = await loadFavouriteFileIds();
          setFavouriteIds(starred);
          const { files: starredFiles } = await batchFiles([...starred], "minimal");
          setFolders([]);
          setFiles(starredFiles);
          primeExplorerThumbnailCache(starredFiles);
          setFileCount(starredFiles.length);
          setHasMoreFiles(false);
          setFolderCount(0);
          setHasMoreFolders(false);
          const flags = buildShareFlagMaps(starredFiles, []);
          setFileShareFlags(flags.files);
          setFolderShareFlags({});
          setRecycleBinData(null);
          setRecycleBinError("");
          pruneFileSelection(starredFiles);
          pruneFolderSelection([]);
          return;
        }

        const targetFolderId =
          options?.folderId !== undefined ? options.folderId : currentFolderId;

        if (nav === "home" && !search) {
          const recentIds = getRecentFileIds().slice(0, FILES_INITIAL_PAGE_SIZE);
          const [folderListing, { files: recentBatch }] = await Promise.all([
            listFolders({ limit: FILES_INITIAL_PAGE_SIZE, offset: 0 }),
            batchFiles(recentIds, "minimal"),
          ]);
          setFolders(folderListing.folders);
          setFiles(recentBatch);
          primeExplorerThumbnailCache(recentBatch);
          setFileCount(recentBatch.length);
          setHasMoreFiles(false);
          setFolderCount(folderListing.folder_count);
          setHasMoreFolders(folderListing.has_more);
          const flags = buildShareFlagMaps(recentBatch, folderListing.folders);
          setFileShareFlags(flags.files);
          setFolderShareFlags(flags.folders);
          pruneFileSelection(recentBatch);
          pruneFolderSelection(folderListing.folders);
          return;
        }

        if (search) {
          const [listing, folderListing] = await Promise.all([
            listFiles({
              q: search,
              limit: FILES_INITIAL_PAGE_SIZE,
              offset: 0,
              fields: "minimal",
              type_filter: serverTypeFilter,
              sort: listSort,
            }),
            listFolders({
              q: search,
              limit: FILES_INITIAL_PAGE_SIZE,
              offset: 0,
            }),
          ]);
          setFolders(folderListing.folders);
          setFiles(listing.files);
          primeExplorerThumbnailCache(listing.files);
          setFileCount(listing.file_count);
          setHasMoreFiles(listing.has_more);
          setFolderCount(folderListing.folder_count);
          setHasMoreFolders(folderListing.has_more);
          const flags = buildShareFlagMaps(listing.files, folderListing.folders);
          setFileShareFlags(flags.files);
          setFolderShareFlags(flags.folders);
          pruneFileSelection(listing.files);
          pruneFolderSelection(folderListing.folders);
          return;
        }

        const [folderListing, fileListing] = await Promise.all([
          listFolders({
            parent_id: targetFolderId ?? undefined,
            limit: FILES_INITIAL_PAGE_SIZE,
            offset: 0,
          }),
          listFiles({
            folder_id: targetFolderId ?? undefined,
            limit: FILES_INITIAL_PAGE_SIZE,
            offset: 0,
            fields: "minimal",
            type_filter: serverTypeFilter,
            sort: listSort,
          }),
        ]);
        setFolders(folderListing.folders);
        setFiles(fileListing.files);
        primeExplorerThumbnailCache(fileListing.files);
        setFileCount(fileListing.file_count);
        setHasMoreFiles(fileListing.has_more);
        setFolderCount(folderListing.folder_count);
        setHasMoreFolders(folderListing.has_more);
        const flags = buildShareFlagMaps(fileListing.files, folderListing.folders);
        setFileShareFlags(flags.files);
        setFolderShareFlags(flags.folders);
        pruneFileSelection(fileListing.files);
        pruneFolderSelection(folderListing.folders);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [activeNav, currentFolderId, fileSort, primeExplorerThumbnailCache, refreshDashboard, serverTypeFilter],
  );

  // Human: Re-fetch whatever the open view shows, search included — the common case for mutations.
  // Agent: WRAPS refresh with the active nav + committed query; PASS { silent: true } to keep rows visible.
  const refreshCurrentView = useCallback(
    (options?: { silent?: boolean }) =>
      refresh(activeNav === "my-files" ? committedQuery || undefined : undefined, {
        nav: activeNav,
        ...options,
      }),
    [activeNav, committedQuery, refresh],
  );

  // Human: Undo runs from a toast, possibly long after the view moved on.
  // Agent: MIRRORS refreshCurrentView so deferred callbacks reload what is on screen now, not then.
  const refreshCurrentViewRef = useRef(refreshCurrentView);
  useEffect(() => {
    refreshCurrentViewRef.current = refreshCurrentView;
  }, [refreshCurrentView]);

  // Human: Pull the account's stars once per mount, importing any left in this browser's storage.
  // Agent: FAILURE is non-fatal — stars simply render empty until the next load.
  useEffect(() => {
    let cancelled = false;
    void loadFavouriteFileIds()
      .then((ids) => {
        if (!cancelled) setFavouriteIds(ids);
      })
      .catch(() => {
        // Human: Favourites are decoration on every view except their own; never block the drive.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        q: isSearchingMyFiles ? committedQuery : undefined,
        folder_id: isSearchingMyFiles ? undefined : (currentFolderId ?? undefined),
        limit: FILES_PAGE_SIZE,
        offset: files.length,
        fields: "minimal",
        type_filter: serverTypeFilter,
        sort: serverFileSort,
      });
      setFiles((prev) => [...prev, ...listing.files]);
      primeExplorerThumbnailCache(listing.files);
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
    primeExplorerThumbnailCache,
    committedQuery,
    serverTypeFilter,
    serverFileSort,
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

  // Human: Show a new upload row as soon as the API returns — without reloading the whole grid.
  // Agent: SUBSCRIBES subscribeUploadFileRegistered; UPSERTS FileItem into files state.
  useEffect(() => {
    return subscribeUploadFileRegistered((file) => {
      applyExplorerUploadFile(file);
    });
  }, [applyExplorerUploadFile]);

  // Human: Finalize one upload row when ingest completes — patch that file + refresh storage stats.
  // Agent: SUBSCRIBES subscribeUploadFileComplete; GET /files/:id; PATCHES files state only.
  useEffect(() => {
    return subscribeUploadFileComplete((fileId) => {
      recordFileAccess(fileId);
      void refreshDashboard();
      void (async () => {
        try {
          const { file } = await fetchFile(fileId);
          applyExplorerUploadFile(file);
        } catch {
          // Human: Processing poll may have already updated the row; ignore transient fetch errors.
        }
      })();
    });
  }, [applyExplorerUploadFile, refreshDashboard]);

  // Human: Live conversion % from the transfer tray poll into explorer tiles (rebuild + upload ingest).
  // Agent: SUBSCRIBES subscribeUploadFileIngestProgress; PATCHES files/details rows by id.
  useEffect(() => {
    return subscribeUploadFileIngestProgress((file) => {
      setFiles((prev) => patchExplorerFileRows(prev, [file]));
      setDetailsTarget((current) =>
        current?.kind === "file" && current.file.id === file.id
          ? { kind: "file", file: { ...current.file, ...file } }
          : current,
      );
    });
  }, []);

  // Human: Poll ingest + pending thumbnail rows — patch local state so previews appear without refresh.
  // Agent: GET /files/:id every 3s; SKIPS ingest-only ids the upload manager already polls; WARMS LRU on ready.
  const BACKGROUND_FILE_POLL_MS = 3000;
  const backgroundPollFileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const file of files) {
      if (shouldPollFileThumbnail(file) || isFileProcessing(file)) {
        ids.add(file.id);
      }
    }
    return [...ids];
  }, [files]);
  const backgroundPollIdsKey = backgroundPollFileIds.join(",");
  useEffect(() => {
    if (!backgroundPollIdsKey) return;

    const pollBackgroundFileRows = async () => {
      try {
        // Human: Always batch-poll processing rows for live grid %; tray also polls managed ids separately.
        // Agent: SKIPS only when the row no longer needs thumbnail or ingest polling.
        const idsToPoll = backgroundPollFileIds.filter((fileId) => {
          const file = filesRef.current.find((row) => row.id === fileId);
          if (!file) return false;
          return shouldPollFileThumbnail(file) || isFileProcessing(file);
        });
        if (idsToPoll.length === 0) return;

        const { files: updatedFiles } = await batchFiles(idsToPoll, "minimal");
        setFiles((prev) => patchExplorerFileRows(prev, updatedFiles));

        const readyThumbnails = updatedFiles.filter(
          (file) =>
            file.image_thumbnail_ready ||
            file.video_thumbnail_ready ||
            file.document_thumbnail_ready,
        );
        if (readyThumbnails.length > 0) {
          const context = explorerListContextRef.current;
          const scope = `${context.activeNav}:${context.currentFolderId ?? "root"}:${
            context.activeNav === "my-files" && context.searchQuery ? context.searchQuery : ""
          }`;
          warmExplorerThumbnailCache(readyThumbnails, scope);
        }
      } catch {
        // Human: Background poll failures are non-critical — next interval retries.
      }
    };

    void pollBackgroundFileRows();
    const timer = window.setInterval(() => {
      void pollBackgroundFileRows();
    }, BACKGROUND_FILE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [backgroundPollIdsKey, backgroundPollFileIds]);

  // Human: Load file list when the page opens, folder changes, committed search, or type filter changes.
  // Agent: SUBMITS search only on Enter (committedQuery); Home uses batch API via refresh().
  useEffect(() => {
    let cancelled = false;
    const searchOnMyFiles = activeNav === "my-files" ? committedQuery : "";
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void refresh(searchOnMyFiles || undefined, { nav: activeNav });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [committedQuery, refresh, activeNav, folderStack, typeFilter]);

  function openFolder(folder: FolderItem) {
    setActiveNav("my-files");
    clearFileSelectionState();
    setMobileSelectionMode(false);
    // Human: Ignore repeat opens when double-click fires after the first click already navigated.
    // Agent: SKIPS push when folder is already the current breadcrumb leaf.
    setFolderStack((prev) => {
      if (prev.at(-1)?.id === folder.id) return prev;
      return [...prev, { id: folder.id, name: folder.name }];
    });
  }

  function goToFolderIndex(index: number) {
    clearFileSelectionState();
    setMobileSelectionMode(false);
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

  // Human: Pull recycled items back out of the bin — the Undo action on a recycle toast.
  // Agent: POST /recycle-bin/restore; REFRESHES listing + storage stats; TOASTS the outcome.
  async function undoRecycle(fileIds: string[], folderIds: string[]) {
    try {
      const result = await restoreRecycleBinItems({
        file_ids: fileIds,
        folder_ids: folderIds,
      });
      void refreshDashboard();
      await refreshCurrentViewRef.current({ silent: true });
      toastSuccess(describeRestoreSummary(result.restored_files + result.restored_folders));
    } catch (e) {
      toastError(getErrorMessage(e));
    }
  }

  // Human: Refresh drive state after ConfirmDeleteDialog completes a successful delete.
  // Agent: CLEARS file prefs / breadcrumb crumbs; REFRESHES current nav view; OFFERS undo for recycles.
  function handleDeleted(target: DeleteTarget, options: { permanent: boolean }) {
    setError("");
    if (target.kind === "file") {
      removeFilePreferences(target.id);
    } else {
      setFolderStack((prev) => prev.filter((crumb) => crumb.id !== target.id));
    }
    void refreshDashboard();
    void refreshCurrentView();

    if (options.permanent) return;
    toastSuccess(describeRecycleSummary([target.name]), {
      duration: UNDOABLE_TOAST_MS,
      action: {
        label: "Undo",
        onClick: () =>
          void undoRecycle(
            target.kind === "file" ? [target.id] : [],
            target.kind === "folder" ? [target.id] : [],
          ),
      },
    });
  }

  // Human: Run one move batch, tolerating per-item failures so one bad row cannot abort the rest.
  // Agent: RETURNS the origins that actually moved plus the first error; CALLER owns feedback.
  async function applyMoveBatch(
    origins: MoveOrigin[],
    resolveTargetParentId: (origin: MoveOrigin) => string | null,
  ) {
    const applied: MoveOrigin[] = [];
    let failure = "";
    for (const origin of origins) {
      try {
        const targetParentId = resolveTargetParentId(origin);
        if (origin.kind === "file") {
          await moveFile(origin.id, targetParentId);
        } else {
          await moveFolder(origin.id, targetParentId);
        }
        applied.push(origin);
      } catch (e) {
        failure = failure || getErrorMessage(e);
      }
    }
    return { applied, failure };
  }

  // Human: Put a completed move back where it came from — the Undo action on the move toast.
  // Agent: REPLAYS applyMoveBatch against each origin's previous parent; REFRESHES the open view.
  async function undoDriveMove(moved: MoveOrigin[]) {
    const { applied, failure } = await applyMoveBatch(moved, (origin) => origin.parentId);
    await refreshCurrentViewRef.current({ silent: true });
    if (applied.length > 0) {
      toastSuccess(describeMoveUndoneSummary(applied));
    }
    if (failure) {
      toastError(describeMoveFailure(moved.length - applied.length, failure));
    }
  }

  /**
   * Human: Move files and folders into one destination and confirm it with an undoable toast.
   * Agent: CAPTURES previous parents first; TRIMS breadcrumbs for moved folders; REFRESHES silently.
   *        RETURNS the failure text instead of surfacing it — drag-drop toasts it, the picker inlines it.
   */
  async function runDriveMove(
    filesToMove: FileItem[],
    foldersToMove: FolderItem[],
    destinationId: string | null,
    destinationLabel: string,
  ) {
    const origins = captureMoveOrigins(filesToMove, foldersToMove, destinationId);
    if (origins.length === 0) {
      return { requested: 0, movedCount: 0, failure: "" };
    }

    setError("");
    const { applied, failure } = await applyMoveBatch(origins, () => destinationId);

    const movedFolderIds = new Set(
      applied.filter((origin) => origin.kind === "folder").map((origin) => origin.id),
    );
    if (movedFolderIds.size > 0) {
      setFolderStack((prev) => prev.filter((crumb) => !movedFolderIds.has(crumb.id)));
    }
    await refreshCurrentView({ silent: true });

    if (applied.length > 0) {
      toastSuccess(describeMoveSummary(applied, destinationLabel), {
        duration: UNDOABLE_TOAST_MS,
        action: { label: "Undo", onClick: () => void undoDriveMove(applied) },
      });
    }

    return {
      requested: origins.length,
      movedCount: applied.length,
      failure: describeMoveFailure(origins.length - applied.length, failure),
    };
  }

  // Human: Name a drop destination for the move toast — a visible folder, a breadcrumb, or the root.
  // Agent: READS folders + folderStack; both are the only drop targets the explorer offers.
  function resolveDropDestinationLabel(folderId: string | null) {
    if (folderId === null) return ROOT_FOLDER_LABEL;
    return (
      folders.find((folder) => folder.id === folderId)?.name ??
      folderStack.find((crumb) => crumb.id === folderId)?.name ??
      ROOT_FOLDER_LABEL
    );
  }

  // Human: Files one drag-drop should move — the whole checked batch in tap-select mode, else the dragged row.
  // Agent: SKIPS processing files; batch requires mobileSelectionMode so desktop drags stay single-row.
  function resolveDraggedFiles(fileId: string): FileItem[] {
    const dragged = files.find((item) => item.id === fileId);
    if (!dragged || isFileProcessing(dragged)) return [];
    if (mobileSelectionMode && selectedFileIds.has(fileId) && selectedFileIds.size > 1) {
      return files.filter((item) => selectedFileIds.has(item.id) && !isFileProcessing(item));
    }
    return [dragged];
  }

  // Human: Folders one drag-drop should move — every checked folder when the dragged one is checked.
  // Agent: READS selectedFolderIds; MIRRORS resolveDraggedFiles for the folder lane.
  function resolveDraggedFolders(folderId: string): FolderItem[] {
    const dragged = folders.find((item) => item.id === folderId);
    if (!dragged) return [];
    if (selectedFolderIds.has(folderId) && selectedFolderIds.size > 1) {
      return folders.filter((item) => selectedFolderIds.has(item.id));
    }
    return [dragged];
  }

  // Human: Explorer drag-drop entry for files — moves the dragged row or the checked batch.
  // Agent: CALLS runDriveMove; CLEARS selection only after a batch move, as before.
  async function handleExplorerMoveFileToFolder(fileId: string, folderId: string | null) {
    const filesToMove = resolveDraggedFiles(fileId);
    if (filesToMove.length === 0) return;

    const result = await runDriveMove(
      filesToMove,
      [],
      folderId,
      resolveDropDestinationLabel(folderId),
    );
    if (result.failure) toastError(result.failure);
    if (result.movedCount > 0 && filesToMove.length > 1) handleClearBrowserSelection();
  }

  // Human: Explorer drag-drop entry for folders — moves the dragged folder or the checked batch.
  // Agent: CALLS runDriveMove; runDriveMove already trims breadcrumbs for folders that moved.
  async function handleExplorerMoveFolderToParent(folderId: string, parentId: string | null) {
    const foldersToMove = resolveDraggedFolders(folderId);
    if (foldersToMove.length === 0) return;

    const result = await runDriveMove(
      [],
      foldersToMove,
      parentId,
      resolveDropDestinationLabel(parentId),
    );
    if (result.failure) toastError(result.failure);
    if (result.movedCount > 0 && foldersToMove.length > 1) handleClearBrowserSelection();
  }

  // Human: Enter mobile multi-select — seed the tapped file and show selection chrome on all tiles.
  // Agent: WRITES mobileSelectionMode true; ADDS fileId to selectedFileIds when not processing.
  function handleEnterMobileSelection(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    if (!file || isFileProcessing(file)) return;

    setMobileSelectionMode(true);
    const next = new Set(selectedFileIdsRef.current);
    next.add(fileId);
    commitFileSelection(next);
  }

  // Human: Mobile tap-select — flip one file using the ref so rapid taps never drop prior picks.
  // Agent: READS selectedFileIdsRef; WRITES commitFileSelection with toggled membership.
  function handleTapToggleFileSelection(fileId: string) {
    const next = new Set(selectedFileIdsRef.current);
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    commitFileSelection(next);
  }

  // Human: Reset the selection Set in React state and the synchronous ref together.
  // Agent: WRITES empty Set to selectedFileIdsRef + setSelectedFileIds.
  function clearFileSelectionState() {
    selectedFileIdsRef.current = new Set();
    setSelectedFileIds(new Set());
  }

  function clearFolderSelectionState() {
    selectedFolderIdsRef.current = new Set();
    setSelectedFolderIds(new Set());
  }

  // Human: Clear browser multi-select and exit mobile selection mode together.
  // Agent: WRITES empty selected ids; WRITES mobileSelectionMode false.
  function handleClearBrowserSelection() {
    clearFileSelectionState();
    clearFolderSelectionState();
    setMobileSelectionMode(false);
  }

  // Human: Selection changes from explorer checkboxes — always merges from selectedFileIdsRef.
  // Agent: WRITES commitFileSelection; SUPPORTS functional updater for desktop checkbox paths.
  function handleSelectedFileIdsChange(
    ids: Set<string> | ((prev: Set<string>) => Set<string>),
  ) {
    const next =
      typeof ids === "function" ? ids(selectedFileIdsRef.current) : new Set(ids);
    commitFileSelection(next);
  }

  // Human: Folder checkbox selection from explorer tiles — merges from selectedFolderIdsRef.
  // Agent: WRITES commitFolderSelection; SUPPORTS functional updater for checkbox paths.
  function handleSelectedFolderIdsChange(
    ids: Set<string> | ((prev: Set<string>) => Set<string>),
  ) {
    const next =
      typeof ids === "function" ? ids(selectedFolderIdsRef.current) : new Set(ids);
    commitFolderSelection(next);
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
    setFolderPickerFoldersToMove([]);
    setFolderPickerStack([]);
    setFolderPickerFolders([]);
    setFolderPickerError("");
    setFolderPickerSubmitting(null);
  }

  // Human: Open the folder picker with the current file and folder multi-selection.
  // Agent: WRITES picker state; LOADS root folders; OPENS dialog.
  function handleOpenFolderPicker() {
    if (selectedFiles.length === 0 && selectedFolders.length === 0) return;
    setFolderPickerFiles(selectedFiles);
    setFolderPickerFoldersToMove(selectedFolders);
    setFolderPickerStack([]);
    setFolderPickerSubmitting(null);
    setFolderPickerError("");
    setFolderPickerOpen(true);
    void loadFolderPickerLevel(null);
  }

  // Human: Open the folder picker to move one folder or the current folder selection.
  // Agent: SEEDS foldersToMove from seedFolder or selectedFolders; HIDES copy when files empty.
  function handleOpenFolderPickerForFolders(seedFolder?: FolderItem) {
    const foldersToMove =
      selectedFolders.length > 0 ? selectedFolders : seedFolder ? [seedFolder] : [];
    if (foldersToMove.length === 0) return;
    setFolderPickerFiles([]);
    setFolderPickerFoldersToMove(foldersToMove);
    setFolderPickerStack([]);
    setFolderPickerSubmitting(null);
    setFolderPickerError("");
    setFolderPickerOpen(true);
    void loadFolderPickerLevel(null);
  }

  const folderPickerExcludeIds = useMemo(
    () => new Set(folderPickerFoldersToMove.map((folder) => folder.id)),
    [folderPickerFoldersToMove],
  );

  // Human: Navigate the picker breadcrumb and refresh the folder listing for that level.
  // Agent: WRITES folderPickerStack; CALLS loadFolderPickerLevel with leaf id or null.
  function handleFolderPickerNavigate(stack: FolderPickerCrumb[]) {
    setFolderPickerStack(stack);
    void loadFolderPickerLevel(stack.at(-1)?.id ?? null);
  }

  const folderPickerTargetId = folderPickerStack.at(-1)?.id ?? null;
  const folderPickerDestinationLabel = folderPickerStack.at(-1)?.name ?? ROOT_FOLDER_LABEL;

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
      await refreshCurrentView({ silent: true });
      handleClearBrowserSelection();
      closeFolderPicker();
      toastSuccess(
        `Copied ${
          folderPickerFiles.length === 1
            ? `“${folderPickerFiles[0]!.name}”`
            : formatItemCount(folderPickerFiles.length)
        } to ${folderPickerDestinationLabel}`,
      );
    } catch (err) {
      const message = getErrorMessage(err);
      setFolderPickerError(message);
      setError(message);
    } finally {
      setFolderPickerSubmitting(null);
    }
  }

  // Human: Move selected files and folders into the folder currently shown in the picker.
  // Agent: CALLS runDriveMove (skips same-folder rows, toasts Undo); KEEPS failures inline in the dialog.
  async function handleFolderPickerMove() {
    setFolderPickerSubmitting("move");
    setFolderPickerError("");

    const result = await runDriveMove(
      folderPickerFiles,
      folderPickerFoldersToMove,
      folderPickerTargetId,
      folderPickerDestinationLabel,
    );
    setFolderPickerSubmitting(null);

    if (result.requested === 0) {
      setFolderPickerError("Everything selected is already in this folder.");
      return;
    }
    if (result.failure) {
      setFolderPickerError(result.failure);
      return;
    }
    handleClearBrowserSelection();
    closeFolderPicker();
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

  // Human: Open in-browser EPUB reader for .epub files.
  // Agent: SETS previewEpub; EpubPreviewDialog FETCHES bytes and RENDERS via epub.js.
  function handlePreviewEpub(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isEpubMime(file.mime_type, file.name)) return;
    recordFileAccess(file.id);
    setPreviewEpub(file);
  }

  // Human: Open the in-browser text/code editor for editable plain-text and source files.
  // Agent: SETS previewText; TextCodeEditorDialog FETCHES bytes and RENDERS themed editor chrome.
  function handlePreviewText(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (!isTextCodePreviewMime(file.mime_type, file.name)) return;
    recordFileAccess(file.id);
    setPreviewText(file);
  }

  // Human: Open the RTF rich-text editor — WYSIWYG formatting, not raw RTF source.
  // Agent: SETS previewRtf; RtfEditorDialog CONVERTS rtf↔html and SAVES via replaceTextFileContent.
  function handlePreviewRtf(file: FileItem, options?: { canEdit?: boolean }) {
    if (isFileProcessing(file)) return;
    if (!isRtfPreviewMime(file.mime_type, file.name)) return;
    recordFileAccess(file.id);
    setPreviewRtfCanEdit(options?.canEdit !== false);
    setPreviewRtf(file);
  }

  // Human: Route a file to the viewer or editor that matches its type.
  // Agent: RETURNS false when no viewer handles the type, so callers can fall back.
  function openFileByType(file: FileItem, options?: { canEdit?: boolean }): boolean {
    if (isRtfPreviewMime(file.mime_type, file.name)) {
      handlePreviewRtf(file, options);
      return true;
    }
    if (isTextCodePreviewMime(file.mime_type, file.name)) {
      handlePreviewText(file);
      return true;
    }
    if (isSpreadsheetPreviewMime(file.mime_type, file.name)) {
      handlePreviewSpreadsheet(file);
      return true;
    }
    if (isPdfMime(file.mime_type)) {
      handlePreviewPdf(file);
      return true;
    }
    if (isEpubMime(file.mime_type, file.name)) {
      handlePreviewEpub(file);
      return true;
    }
    if (isImageMime(file.mime_type)) {
      handlePreviewImage(file);
      return true;
    }
    if (isAudioMime(file.mime_type)) {
      handlePreviewAudio(file);
      return true;
    }
    if (file.mime_type?.startsWith("video/")) {
      handlePreviewVideo(file);
      return true;
    }
    return false;
  }

  // Human: Open a Shared with me file with the correct view/edit capability for collab.
  // Agent: MAPS SharedWithMeItem → FileItem; DELEGATES routing to openFileByType with canEdit.
  function handlePreviewGrantedFile(item: SharedWithMeItem) {
    if (item.resource_type !== "file") return;
    const file: FileItem = {
      id: item.resource_id,
      name: item.name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes ?? 0,
      folder_id: null,
      created_at: item.shared_at,
      updated_at: item.shared_at,
      hls_ready: false,
      hls_encode_status: null,
      conversion_progress: 0,
    };
    openFileByType(file, { canEdit: item.permission === "edit" });
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
  const videoPlayerFolderLabel = textEditorBranchLabel;

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
    void refresh(activeNav === "my-files" ? committedQuery || undefined : undefined, {
      silent: true,
      nav: activeNav,
    });
  }

  function handleSpreadsheetFileSaved(previousId: string, savedFile: FileItem) {
    setFiles((current) =>
      current.map((item) => (item.id === previousId ? savedFile : item)),
    );
    setPreviewSpreadsheet(savedFile);
    void refresh(activeNav === "my-files" ? committedQuery || undefined : undefined, {
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

  // Human: Sync HLS reprocess status into listings so the grid shows processing again.
  // Agent: MERGES hls_ready + encode fields; TRACKS transfer tray; CLOSES preview if this file was open.
  function handleHlsReprocessQueued(file: FileItem) {
    const patch = (item: FileItem): FileItem =>
      item.id === file.id
        ? {
            ...item,
            hls_ready: file.hls_ready,
            hls_encode_status: file.hls_encode_status,
            hls_encode_error: file.hls_encode_error,
            conversion_progress: file.conversion_progress,
          }
        : item;
    setFiles((current) => current.map(patch));
    setPreviewVideo((current) => (current?.id === file.id ? null : current));
    setDetailsTarget((current) =>
      current?.kind === "file" && current.file.id === file.id
        ? { kind: "file", file: patch(current.file) }
        : current,
    );
    // Human: Show rebuild progress in the floating transfer panel while the job runs.
    // Agent: CALLS trackHlsReprocessFiles so waitForFileIngestCompletion updates tray + grid.
    trackHlsReprocessFiles([file]);
  }

  // Human: After bulk rebuild, refresh the explorer and open the transfer tray for each job.
  // Agent: CALLS refresh silently; TRACKS active hls_encode jobs via trackActiveHlsEncodeJobs.
  async function handleHlsReprocessAllQueued() {
    setPreviewVideo(null);
    try {
      await refresh(undefined, { silent: true });
    } catch {
      // Queue toast already shown; silent refresh failure is non-fatal.
    }
    try {
      await trackActiveHlsEncodeJobs();
    } catch {
      // Tray recovery is best-effort; grid badges still update from listing poll.
    }
  }

  // Human: After cancelling unfinished rebuilds, refresh explorer so tiles show ready again.
  // Agent: Tray already updated by cancelAllPendingHlsReprocess; silent refresh of current folder.
  async function handleHlsReprocessAllCancelled(_result: {
    cancelled_files: number;
    cancelled_jobs: number;
  }) {
    clearCancelledHlsReprocessItems();
    try {
      await refresh(undefined, { silent: true });
    } catch {
      // Listing poll will eventually clear reprocessing badges.
    }
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

  // Human: Open the details overlay on the metadata or sharing tab.
  // Agent: SETS detailsTarget + detailsInitialTab; ResourceDetailsDialog manages tabs.
  function handleDetailsFile(file: FileItem, tab: "details" | "sharing" = "details") {
    if (isFileProcessing(file)) return;
    setDetailsInitialTab(tab);
    setDetailsTarget({ kind: "file", file });
    setDetailsOpen(true);
  }

  // Human: Context-menu Edit — type-specific editors (video poster, text, spreadsheet).
  // Agent: ROUTES video → details with thumbnail section; text/spreadsheet → preview editors.
  function handleEditFile(file: FileItem) {
    if (isFileProcessing(file)) return;
    if (file.mime_type?.startsWith("video/")) {
      // Human: Video edit opens details overlay where thumbnail management lives.
      handleDetailsFile(file, "details");
      return;
    }
    if (isSpreadsheetPreviewMime(file.mime_type, file.name)) {
      handlePreviewSpreadsheet(file);
      return;
    }
    if (isRtfPreviewMime(file.mime_type, file.name)) {
      handlePreviewRtf(file);
      return;
    }
    if (isTextCodePreviewMime(file.mime_type, file.name)) {
      handlePreviewText(file);
    }
  }

  function handleRtfFileSaved(previousId: string, savedFile: FileItem) {
    // Human: Keep the open RTF editor stable — only swap the file id/metadata after delete+reupload.
    // Agent: UPDATES files list + previewRtf; AVOIDS immediate full refresh that could remount the dialog.
    setFiles((current) =>
      current.map((item) => (item.id === previousId ? savedFile : item)),
    );
    setPreviewRtf(savedFile);
  }

  function handleDetailsFolder(folder: FolderItem, tab: "details" | "sharing" = "details") {
    setDetailsInitialTab(tab);
    setDetailsTarget({ kind: "folder", folder });
    setDetailsOpen(true);
  }

  // Human: Open the rename dialog for a file row — the dialog owns validation and the PATCH.
  // Agent: SKIPS files mid-processing, matching every other row action.
  const handleRenameFile = useCallback((file: FileItem) => {
    if (isFileProcessing(file)) return;
    setRenameTarget({ kind: "file", id: file.id, name: file.name });
  }, []);

  // Human: Open the rename dialog for a folder row.
  const handleRenameFolder = useCallback((folder: FolderItem) => {
    setRenameTarget({ kind: "folder", id: folder.id, name: folder.name });
  }, []);

  // Human: Put a renamed item back under its old name — the Undo action on the rename toast.
  // Agent: PATCHES the same id back; REFRESHES the open view; TOASTS success or the failure reason.
  async function undoRename(target: RenameTarget) {
    try {
      if (target.kind === "file") {
        await renameFile(target.id, target.name);
      } else {
        await renameFolder(target.id, target.name);
      }
      await refreshCurrentViewRef.current({ silent: true });
      toastSuccess(`Name restored to “${target.name}”`);
    } catch (err) {
      toastError(getErrorMessage(err));
    }
  }

  // Human: Refresh and confirm after the rename dialog completes, offering to put the old name back.
  // Agent: RECEIVES the pre-rename target, so undo already knows the name to restore.
  function handleRenamed(target: RenameTarget, nextName: string) {
    void refreshCurrentView({ silent: true });
    toastSuccess(`Renamed to “${nextName}”`, {
      duration: UNDOABLE_TOAST_MS,
      action: { label: "Undo", onClick: () => void undoRename(target) },
    });
  }

  // Human: Names already taken in the open listing, so the dialog can catch a clash before the PATCH.
  // Agent: SAME-KIND names only, excluding the item being renamed; the API enforces the real rule.
  const renameSiblingNames = useMemo(() => {
    if (!renameTarget) return [];
    return renameTarget.kind === "file"
      ? files.filter((file) => file.id !== renameTarget.id).map((file) => file.name)
      : folders.filter((folder) => folder.id !== renameTarget.id).map((folder) => folder.name);
  }, [files, folders, renameTarget]);

  /**
   * Human: Star or unstar files for the account.
   * Agent: OPTIMISTIC — the star flips immediately and rolls back if the request fails, so a
   *        dropped connection cannot leave the UI claiming something the server never stored.
   */
  async function applyFavouriteChange(fileIds: string[], starred: boolean) {
    if (fileIds.length === 0) return;
    const previous = favouriteIds;
    const next = new Set(previous);
    for (const fileId of fileIds) {
      if (starred) next.add(fileId);
      else next.delete(fileId);
    }
    setFavouriteIds(next);

    try {
      if (starred) await addFavouriteFiles(fileIds);
      else await removeFavouriteFiles(fileIds);
      if (activeNav === "favourites") {
        await refreshCurrentView({ silent: true });
      }
    } catch (err) {
      setFavouriteIds(previous);
      toastError(getErrorMessage(err));
    }
  }

  function handleToggleFavourite(fileId: string) {
    const file = files.find((item) => item.id === fileId);
    if (file && isFileProcessing(file)) return;
    void applyFavouriteChange([fileId], !favouriteIds.has(fileId));
  }

  // Human: Resolve selected ids to FileItem rows from the current in-memory listing.
  // Agent: READS files + selectedFileIds; RETURNS items still present in the library cache.
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileIds.has(file.id) && !isFileProcessing(file)),
    [files, selectedFileIds],
  );

  const selectedFolders = useMemo(
    () => folders.filter((folder) => selectedFolderIds.has(folder.id)),
    [folders, selectedFolderIds],
  );

  const totalSelectedCount = selectedFiles.length + selectedFolders.length;

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
    clearFileSelectionState();
  }

  // Human: Star every selected file, or clear them all when the whole selection is already starred.
  // Agent: ONE request for the batch; MOVES the selection toward a uniform state as before.
  function handleBulkToggleFavourite() {
    if (selectedFiles.length === 0) return;
    const allFavourited = selectedFiles.every((file) => favouriteIds.has(file.id));
    const targets = selectedFiles
      .filter((file) => favouriteIds.has(file.id) === allFavourited)
      .map((file) => file.id);
    void applyFavouriteChange(targets, !allFavourited);
    clearFileSelectionState();
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

  // Human: Selected videos that can accept a stream rebuild (same rules as details overlay).
  // Agent: FILTERS files by selectedFileIds + canRebuildVideoStream; USED by bulk toolbar button.
  const rebuildableSelectedVideos = useMemo(
    () => files.filter((file) => selectedFileIds.has(file.id) && canRebuildVideoStream(file)),
    [files, selectedFileIds],
  );

  // Human: Queue HLS rebuild for every rebuildable video in the current selection.
  // Agent: CALLS reprocessFileHls per file; MERGES via handleHlsReprocessQueued; TOAST summary.
  async function handleBulkRebuildStreams() {
    if (rebuildableSelectedVideos.length === 0 || bulkRebuildingStreams) return;

    setBulkRebuildingStreams(true);
    setError("");
    let queued = 0;
    let failed = 0;
    let lastError = "";

    try {
      for (const file of rebuildableSelectedVideos) {
        try {
          const { file: updated } = await reprocessFileHls(file.id);
          handleHlsReprocessQueued(updated);
          queued += 1;
        } catch (error) {
          failed += 1;
          lastError = getErrorMessage(error);
        }
      }

      if (queued > 0) {
        toastSuccess(
          queued === 1
            ? "Video stream rebuild started — play again when processing finishes."
            : `Queued ${queued} video streams for rebuild. Progress appears in the transfer tray.`,
        );
        handleClearBrowserSelection();
      }
      if (failed > 0) {
        const message =
          queued === 0
            ? lastError || "Could not start stream rebuild for the selected videos."
            : `${failed} video${failed === 1 ? "" : "s"} could not be queued${
                lastError ? `: ${lastError}` : "."
              }`;
        toastError(message);
        if (queued === 0) {
          setError(message);
        }
      }
    } finally {
      setBulkRebuildingStreams(false);
    }
  }

  // Human: Refresh drive state after bulk delete succeeds for one or more files.
  // Agent: CLEARS prefs + selection; REFRESHES the active My files view; OFFERS undo for recycles.
  function handleBulkDeleted(deletedIds: string[], options: { permanent: boolean }) {
    setError("");
    const deletedNames = deletedIds.map(
      (fileId) => bulkDeleteItems.find((item) => item.id === fileId)?.name,
    );
    for (const fileId of deletedIds) {
      removeFilePreferences(fileId);
    }
    clearFileSelectionState();
    setBulkDeleteItems([]);
    void refreshDashboard();
    void refreshCurrentView();

    if (options.permanent || deletedIds.length === 0) return;
    toastSuccess(describeRecycleSummary(deletedNames), {
      duration: UNDOABLE_TOAST_MS,
      action: { label: "Undo", onClick: () => void undoRecycle(deletedIds, []) },
    });
  }

  const bulkFavouriteLabel =
    selectedFiles.length > 0 &&
    selectedFiles.every((file) => favouriteIds.has(file.id))
      ? "Remove from favourites"
      : "Add to favourites";

  function handleNavChange(nav: NavItemId) {
    setActiveNav(nav);
    handleClearBrowserSelection();
    if (nav !== "my-files") {
      setQuery("");
      setTypeFilter("all");
      setFolderStack([]);
    }
  }

  // Human: Send the explorer to a folder trail — used by palette hits and reveal-in-folder.
  // Agent: LEAVES search mode so the target folder's own contents are what loads.
  function goToFolderPath(path: FolderPathSegment[]) {
    setActiveNav("my-files");
    setQuery("");
    setCommittedQuery("");
    setTypeFilter("all");
    handleClearBrowserSelection();
    setFolderStack(path.map((segment) => ({ id: segment.id, name: segment.name })));
  }

  /**
   * Human: Create an empty document in the open folder and drop straight into its editor.
   * Agent: BUILDS bytes client-side; REUSES the normal upload path, so quota, dedup and the
   *        transfer tray all behave exactly as they do for a picked file.
   */
  async function handleCreateDocument(template: NewDocumentTemplate) {
    if (creatingDocument) return;
    setCreatingDocument(true);
    setNewDocumentError("");

    try {
      const name = uniqueDocumentName(
        template.defaultBaseName,
        template.extension,
        files.map((file) => file.name),
      );
      const document = await buildNewDocumentFile(template, name);
      const { file: created } = await uploadFileWithProgress(document, undefined, {
        folderId: activeNav === "my-files" ? currentFolderId : null,
      });

      setNewDocumentOpen(false);
      await refreshCurrentView({ silent: true });
      void refreshDashboard();
      toastSuccess(`Created “${created.name}”`);
      openFileByType(created);
    } catch (err) {
      setNewDocumentError(getErrorMessage(err));
    } finally {
      setCreatingDocument(false);
    }
  }

  // Human: Open a palette hit — media and documents in their viewer, anything else in details.
  // Agent: FALLS BACK to the details overlay so every result stays actionable.
  function handleCommandPaletteOpenFile(file: FileItem) {
    if (!openFileByType(file)) {
      handleDetailsFile(file);
    }
  }

  // Human: Run the palette's query as a normal explorer search over the whole library.
  function handleCommandPaletteSearch(nextQuery: string) {
    setActiveNav("my-files");
    setFolderStack([]);
    handleClearBrowserSelection();
    setQuery(nextQuery);
    setCommittedQuery(nextQuery);
  }

  // Human: Perform one palette command — the same actions the sidebar and toolbar expose.
  // Agent: REUSES handleNavChange so nav side effects (clearing search/selection) stay in one place.
  function handleCommandPaletteAction(action: DriveCommandActionId) {
    switch (action) {
      case "upload":
        setUploadDialogOpen(true);
        break;
      case "new-folder":
        setActiveNav("my-files");
        setCreateFolderDialogOpen(true);
        break;
      case "new-document":
        setNewDocumentOpen(true);
        break;
      case "go-home":
        handleNavChange("home");
        break;
      case "go-my-files":
        handleNavChange("my-files");
        break;
      case "go-favourites":
        handleNavChange("favourites");
        break;
      case "go-shared-files":
        handleNavChange("shared-files");
        break;
      case "go-recycle-bin":
        handleNavChange("recycle-bin");
        break;
    }
  }

  // Human: Persist the explorer layout choice — purely client-side, no refetch needed.
  // Agent: WRITES ownly_explorer_view_mode; both layouts render the same already-loaded entries.
  function handleViewModeChange(mode: ExplorerViewMode) {
    setViewMode(mode);
    writeExplorerViewMode(mode);
  }

  // Human: Persist explorer file sort and reload the listing with server-side ordering.
  // Agent: WRITES ownly_explorer_file_sort; CALLS refresh so pagination matches sort mode.
  function handleFileSortChange(sort: ExplorerFileSort) {
    setFileSort(sort);
    writeExplorerFileSort(sort);
    if (activeNav === "my-files") {
      void refresh(committedQuery || undefined, { nav: activeNav, fileSort: sort });
    }
  }

  // Human: Open the bottom action sheet for one file or folder row on mobile.
  // Agent: WRITES mobileActionTarget + mobileActionsOpen; USED by FileListView ⋯ button.
  function handleOpenMobileActions(target: MobileActionTarget) {
    setMobileActionTarget(target);
    setMobileActionsOpen(true);
  }

  const displayUsedBytes = displayedStorageUsedBytes(usedBytes, reservedBytes);
  const usagePercent = Math.min(100, Math.round((displayUsedBytes / quotaBytes) * 100));
  // Human: Client-side name filter for the Home view when a search query is active.
  // Agent: MEMO avoids re-creating the filtered array on every render (e.g. upload progress ticks).
  const nameFilteredFiles = useMemo(
    () =>
      activeNav === "home" && committedQuery
        ? files.filter((file) => file.name.toLowerCase().includes(committedQuery.toLowerCase()))
        : files,
    [activeNav, committedQuery, files],
  );
  // Human: Browser file order — server paginates with sort=; client re-sorts for live upload patches.
  // Agent: CALLS sortExplorerFiles after listFiles/mergeExplorerFileRow updates.
  const browserFiles = useMemo(
    () => sortExplorerFiles(nameFilteredFiles, fileSort),
    [nameFilteredFiles, fileSort],
  );
  // Human: File ids in the current explorer listing that accept bulk selection (skips processing).
  // Agent: READS browserFiles; USED by Select all control and Ctrl+A on My files.
  const selectableBrowserFileIds = useMemo(
    () => browserFiles.filter((file) => !isFileProcessing(file)).map((file) => file.id),
    [browserFiles],
  );

  const visibleFolders = useMemo(
    () => sortFilesByName(folders),
    [folders],
  );

  const selectableBrowserFolderIds = useMemo(
    () => visibleFolders.map((folder) => folder.id),
    [visibleFolders],
  );

  // Human: Stable preview props objects — avoids fresh identity on every render defeating
  //        DynamicImportPreview's internal memo (which spreads previewProps into the child).
  const videoPreviewProps = useMemo(
    () => ({
      videos: galleryVideos,
      file: previewVideo!,
      open: true,
      onOpenChange: (open: boolean) => { if (!open) setPreviewVideo(null); },
      onFileChange: handleGalleryVideoChange,
      onDownload: handleDownload,
      onShare: handleShareFile,
      folderLabel: videoPlayerFolderLabel,
      onHlsReprocessQueued: handleHlsReprocessQueued,
    }),
    [galleryVideos, previewVideo, handleGalleryVideoChange, handleDownload, handleShareFile, videoPlayerFolderLabel, handleHlsReprocessQueued],
  );
  const imagePreviewProps = useMemo(
    () => ({
      images: galleryImages,
      file: previewImage!,
      open: true,
      onOpenChange: (open: boolean) => { if (!open) setPreviewImage(null); },
      onFileChange: handleGalleryImageChange,
      onDownload: handleDownload,
      onShare: handleShareFile,
    }),
    [galleryImages, previewImage, handleGalleryImageChange, handleDownload, handleShareFile],
  );
  const pdfPreviewProps = useMemo(
    () => ({
      file: previewPdf!,
      open: true,
      onOpenChange: (open: boolean) => { if (!open) setPreviewPdf(null); },
      onDownload: handleDownload,
    }),
    [previewPdf, handleDownload],
  );
  const epubPreviewProps = useMemo(
    () => ({
      file: previewEpub!,
      open: true,
      onOpenChange: (open: boolean) => { if (!open) setPreviewEpub(null); },
      onDownload: handleDownload,
    }),
    [previewEpub, handleDownload],
  );
  const textPreviewProps = useMemo(
    () => ({
      tabs: galleryTextFiles,
      file: previewText!,
      open: true,
      branchLabel: textEditorBranchLabel,
      onOpenChange: (open: boolean) => { if (!open) setPreviewText(null); },
      onFileChange: handleGalleryTextChange,
      onFileSaved: handleTextFileSaved,
    }),
    [galleryTextFiles, previewText, textEditorBranchLabel, handleGalleryTextChange, handleTextFileSaved],
  );
  const allBrowserItemsSelected =
    (selectableBrowserFileIds.length > 0 || selectableBrowserFolderIds.length > 0) &&
    selectableBrowserFileIds.every((fileId) => selectedFileIds.has(fileId)) &&
    selectableBrowserFolderIds.every((folderId) => selectedFolderIds.has(folderId));

  // Human: Add every visible, selectable file and folder to the current bulk selection.
  // Agent: MERGES selectable ids into selectedFileIds + selectedFolderIds Sets.
  const handleSelectAllBrowserFiles = useCallback(() => {
    const nextFiles = new Set(selectedFileIdsRef.current);
    for (const fileId of selectableBrowserFileIds) {
      nextFiles.add(fileId);
    }
    const nextFolders = new Set(selectedFolderIdsRef.current);
    for (const folderId of selectableBrowserFolderIds) {
      nextFolders.add(folderId);
    }
    if (
      nextFiles.size === selectedFileIdsRef.current.size &&
      nextFolders.size === selectedFolderIdsRef.current.size
    ) {
      return;
    }
    commitFileSelection(nextFiles);
    commitFolderSelection(nextFolders);
  }, [selectableBrowserFileIds, selectableBrowserFolderIds]);

  const recentFiles = sortFilesByRecentAccess(nameFilteredFiles, 12);
  const overviewFolders = useMemo(
    () => (activeNav === "home" ? sortFilesByName(folders) : []),
    [activeNav, folders],
  );
  const initials = userInitials(user?.email);

  // Human: A listing fetched while the connection was down is stale — reload it once it returns.
  // Agent: SILENT refresh so rows stay put; only fires on the offline→online edge, not on mount.
  const online = useOnlineStatus();
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    void refreshCurrentViewRef.current({ silent: true });
  }, [online]);

  // Human: Cmd/Ctrl+K opens the command palette from anywhere in the drive.
  // Agent: SKIPS text inputs and open dialogs so editors keep their own chord shortcuts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (isEditableTarget || target?.closest("[role='dialog'], dialog") !== null) return;

      event.preventDefault();
      setCommandPaletteOpen(true);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Human: Ctrl+A selects all files; F2 renames when exactly one file is checked.
  // Agent: LISTENS document keydown on my-files; SKIPS inputs and contenteditable targets.
  useEffect(() => {
    if (activeNav !== "my-files") {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
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

      if (event.key === "F2" && selectedFileIds.size === 1 && selectedFolderIds.size === 0) {
        const fileId = [...selectedFileIds][0];
        const file = files.find((item) => item.id === fileId);
        if (file) {
          event.preventDefault();
          handleRenameFile(file);
        }
        return;
      }

      if (event.key === "F2" && selectedFolderIds.size === 1 && selectedFileIds.size === 0) {
        const folderId = [...selectedFolderIds][0];
        const folder = folders.find((item) => item.id === folderId);
        if (folder) {
          event.preventDefault();
          handleRenameFolder(folder);
        }
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") {
        return;
      }
      if (selectableBrowserFileIds.length === 0 && selectableBrowserFolderIds.length === 0) {
        return;
      }
      event.preventDefault();
      handleSelectAllBrowserFiles();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    activeNav,
    files,
    handleRenameFile,
    handleRenameFolder,
    handleSelectAllBrowserFiles,
    selectableBrowserFileIds.length,
    selectableBrowserFolderIds.length,
    selectedFileIds,
    selectedFolderIds,
    folders,
  ]);

  return (
    <DriveContextMenu
      files={files}
      folders={visibleFolders}
      activeNav={activeNav}
      selectedFileIds={selectedFileIds}
      selectedFolderIds={selectedFolderIds}
      onDownload={handleDownload}
      onDownloadFolder={handleDownloadFolder}
      onPreviewVideo={handlePreviewVideo}
      onPreviewImage={handlePreviewImage}
      onPreviewPdf={handlePreviewPdf}
      onPreviewEpub={handlePreviewEpub}
      onPreviewText={handlePreviewText}
      onPreviewRtf={handlePreviewRtf}
      onPreviewSpreadsheet={handlePreviewSpreadsheet}
      onPreviewAudio={handlePreviewAudio}
      onDelete={requestDeleteFile}
      onDeleteFolder={requestDeleteFolder}
      onBulkDelete={handleBulkDeleteRequest}
      onUpload={() => setUploadDialogOpen(true)}
      onCreateFolder={() => setCreateFolderDialogOpen(true)}
      onRefresh={() =>
        void refresh(activeNav === "my-files" ? committedQuery || undefined : undefined)
      }
      onNavChange={handleNavChange}
      onShareFile={handleShareFile}
      onShareFolder={handleShareFolder}
      onDetailsFile={handleDetailsFile}
      onEditFile={handleEditFile}
      onDetailsFolder={handleDetailsFolder}
      onCopyToFolder={handleOpenFolderPicker}
      onMoveToFolder={handleOpenFolderPicker}
      onMoveFolderToFolder={(folder) => handleOpenFolderPickerForFolders(folder)}
      onRenameFile={handleRenameFile}
      onRenameFolder={handleRenameFolder}
      explorerDragActive={explorerDragActive}
      enableMobileSelectActions={!isDesktopViewport}
      onEnterMobileSelection={handleEnterMobileSelection}
    >
      {/* Human: Full-viewport shell — header stays fixed; only the main pane scrolls. */}
      {/* Agent: flex + overflow-hidden; WRITES scroll containment on main, not document body. */}
      {/* Human: NOT h-screen. `100vh` is the LARGE viewport, so on mobile it stays tall enough to
          sit behind the browser's collapsible URL bar — the bottom nav and the explorer status
          strip anchored to the pane floor then fell outside the visible area until the bar
          collapsed. svh is the always-safe height; dvh tracks the chrome where supported.
          Agent: Same pattern the media dialogs already use (PdfPreviewSurfaceMobile et al). */}
      <div
        className="flex h-[100svh] flex-col overflow-hidden bg-surface text-ink supports-[height:100dvh]:h-dvh"
        onDragOver={(event) => {
          if (!event.dataTransfer?.types?.includes("Files")) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (activeNav !== "my-files") return;
          const files = event.dataTransfer?.files;
          if (!files?.length) return;
          // Human: Ignore internal explorer move drags — only external OS file drops open Upload.
          const types = Array.from(event.dataTransfer.types);
          const hasExplorerPayload =
            types.includes("application/x-ownly-file-id") ||
            types.includes("application/x-ownly-folder-id");
          if (hasExplorerPayload) return;
          event.preventDefault();
          setUploadDropFiles(Array.from(files));
          setUploadDialogOpen(true);
        }}
      >
        <UploadDialog
          open={uploadDialogOpen}
          onOpenChange={(open) => {
            setUploadDialogOpen(open);
            if (!open) setUploadDropFiles(undefined);
          }}
          folderId={activeNav === "my-files" ? currentFolderId : null}
          effectiveRemainingBytes={effectiveRemainingBytes}
          storageLimitKind={storageLimitKind}
          onRefreshStorageLimits={prepareUploadStorageLimits}
          initialFiles={uploadDropFiles}
          onLibraryChanged={() =>
            void refresh(activeNav === "my-files" ? committedQuery || undefined : undefined, {
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
            void refresh(activeNav === "my-files" ? committedQuery || undefined : undefined, {
              silent: true,
            })
          }
        />
        {/* Human: Media preview dialogs load dedicated chunks on first open via dynamic import(). */}
        {/* Agent: DynamicImportPreview + load*PreviewDialog; MOUNTS only when preview state is non-null. */}
        {previewVideo !== null ? (
          <DynamicImportPreview
            loader={loadVideoPreviewDialog}
            previewProps={videoPreviewProps}
          />
        ) : null}
        {previewImage !== null ? (
          <DynamicImportPreview
            loader={loadImagePreviewDialog}
            previewProps={imagePreviewProps}
          />
        ) : null}
        {previewPdf !== null ? (
          <DynamicImportPreview
            loader={loadPdfPreviewDialog}
            previewProps={pdfPreviewProps}
          />
        ) : null}
        {previewEpub !== null ? (
          <DynamicImportPreview
            loader={loadEpubPreviewDialog}
            previewProps={epubPreviewProps}
          />
        ) : null}
        {previewText !== null ? (
          <DynamicImportPreview
            loader={loadTextCodeEditorDialog}
            previewProps={textPreviewProps}
          />
        ) : null}
        {previewRtf !== null ? (
          <DynamicImportPreview
            loader={loadRtfEditorDialog}
            previewProps={{
              file: previewRtf,
              open: true,
              canEdit: previewRtfCanEdit,
              onOpenChange: (open) => {
                if (!open) {
                  setPreviewRtf(null);
                  setPreviewRtfCanEdit(true);
                }
              },
              onFileSaved: handleRtfFileSaved,
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
        <DriveCommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          onOpenFile={handleCommandPaletteOpenFile}
          onOpenFolderPath={goToFolderPath}
          onSearchInDrive={handleCommandPaletteSearch}
          onRunAction={handleCommandPaletteAction}
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
          isFavourited={
            detailsTarget?.kind === "file"
              ? favouriteIds.has(detailsTarget.file.id)
              : false
          }
          onToggleFavourite={handleToggleFavourite}
          onThumbnailSelected={handleVideoThumbnailSelected}
          onThumbnailUpdated={handleVideoThumbnailUpdated}
          onHlsReprocessQueued={handleHlsReprocessQueued}
          onHlsReprocessAllQueued={handleHlsReprocessAllQueued}
          onHlsReprocessAllCancelled={handleHlsReprocessAllCancelled}
        />
        <NewDocumentDialog
          open={newDocumentOpen}
          onOpenChange={(open) => {
            setNewDocumentOpen(open);
            if (!open) setNewDocumentError("");
          }}
          destinationLabel={
            activeNav === "my-files"
              ? (folderStack.at(-1)?.name ?? ROOT_FOLDER_LABEL)
              : ROOT_FOLDER_LABEL
          }
          error={newDocumentError}
          creating={creatingDocument}
          onCreate={(template) => void handleCreateDocument(template)}
        />
        <RenameDialog
          target={renameTarget}
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
          siblingNames={renameSiblingNames}
          onRenamed={handleRenamed}
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
          foldersToMove={folderPickerFoldersToMove}
          excludeFolderIds={folderPickerExcludeIds}
          folderStack={folderPickerStack}
          folders={folderPickerFolders}
          loading={folderPickerLoading}
          error={folderPickerError}
          submitting={folderPickerSubmitting}
          onNavigate={handleFolderPickerNavigate}
          onCopy={handleFolderPickerCopy}
          onMove={handleFolderPickerMove}
        />
        <MobileSidebarSheet
          open={mobileSidebarOpen}
          onOpenChange={setMobileSidebarOpen}
          activeNav={activeNav}
          usedBytes={displayUsedBytes}
          quotaBytes={quotaBytes}
          usagePercent={usagePercent}
          onNavChange={handleNavChange}
          onUpload={() => setUploadDialogOpen(true)}
          onCreateFolder={() => {
            setActiveNav("my-files");
            setCreateFolderDialogOpen(true);
          }}
          storageBar={<StorageUsageBar usedBytes={displayUsedBytes} quotaBytes={quotaBytes} />}
        />
        <MobileFileActionsSheet
          target={mobileActionTarget}
          open={mobileActionsOpen}
          onOpenChange={(open) => {
            setMobileActionsOpen(open);
            if (!open) setMobileActionTarget(null);
          }}
          onDownload={handleDownload}
          onDownloadFolder={handleDownloadFolder}
          onDelete={requestDeleteFile}
          onDeleteFolder={requestDeleteFolder}
          onBulkDelete={handleBulkDeleteRequest}
          onShareFile={handleShareFile}
          onShareFolder={handleShareFolder}
          onDetailsFile={handleDetailsFile}
          onDetailsFolder={handleDetailsFolder}
          onPreviewVideo={handlePreviewVideo}
          onPreviewImage={handlePreviewImage}
          onPreviewPdf={handlePreviewPdf}
          onPreviewEpub={handlePreviewEpub}
          onPreviewText={handlePreviewText}
      onPreviewRtf={handlePreviewRtf}
          onPreviewSpreadsheet={handlePreviewSpreadsheet}
          onPreviewAudio={handlePreviewAudio}
          onCopyToFolder={handleOpenFolderPicker}
          onMoveToFolder={handleOpenFolderPicker}
          selectedFileIds={selectedFileIds}
          bulkSelectionCount={totalSelectedCount}
          onEnterMobileSelection={handleEnterMobileSelection}
        />
      <MobileDriveHeader
        activeNav={activeNav}
        folderStack={folderStack}
        query={query}
        onQueryChange={setQuery}
        onQuerySubmit={() => setCommittedQuery(query.trim())}
        displayName={profileDisplayName}
        roleLabel={profileRoleLabel}
        initials={initials}
        email={user?.email}
        isAdmin={isAdmin}
        profileOpen={profileOpen}
        profileRef={mobileProfileRef}
        onProfileToggle={() => setProfileOpen((open) => !open)}
        onLogout={handleSignOut}
        onMenuOpen={() => setMobileSidebarOpen(true)}
        onBack={() => goToFolderIndex(folderStack.length - 2)}
      />

      {/* Human: One full-height row at every width — the sidebar is display:none below lg, so a
          leading `auto` row would swallow <main> and size it to its content instead of the
          viewport, stranding the sticky status strip mid-list.
          Agent: grid-rows-1 == repeat(1, minmax(0,1fr)); lg adds the 260px sidebar column. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <DriveSidebar
          activeNav={activeNav}
          usedBytes={displayUsedBytes}
          quotaBytes={quotaBytes}
          onNavChange={handleNavChange}
        />

        {/* Human: Main column — desktop topbar plus the single scrollable body pane. */}
        {/* Agent: flex col on lg; topbar shrink-0; mainScrollRef on inner pane for explorer scroll sync. */}
        {/*        Every nav now shares one base surface, so no per-nav background branch remains. */}
        <main className="relative flex min-h-0 flex-col overflow-hidden bg-surface">
          {/* Human: No side gutters here — the bar spans the whole column and carries its own
              padding; this className only sets the gap down to the content below. */}
          <DriveDesktopTopbar
            displayName={profileDisplayName}
            roleLabel={profileRoleLabel}
            initials={initials}
            email={user?.email}
            isAdmin={isAdmin}
            {...(activeNav === "my-files"
              ? { leadingSlotRef: setTopbarBreadcrumbSlot }
              : { title: DRIVE_NAV_TITLES[activeNav] })}
            onSignOut={handleSignOut}
            className={cn(
              "max-lg:hidden",
              // Human: My Cloud's sticky toolbar sits directly under the bar so the two read as
              // one header stack. A margin there would also leave a dead band between them once
              // the list scrolls, because the toolbar sticks to the pane top, not to the bar.
              activeNav === "my-files"
                ? "mb-0"
                : activeNav === "home" || activeNav === "shared-files"
                  ? "mb-8"
                  : "mb-6",
            )}
          />

          <div
            ref={mainScrollRef}
            className={cn(
              // Human: md only widens the gutters — it must not set padding-bottom, or the
              // tablet band (768–1023px) loses the clearance for the bottom nav, which stays
              // visible until lg. Content then scrolls underneath it.
              "min-h-0 flex-1 overflow-y-auto px-4 pt-4 md:px-6 md:pt-6 lg:px-12 lg:pb-12 lg:pt-0",
              totalSelectedCount > 0
                ? "pb-[calc(8.5rem+env(safe-area-inset-bottom))]"
                : "pb-[calc(5.25rem+env(safe-area-inset-bottom))]",
              // Human: My Cloud ends in a sticky status strip, which must sit flush with the
              // scrollport floor. Desktop bottom padding would otherwise leave a gap that
              // file rows scroll through underneath the bar.
              // Agent: Below lg the padding stays — it clears the fixed bottom nav, and the
              //        strip pins to the resulting content-box floor.
              activeNav === "my-files" && "lg:pb-0",
              explorerTouchScrollLocked && "touch-none overflow-hidden overscroll-none",
            )}
          >
          <div
            className={cn(
              "flex min-h-full flex-col gap-4 max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:shadow-none",
              activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files"
                ? "lg:min-h-full"
                : "rounded-xl border border-edge bg-panel p-4 shadow-sm md:p-6 lg:flex lg:min-h-full lg:gap-4 lg:p-6",
            )}
          >
            <div
              className={cn(
                "hidden flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex",
                (activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files") && "lg:hidden",
              )}
            >
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-semibold text-ink">
                  {activeNav === "recycle-bin" ? "Recycle bin" : "Library"}
                </h1>
                <p className="text-sm text-ink-muted">
                  {activeNav === "recycle-bin"
                    ? "Restore deleted files and folders, or remove them permanently"
                    : "Browse everything in your library"}
                </p>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
                <AlertAction>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-destructive/30 bg-background text-destructive hover:bg-destructive/5"
                    onClick={() => {
                      setError("");
                      void refresh();
                    }}
                  >
                    Try again
                  </Button>
                </AlertAction>
              </Alert>
            ) : null}

            <Separator
              className={cn(
                "hidden bg-edge lg:block",
                (activeNav === "home" || activeNav === "my-files" || activeNav === "shared-files") && "lg:hidden",
              )}
            />

            {activeNav === "my-files" || activeNav === "favourites" ? (
              // Human: Grow to the pane floor without shrinking below the file list.
              // Agent: `min-h-full` cannot chain — a % min-height against an auto-height parent
              //        resolves to auto, which stranded the explorer's status strip mid-list.
              <div className="flex grow flex-col shrink-0">
                {/* Human: Bulk bar renders inside the explorer's sticky toolbar block so the two */}
                {/* no longer compete for `top: 0`. Mobile is unaffected — BulkActionsBar positions */}
                {/* itself `fixed` above the bottom nav regardless of its DOM position. */}
                <DriveCloudExplorer
                  breadcrumbPortalTarget={topbarBreadcrumbSlot}
                  bulkActionsSlot={
                    totalSelectedCount > 0 ? (
                      <div className="max-lg:contents lg:pt-2.5">
                        <BulkActionsBar
                          selectedCount={totalSelectedCount}
                          selectableCount={
                            selectableBrowserFileIds.length + selectableBrowserFolderIds.length
                          }
                          allSelected={allBrowserItemsSelected}
                          onSelectAll={handleSelectAllBrowserFiles}
                          favouriteLabel={bulkFavouriteLabel}
                          onDownload={handleBulkDownload}
                          onToggleFavourite={handleBulkToggleFavourite}
                          onDelete={handleBulkDeleteRequest}
                          onClearSelection={handleClearBrowserSelection}
                          onCopyToFolder={
                            selectedFiles.length > 0 ? handleOpenFolderPicker : undefined
                          }
                          onMoveToFolder={handleOpenFolderPicker}
                          showMobileFolderActions={!isDesktopViewport}
                          onRebuildStreams={() => void handleBulkRebuildStreams()}
                          rebuildingStreams={bulkRebuildingStreams}
                          rebuildableStreamCount={rebuildableSelectedVideos.length}
                        />
                      </div>
                    ) : null
                  }
                  folderStack={folderStack}
                  folders={visibleFolders}
                  files={browserFiles}
                  query={query}
                  onQueryChange={setQuery}
                  onQuerySubmit={() => setCommittedQuery(query.trim())}
                  typeFilter={typeFilter}
                  onTypeFilterChange={setTypeFilter}
                  typeFilterOptions={TYPE_FILTERS}
                  fileSort={fileSort}
                  onFileSortChange={handleFileSortChange}
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
                  instanceName={instanceName}
                  usedBytes={displayUsedBytes}
                  quotaBytes={quotaBytes}
                  totalFolderCount={folderCount}
                  totalFileCount={fileCount}
                  selectedCount={totalSelectedCount}
                  onSelectAll={handleSelectAllBrowserFiles}
                  onClearSelection={handleClearBrowserSelection}
                  allSelected={allBrowserItemsSelected}
                  onDeleteFile={requestDeleteFile}
                  onDeleteFolder={requestDeleteFolder}
                  listMode={explorerListMode}
                  firstRun={isFirstRunLibrary}
                  loading={loading}
                  dragEnabled={explorerListMode === "folder"}
                  selectable
                  selectedFileIds={selectedFileIds}
                  onSelectedFileIdsChange={handleSelectedFileIdsChange}
                  selectedFolderIds={selectedFolderIds}
                  onSelectedFolderIdsChange={handleSelectedFolderIdsChange}
                  fileShareFlags={fileShareFlags}
                  folderShareFlags={folderShareFlags}
                  favouriteFileIds={favouriteIds}
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
                  onCreateDocument={() => setNewDocumentOpen(true)}
                  onUpload={() => setUploadDialogOpen(true)}
                  onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                  mobileSelectionMode={mobileSelectionMode}
                  onTapToggleFileSelection={handleTapToggleFileSelection}
                  onMoveFileToFolder={(fileId, folderId) =>
                    void handleExplorerMoveFileToFolder(fileId, folderId)
                  }
                  onMoveFolderToParent={(folderId, parentId) =>
                    void handleExplorerMoveFolderToParent(folderId, parentId)
                  }
                  onPreviewVideo={handlePreviewVideo}
                  onPreviewImage={handlePreviewImage}
                  onPreviewPdf={handlePreviewPdf}
      onPreviewEpub={handlePreviewEpub}
                  onPreviewText={handlePreviewText}
      onPreviewRtf={handlePreviewRtf}
                  onPreviewSpreadsheet={handlePreviewSpreadsheet}
                  onPreviewAudio={handlePreviewAudio}
                  onOpenActions={handleOpenMobileActions}
                  onExplorerDragActiveChange={setExplorerDragActive}
                  onExplorerTouchScrollLockChange={setExplorerTouchScrollLocked}
                />
              </div>
            ) : loading && activeNav !== "shared-files" ? (
              <p className="py-12 text-center text-sm text-ink-muted">Loading files…</p>
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
                onPreviewGrantedFile={handlePreviewGrantedFile}
              />
            ) : activeNav === "home" ? (
              <DriveOverviewPanel
                folders={overviewFolders}
                recentFiles={recentFiles}
                usedBytes={displayUsedBytes}
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
                onPreviewEpub={handlePreviewEpub}
                onPreviewText={handlePreviewText}
      onPreviewRtf={handlePreviewRtf}
                onPreviewSpreadsheet={handlePreviewSpreadsheet}
                onPreviewAudio={handlePreviewAudio}
              />
            ) : null}

            {/* Human: Status line for the non-explorer navs. My Cloud has its own always-visible */}
            {/* ExplorerStatusBar, which shows the same counts on mobile too, so it is skipped here. */}
            {/* Agent: RENDERS for home/shared-files/recycle-bin only; my-files → ExplorerStatusBar. */}
            {activeNav !== "my-files" ? (
              <p className="mt-auto hidden text-xs text-ink-muted lg:block">
                {instanceName}
                {activeNav === "home"
                  ? ` · ${overviewFolders.length} folder${overviewFolders.length === 1 ? "" : "s"} · ${recentFiles.length} recent`
                  : activeNav === "shared-files"
                    ? " · Files shared with you and by you"
                    : " · Deleted items are kept for 30 days"}
              </p>
            ) : null}
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
