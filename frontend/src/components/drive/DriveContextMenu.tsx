// Human: Right-click menu for the drive shell — file actions and workspace shortcuts with nested submenus.
// Agent: modal={false} keeps page visible; SubmenuTrigger inherits Base UI safePolygon prediction cone.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  FolderPlus,
  FolderOpen,
  Link2,
  RefreshCw,
  Share2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { FileItem } from "@/api/client";
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

type NavItemId = "home" | "my-files";

type DriveContextMenuProps = {
  children: ReactNode;
  files: FileItem[];
  favouriteIds: Set<string>;
  activeNav: NavItemId;
  onDownload: (file: FileItem) => void;
  onDelete: (fileId: string) => void;
  onToggleFavourite: (fileId: string) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  onNavChange: (nav: NavItemId) => void;
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

export function DriveContextMenu({
  children,
  files,
  favouriteIds,
  activeNav,
  onDownload,
  onDelete,
  onToggleFavourite,
  onUpload,
  onCreateFolder,
  onRefresh,
  onNavChange,
}: DriveContextMenuProps) {
  const [targetFileId, setTargetFileId] = useState<string | null>(null);

  const fileById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const targetFile = targetFileId ? fileById.get(targetFileId) : undefined;
  const targetFavourited = targetFile ? favouriteIds.has(targetFile.id) : false;

  // Human: Resolve which file (if any) was under the pointer when the menu opened.
  // Agent: WRITES targetFileId from eventDetails.event on open; CLEARS on close.
  const handleOpenChange = useCallback(
    (open: boolean, eventDetails: ContextMenuPrimitive.Root.ChangeEventDetails) => {
      if (open) {
        setTargetFileId(findFileIdFromEvent(eventDetails.event));
        return;
      }
      setTargetFileId(null);
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
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onDownload(targetFile)}>
              <Download />
              Download
              <ContextMenuShortcut>⌘D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onToggleFavourite(targetFile.id)}>
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
                <ContextMenuItem disabled>
                  <Link2 />
                  Copy link
                </ContextMenuItem>
                <ContextMenuItem disabled>
                  <ExternalLink />
                  Open in new tab
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled>
                  <Copy />
                  Copy file name
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderOpen />
                Open with
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => onDownload(targetFile)}>
                  <Download />
                  Download to device
                </ContextMenuItem>
                <ContextMenuItem disabled>
                  <ExternalLink />
                  Browser preview
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => onDelete(targetFile.id)}>
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
