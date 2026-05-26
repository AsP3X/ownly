// Human: Right-click menu for the drive shell — file actions and workspace shortcuts with nested submenus.
// Agent: modal={false} keeps page visible; SubmenuTrigger inherits Base UI safePolygon prediction cone.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  FolderPlus,
  FolderOpen,
  Info,
  Link2,
  RefreshCw,
  Share2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import { isPdfMime } from "@/lib/utils-app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type NavItemId = "home" | "my-files" | "recycle-bin";

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
  onDelete: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
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
  onDelete,
  onDeleteFolder,
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

  const bulkSelectionItems =
    multiSelectedCount >= 2 ? (
      <>
        <ContextMenuSeparator />
        <ContextMenuLabel className="truncate">{bulkSelectionLabel}</ContextMenuLabel>
        <ContextMenuItem disabled={!onCopyToFolder} onClick={() => onCopyToFolder?.()}>
          <Copy />
          Copy to…
        </ContextMenuItem>
        <ContextMenuItem disabled={!onMoveToFolder} onClick={() => onMoveToFolder?.()}>
          <FolderInput />
          Move to…
        </ContextMenuItem>
      </>
    ) : null;

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
      <ContextMenuContent className="w-56">
        {targetFile ? (
          <ContextMenuGroup>
            <ContextMenuLabel className="truncate">{targetFile.name}</ContextMenuLabel>
            {targetProcessing ? (
              <p className="px-2 py-1.5 text-xs text-violet-800">Processing — actions unavailable</p>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={targetProcessing} onClick={() => onDetailsFile(targetFile)}>
              <Info />
              Details
            </ContextMenuItem>
            <ContextMenuItem disabled={targetProcessing} onClick={() => onDownload(targetFile)}>
              <Download />
              Download
              <ContextMenuShortcut>⌘D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={targetProcessing}
              onClick={() => onToggleFavourite(targetFile.id)}
            >
              <Star className={targetFavourited ? "fill-current text-amber-500" : undefined} />
              {targetFavourited ? "Remove from favourites" : "Add to favourites"}
            </ContextMenuItem>

            {/* Agent: SubmenuTrigger uses Base UI safePolygon so diagonal moves keep this branch open. */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Share2 />
                Share
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  disabled={targetProcessing}
                  onClick={() => onShareFile(targetFile)}
                >
                  <Link2 />
                  Copy public link
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderOpen />
                Open with
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem disabled={targetProcessing} onClick={() => onDownload(targetFile)}>
                  <Download />
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
                  <ExternalLink />
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
                  <ExternalLink />
                  View in gallery
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={
                    targetProcessing ||
                    !isPdfMime(targetFile.mime_type) ||
                    !onPreviewPdf
                  }
                  onClick={() => targetFile && onPreviewPdf?.(targetFile)}
                >
                  <ExternalLink />
                  View PDF
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={targetProcessing}
              onClick={() => onDelete(targetFile.id)}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
            {bulkSelectionOnTargetFile ? bulkSelectionItems : null}
          </ContextMenuGroup>
        ) : targetFolder ? (
          <ContextMenuGroup>
            <ContextMenuLabel className="truncate">{targetFolder.name}</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onDetailsFolder(targetFolder)}>
              <Info />
              Details
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onDownloadFolder(targetFolder)}>
              <Download />
              Download
              <ContextMenuShortcut>⌘D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onShareFolder(targetFolder)}>
              <Link2 />
              Copy public link
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => onDeleteFolder(targetFolder.id)}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuGroup>
        ) : (
          <ContextMenuGroup>
            <ContextMenuLabel>MediaVault</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onUpload}>
              <Upload />
              Upload files
            </ContextMenuItem>
            <ContextMenuItem onClick={onCreateFolder}>
              <FolderPlus />
              New folder
            </ContextMenuItem>
            <ContextMenuItem onClick={onRefresh}>
              <RefreshCw />
              Refresh
            </ContextMenuItem>

            {bulkSelectionOnWorkspace ? bulkSelectionItems : null}

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderOpen />
                Go to
              </ContextMenuSubTrigger>
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
