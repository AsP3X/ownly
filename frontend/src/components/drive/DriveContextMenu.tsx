// Human: Right-click menu for the drive shell — Ownly Pencil explorer context menus (text-first file rows).
// Agent: modal={false}; SubmenuTrigger inherits Base UI safePolygon; workspace rows use small leading Lucide icons only.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { CheckSquare, Clipboard, FolderPlus, RefreshCw, Upload } from "lucide-react";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import { isAudioMime, isEpubMime, isPdfMime, isSpreadsheetPreviewMime, isTextCodePreviewMime } from "@/lib/utils-app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import type { DriveNavId } from "@/components/drive/DriveSidebar";

type NavItemId = DriveNavId;

type DriveContextMenuProps = {
  children: ReactNode;
  files: FileItem[];
  folders: FolderItem[];
  favouriteIds: Set<string>;
  activeNav: NavItemId;
  selectedFileIds?: Set<string>;
  selectedFolderIds?: Set<string>;
  onDownload: (file: FileItem) => void;
  onDownloadFolder: (folder: FolderItem) => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewEpub?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  onDelete: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** Human: Delete every checked file when the context menu targets one of them. */
  onBulkDelete?: () => void;
  onToggleFavourite: (fileId: string) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  onNavChange: (nav: NavItemId) => void;
  onShareFile: (file: FileItem) => void;
  onShareFolder: (folder: FolderItem) => void;
  onDetailsFile: (file: FileItem) => void;
  onDetailsFolder: (folder: FolderItem) => void;
  /** Human: Type-specific edit (video thumbnail, text/spreadsheet editor). */
  onEditFile?: (file: FileItem) => void;
  /** Human: Queue HLS stream rebuild for a video with A/V freezes or desync. */
  onReprocessHls?: (file: FileItem) => void;
  onCopyToFolder?: () => void;
  onMoveToFolder?: () => void;
  /** Human: Opens the folder picker to move the right-clicked folder (or bulk folder selection). */
  onMoveFolderToFolder?: (folder?: FolderItem) => void;
  onRenameFile?: (file: FileItem) => void;
  onRenameFolder?: (folder: FolderItem) => void;
  /** Human: True while a file is being dragged — menu closes and won't reopen until drag ends. */
  explorerDragActive?: boolean;
  /** Human: Show "Select" on file rows for mobile multi-select entry. */
  enableMobileSelectActions?: boolean;
  /** Human: Enter tap-to-select mode and check the target file. */
  onEnterMobileSelection?: (fileId: string) => void;
};

type FileOpenHandlers = {
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewEpub?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  onDetailsFile?: (file: FileItem) => void;
};

// Human: True when a default Open target exists for this mime (preview or details fallback).
// Agent: READS mime helpers + optional handlers; USED to disable the Open split button.
function canDefaultOpenFile(file: FileItem, handlers: FileOpenHandlers): boolean {
  if (file.mime_type?.startsWith("video/")) {
    return Boolean(file.hls_ready && handlers.onPreviewVideo);
  }
  if (file.mime_type?.startsWith("image/")) {
    return Boolean(handlers.onPreviewImage);
  }
  if (isPdfMime(file.mime_type)) {
    return Boolean(handlers.onPreviewPdf);
  }
  if (isEpubMime(file.mime_type, file.name)) {
    return Boolean(handlers.onPreviewEpub);
  }
  if (isSpreadsheetPreviewMime(file.mime_type, file.name)) {
    return Boolean(handlers.onPreviewSpreadsheet);
  }
  if (isTextCodePreviewMime(file.mime_type, file.name)) {
    return Boolean(handlers.onPreviewText);
  }
  if (isAudioMime(file.mime_type)) {
    return Boolean(handlers.onPreviewAudio);
  }
  // Human: Generic files still open Details as the default Open action.
  return Boolean(handlers.onDetailsFile);
}

// Human: Primary Open — prefer in-app preview for media/docs; fall back to Details.
// Agent: CALLS the first matching preview handler; ELSE onDetailsFile.
function openFileDefault(file: FileItem, handlers: FileOpenHandlers): void {
  if (file.mime_type?.startsWith("video/") && file.hls_ready && handlers.onPreviewVideo) {
    handlers.onPreviewVideo(file);
    return;
  }
  if (file.mime_type?.startsWith("image/") && handlers.onPreviewImage) {
    handlers.onPreviewImage(file);
    return;
  }
  if (isPdfMime(file.mime_type) && handlers.onPreviewPdf) {
    handlers.onPreviewPdf(file);
    return;
  }
  if (isEpubMime(file.mime_type, file.name) && handlers.onPreviewEpub) {
    handlers.onPreviewEpub(file);
    return;
  }
  if (isSpreadsheetPreviewMime(file.mime_type, file.name) && handlers.onPreviewSpreadsheet) {
    handlers.onPreviewSpreadsheet(file);
    return;
  }
  if (isTextCodePreviewMime(file.mime_type, file.name) && handlers.onPreviewText) {
    handlers.onPreviewText(file);
    return;
  }
  if (isAudioMime(file.mime_type) && handlers.onPreviewAudio) {
    handlers.onPreviewAudio(file);
    return;
  }
  handlers.onDetailsFile?.(file);
}

type FileEditHandlers = {
  onEditFile?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
};

// Human: Edit is available for videos (poster), text, and spreadsheets.
// Agent: READS mime; USES onEditFile when provided, else text/spreadsheet previews.
function canEditFile(file: FileItem, handlers: FileEditHandlers): boolean {
  if (handlers.onEditFile) {
    if (file.mime_type?.startsWith("video/")) return true;
    if (isSpreadsheetPreviewMime(file.mime_type, file.name)) return true;
    if (isTextCodePreviewMime(file.mime_type, file.name)) return true;
    return false;
  }
  if (isSpreadsheetPreviewMime(file.mime_type, file.name)) {
    return Boolean(handlers.onPreviewSpreadsheet);
  }
  if (isTextCodePreviewMime(file.mime_type, file.name)) {
    return Boolean(handlers.onPreviewText);
  }
  return false;
}

function editFile(file: FileItem, handlers: FileEditHandlers): void {
  if (handlers.onEditFile) {
    handlers.onEditFile(file);
    return;
  }
  if (isSpreadsheetPreviewMime(file.mime_type, file.name)) {
    handlers.onPreviewSpreadsheet?.(file);
    return;
  }
  if (isTextCodePreviewMime(file.mime_type, file.name)) {
    handlers.onPreviewText?.(file);
  }
}

// Human: Walk DOM ancestors to find the file row or card that received the right click.
// Agent: READS data-file-id attribute; RETURNS file id or null for workspace-level menu.
function findFileIdFromEvent(event: Event): string | null {
  let node = event.target;
  while (node instanceof Element) {
    const fileId = node.getAttribute("data-file-id");
    if (fileId) return fileId;
    node = node.parentElement;
  }
  return null;
}

// Human: Walk DOM ancestors to find the folder row that received the right click.
// Agent: READS data-folder-id attribute; RETURNS folder id or null when a file row was not hit first.
function findFolderIdFromEvent(event: Event): string | null {
  let node = event.target;
  while (node instanceof Element) {
    if (node.hasAttribute("data-file-id")) return null;
    const folderId = node.getAttribute("data-folder-id");
    if (folderId) return folderId;
    node = node.parentElement;
  }
  return null;
}

export function DriveContextMenu({
  children,
  files,
  folders,
  favouriteIds,
  activeNav,
  selectedFileIds,
  selectedFolderIds,
  onDownload,
  onDownloadFolder,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewEpub,
  onPreviewText,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onDelete,
  onDeleteFolder,
  onBulkDelete,
  onToggleFavourite,
  onUpload,
  onCreateFolder,
  onRefresh,
  onNavChange,
  onShareFile,
  onShareFolder,
  onDetailsFile,
  onDetailsFolder,
  onEditFile,
  onReprocessHls,
  onCopyToFolder,
  onMoveToFolder,
  onMoveFolderToFolder,
  onRenameFile,
  onRenameFolder,
  explorerDragActive = false,
  enableMobileSelectActions = false,
  onEnterMobileSelection,
}: DriveContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [targetFileId, setTargetFileId] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [lastExplorerDragActive, setLastExplorerDragActive] = useState(explorerDragActive);

  // Human: Close an open menu as soon as drag starts without waiting for the next pointer event.
  // Agent: ADJUSTS open + target state during render when explorerDragActive flips true.
  if (explorerDragActive !== lastExplorerDragActive) {
    setLastExplorerDragActive(explorerDragActive);
    if (explorerDragActive) {
      setOpen(false);
      setTargetFileId(null);
      setTargetFolderId(null);
    }
  }

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const targetFile = targetFileId ? fileById.get(targetFileId) : undefined;
  const targetFolder = targetFolderId ? folderById.get(targetFolderId) : undefined;
  const targetFavourited = targetFile ? favouriteIds.has(targetFile.id) : false;
  const targetProcessing = targetFile ? isFileProcessing(targetFile) : false;
  const targetIsVideo = targetFile?.mime_type?.startsWith("video/") ?? false;
  const multiSelectedFileCount = selectedFileIds?.size ?? 0;
  const multiSelectedFolderCount = selectedFolderIds?.size ?? 0;
  const multiSelectedCount = multiSelectedFileCount + multiSelectedFolderCount;
  const bulkSelectionLabel =
    multiSelectedCount === 2
      ? "2 items selected"
      : `${multiSelectedCount} items selected`;
  // Human: Bulk copy/move applies when 2+ items are checked and the right-clicked row is in that set.
  // Agent: READS selected ids + target row; USED to append bulk items without replacing row menu.
  const bulkSelectionOnTargetFile =
    multiSelectedFileCount >= 2 &&
    targetFile !== undefined &&
    selectedFileIds?.has(targetFile.id) === true;
  const bulkSelectionOnTargetFolder =
    multiSelectedFolderCount >= 2 &&
    targetFolder !== undefined &&
    selectedFolderIds?.has(targetFolder.id) === true;
  const bulkSelectionOnWorkspace =
    multiSelectedCount >= 2 && !targetFile && !targetFolder;

  // Human: Shared copy/move block; workspace menu also exposes bulk delete here.
  // Agent: includeDelete=true only for empty-area right-click so file rows keep one Delete item.
  const bulkSelectionItems = (includeDelete: boolean) =>
    multiSelectedCount >= 2 ? (
      <>
        <ContextMenuSeparator />
        <ContextMenuLabel className="normal-case tracking-normal">
          {bulkSelectionLabel}
        </ContextMenuLabel>
        {multiSelectedFileCount > 0 ? (
          <ContextMenuItem disabled={!onCopyToFolder} onClick={() => onCopyToFolder?.()}>
            Copy to…
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          disabled={!onMoveToFolder && !onMoveFolderToFolder}
          onClick={() => {
            if (multiSelectedFolderCount > 0 && multiSelectedFileCount === 0) {
              onMoveFolderToFolder?.();
              return;
            }
            onMoveToFolder?.();
          }}
        >
          Move to…
        </ContextMenuItem>
        {includeDelete && multiSelectedFileCount > 0 ? (
          <ContextMenuItem
            variant="destructive"
            disabled={!onBulkDelete}
            onClick={() => onBulkDelete?.()}
          >
            Delete {multiSelectedFileCount} files
          </ContextMenuItem>
        ) : null}
      </>
    ) : null;

  // Human: Route delete to bulk confirmation when the pointer is on a checked file row.
  // Agent: CALLS onBulkDelete for multi-select; FALLS BACK to onDelete for a single target.
  function handleDeleteTargetFile() {
    if (bulkSelectionOnTargetFile) {
      onBulkDelete?.();
      return;
    }
    if (targetFile) onDelete(targetFile.id);
  }

  // Human: Resolve which file or folder (if any) was under the pointer when the menu opened.
  // Agent: WRITES target ids from eventDetails.event on open; CLEARS on close; BLOCKS open during drag.
  const handleOpenChange = useCallback(
    (nextOpen: boolean, eventDetails: ContextMenuPrimitive.Root.ChangeEventDetails) => {
      if (nextOpen && explorerDragActive) {
        return;
      }
      if (nextOpen) {
        const fileId = findFileIdFromEvent(eventDetails.event);
        const folderId = fileId ? null : findFolderIdFromEvent(eventDetails.event);
        setTargetFileId(fileId);
        setTargetFolderId(folderId);
      } else {
        setTargetFileId(null);
        setTargetFolderId(null);
      }
      setOpen(nextOpen);
    },
    [explorerDragActive],
  );

  return (
    <ContextMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[180px]">
        {targetFile ? (
          <ContextMenuGroup>
            {targetProcessing ? (
              <p className="px-3 py-2 text-[13px] leading-none text-[#888888]">
                Processing — actions unavailable
              </p>
            ) : null}

            {enableMobileSelectActions && onEnterMobileSelection ? (
              <ContextMenuItem
                disabled={targetProcessing}
                onClick={() => {
                  onEnterMobileSelection(targetFile.id);
                  setOpen(false);
                }}
              >
                <CheckSquare />
                Select
              </ContextMenuItem>
            ) : null}

            {/* Human: File menu order — Open (+open-with submenu), Edit, Download, Rename, Details. */}
            {/* Agent: Split Open row: primary click = default open; chevron submenu = alternate openers. */}
            <div className="flex w-full items-stretch gap-0.5">
              <ContextMenuItem
                className="min-w-0 flex-1"
                disabled={targetProcessing || !canDefaultOpenFile(targetFile, {
                  onPreviewVideo,
                  onPreviewImage,
                  onPreviewPdf,
                  onPreviewEpub,
                  onPreviewText,
                  onPreviewSpreadsheet,
                  onPreviewAudio,
                })}
                onClick={() => {
                  openFileDefault(targetFile, {
                    onPreviewVideo,
                    onPreviewImage,
                    onPreviewPdf,
                    onPreviewEpub,
                    onPreviewText,
                    onPreviewSpreadsheet,
                    onPreviewAudio,
                    onDetailsFile,
                  });
                  setOpen(false);
                }}
              >
                Open
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger
                  disabled={targetProcessing}
                  className="w-8 shrink-0 justify-center px-0 [&>svg]:ml-0"
                  aria-label="Open with"
                >
                  <span className="sr-only">Open with</span>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-[180px]">
                  <ContextMenuItem
                    disabled={
                      targetProcessing ||
                      !targetFile.mime_type?.startsWith("video/") ||
                      !targetFile.hls_ready ||
                      !onPreviewVideo
                    }
                    onClick={() => targetFile && onPreviewVideo?.(targetFile)}
                  >
                    Play in browser
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      targetProcessing ||
                      !targetFile.mime_type?.startsWith("image/") ||
                      !onPreviewImage
                    }
                    onClick={() => targetFile && onPreviewImage?.(targetFile)}
                  >
                    View in gallery
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      targetProcessing || !isPdfMime(targetFile.mime_type) || !onPreviewPdf
                    }
                    onClick={() => targetFile && onPreviewPdf?.(targetFile)}
                  >
                    View PDF
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      targetProcessing ||
                      !isEpubMime(targetFile.mime_type, targetFile.name) ||
                      !onPreviewEpub
                    }
                    onClick={() => targetFile && onPreviewEpub?.(targetFile)}
                  >
                    Read EPUB
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      targetProcessing ||
                      !isSpreadsheetPreviewMime(targetFile.mime_type, targetFile.name) ||
                      !onPreviewSpreadsheet
                    }
                    onClick={() => targetFile && onPreviewSpreadsheet?.(targetFile)}
                  >
                    Open spreadsheet
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      targetProcessing ||
                      !isTextCodePreviewMime(targetFile.mime_type, targetFile.name) ||
                      !onPreviewText
                    }
                    onClick={() => targetFile && onPreviewText?.(targetFile)}
                  >
                    Edit in code editor
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      targetProcessing || !isAudioMime(targetFile.mime_type) || !onPreviewAudio
                    }
                    onClick={() => targetFile && onPreviewAudio?.(targetFile)}
                  >
                    Play audio
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={targetProcessing}
                    onClick={() => onDownload(targetFile)}
                  >
                    Download to device
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </div>

            <ContextMenuItem
              disabled={
                targetProcessing ||
                !canEditFile(targetFile, {
                  onEditFile,
                  onPreviewText,
                  onPreviewSpreadsheet,
                })
              }
              onClick={() => {
                editFile(targetFile, {
                  onEditFile,
                  onPreviewText,
                  onPreviewSpreadsheet,
                });
                setOpen(false);
              }}
            >
              Edit
            </ContextMenuItem>

            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onDownload(targetFile)}
            >
              Download
            </ContextMenuItem>

            <ContextMenuItem
              disabled={targetProcessing || !onRenameFile}
              onClick={() => onRenameFile?.(targetFile)}
            >
              Rename
            </ContextMenuItem>

            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onDetailsFile(targetFile)}
            >
              Details
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onToggleFavourite(targetFile.id)}
            >
              {targetFavourited ? "Remove from favourites" : "Add to favourites"}
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={targetProcessing}>Share…</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  disabled={targetProcessing}
                  onClick={() => onShareFile(targetFile)}
                >
                  Copy link
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            {targetIsVideo && onReprocessHls ? (
              <ContextMenuItem
                disabled={
                  targetProcessing ||
                  (!targetFile.hls_ready &&
                    targetFile.hls_encode_status !== "failed" &&
                    targetFile.hls_encode_status !== "ready")
                }
                onClick={() => {
                  onReprocessHls(targetFile);
                  setOpen(false);
                }}
              >
                <RefreshCw />
                Rebuild stream
              </ContextMenuItem>
            ) : null}

            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={targetProcessing}
              onClick={handleDeleteTargetFile}
            >
              {bulkSelectionOnTargetFile
                ? `Delete ${multiSelectedCount} files`
                : "Delete file"}
            </ContextMenuItem>
            {bulkSelectionOnTargetFile ? bulkSelectionItems(false) : null}
          </ContextMenuGroup>
        ) : targetFolder ? (
          <ContextMenuGroup>
            <ContextMenuItem onClick={() => onDetailsFolder(targetFolder)}>Open</ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger>Share…</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => onShareFolder(targetFolder)}>
                  Copy link
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuItem onClick={() => onDownloadFolder(targetFolder)}>
              Download
            </ContextMenuItem>

            <ContextMenuItem
              disabled={!onRenameFolder}
              onClick={() => onRenameFolder?.(targetFolder)}
            >
              Rename
            </ContextMenuItem>

            <ContextMenuItem
              disabled={!onMoveFolderToFolder}
              onClick={() => onMoveFolderToFolder?.(targetFolder)}
            >
              Move to…
            </ContextMenuItem>

            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onDeleteFolder(targetFolder.id)}
            >
              Delete folder
            </ContextMenuItem>
            {bulkSelectionOnTargetFolder ? bulkSelectionItems(false) : null}
          </ContextMenuGroup>
        ) : (
          <ContextMenuGroup>
            <ContextMenuItem onClick={onCreateFolder}>
              <FolderPlus />
              New folder
            </ContextMenuItem>
            <ContextMenuItem variant="primary" onClick={onUpload}>
              <Upload />
              Upload files
            </ContextMenuItem>
            <ContextMenuItem onClick={onRefresh}>
              <RefreshCw />
              Refresh
            </ContextMenuItem>
            <ContextMenuItem disabled>
              <Clipboard />
              Paste
            </ContextMenuItem>

            {bulkSelectionOnWorkspace ? bulkSelectionItems(true) : null}

            <ContextMenuSub>
              <ContextMenuSubTrigger>Go to…</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  disabled={activeNav === "home"}
                  onClick={() => onNavChange("home")}
                >
                  Home
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={activeNav === "my-files"}
                  onClick={() => onNavChange("my-files")}
                >
                  My files
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
