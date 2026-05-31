// Human: Right-click menu for the drive shell — Ownly Pencil explorer context menus (text-first file rows).
// Agent: modal={false}; SubmenuTrigger inherits Base UI safePolygon; workspace rows use small leading Lucide icons only.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Clipboard, FolderPlus, RefreshCw, Upload } from "lucide-react";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import { isAudioMime, isPdfMime } from "@/lib/utils-app";
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
  onDownload: (file: FileItem) => void;
  onDownloadFolder: (folder: FolderItem) => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
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
  onCopyToFolder?: () => void;
  onMoveToFolder?: () => void;
};

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
  onDownload,
  onDownloadFolder,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
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
  onCopyToFolder,
  onMoveToFolder,
}: DriveContextMenuProps) {
  const [targetFileId, setTargetFileId] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const targetFile = targetFileId ? fileById.get(targetFileId) : undefined;
  const targetFolder = targetFolderId ? folderById.get(targetFolderId) : undefined;
  const targetFavourited = targetFile ? favouriteIds.has(targetFile.id) : false;
  const targetProcessing = targetFile ? isFileProcessing(targetFile) : false;
  const multiSelectedCount = selectedFileIds?.size ?? 0;
  const bulkSelectionLabel =
    multiSelectedCount === 2 ? "2 files selected" : `${multiSelectedCount} files selected`;
  // Human: Bulk copy/move applies when 2+ files are checked and the right-clicked row is in that set.
  // Agent: READS selectedFileIds + targetFile; USED to append bulk items without replacing file menu.
  const bulkSelectionOnTargetFile =
    multiSelectedCount >= 2 &&
    targetFile !== undefined &&
    selectedFileIds?.has(targetFile.id) === true;
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
        <ContextMenuItem disabled={!onCopyToFolder} onClick={() => onCopyToFolder?.()}>
          Copy to…
        </ContextMenuItem>
        <ContextMenuItem disabled={!onMoveToFolder} onClick={() => onMoveToFolder?.()}>
          Move to…
        </ContextMenuItem>
        {includeDelete ? (
          <ContextMenuItem
            variant="destructive"
            disabled={!onBulkDelete}
            onClick={() => onBulkDelete?.()}
          >
            Delete {multiSelectedCount} files
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
  // Agent: WRITES target ids from eventDetails.event on open; CLEARS on close.
  const handleOpenChange = useCallback(
    (open: boolean, eventDetails: ContextMenuPrimitive.Root.ChangeEventDetails) => {
      if (open) {
        const fileId = findFileIdFromEvent(eventDetails.event);
        const folderId = fileId ? null : findFolderIdFromEvent(eventDetails.event);
        setTargetFileId(fileId);
        setTargetFolderId(folderId);
        return;
      }
      setTargetFileId(null);
      setTargetFolderId(null);
    },
    [],
  );

  return (
    <ContextMenu modal={false} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[180px]">
        {targetFile ? (
          <ContextMenuGroup>
            {targetProcessing ? (
              <p className="px-3 py-2 text-[13px] leading-none text-[#888888]">
                Processing — actions unavailable
              </p>
            ) : null}

            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onDetailsFile(targetFile)}
            >
              Open
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

            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onDownload(targetFile)}
            >
              Download
            </ContextMenuItem>

            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onToggleFavourite(targetFile.id)}
            >
              {targetFavourited ? "Remove from favourites" : "Add to favourites"}
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={targetProcessing}>Open with…</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  disabled={targetProcessing}
                  onClick={() => onDownload(targetFile)}
                >
                  Download to device
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={
                    targetProcessing ||
                    !targetFile.mime_type?.startsWith("video/") ||
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
                    targetProcessing || !isAudioMime(targetFile.mime_type) || !onPreviewAudio
                  }
                  onClick={() => targetFile && onPreviewAudio?.(targetFile)}
                >
                  Play audio
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

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

            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onDeleteFolder(targetFolder.id)}
            >
              Delete folder
            </ContextMenuItem>
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
