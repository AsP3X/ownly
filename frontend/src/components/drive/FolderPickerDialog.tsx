// Human: Modal folder browser for choosing a copy or move destination in the drive tree.
// Agent: CONTROLLED folders + breadcrumb from parent; EMITS onCopy/onMove with target folder_id or null (root).

import { ChevronRight, Copy, Folder, FolderInput, Loader2 } from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type FolderPickerCrumb = {
  id: string;
  name: string;
};

type FolderPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileItem[];
  /** Human: Folders queued for move — copy is hidden when this list is non-empty and files is empty. */
  foldersToMove?: FolderItem[];
  /** Human: Folder ids that cannot be chosen as destinations (prevents moving a folder into itself). */
  excludeFolderIds?: Set<string>;
  folderStack: FolderPickerCrumb[];
  folders: FolderItem[];
  loading: boolean;
  error?: string;
  submitting: "copy" | "move" | null;
  onNavigate: (stack: FolderPickerCrumb[]) => void;
  onCopy: () => void | Promise<void>;
  onMove: () => void | Promise<void>;
};

function folderIdsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

// Human: Mini file explorer — breadcrumb + folder rows; user picks Copy, Move, or Cancel.
// Agent: READS controlled folder listing; CALLS onNavigate when user changes breadcrumb path.
export function FolderPickerDialog({
  open,
  onOpenChange,
  files,
  foldersToMove = [],
  excludeFolderIds,
  folderStack,
  folders,
  loading,
  error = "",
  submitting,
  onNavigate,
  onCopy,
  onMove,
}: FolderPickerDialogProps) {
  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const fileCount = files.length;
  const folderCount = foldersToMove.length;
  const totalCount = fileCount + folderCount;
  const visibleFolders = excludeFolderIds
    ? folders.filter((folder) => !excludeFolderIds.has(folder.id))
    : folders;
  const filesAlreadyHere =
    fileCount > 0 &&
    files.every((file) => folderIdsMatch(file.folder_id, currentFolderId));
  const foldersAlreadyHere =
    folderCount > 0 &&
    foldersToMove.every((folder) => folderIdsMatch(folder.parent_id, currentFolderId));
  const moveDisabled =
    totalCount > 0 &&
    (fileCount === 0 || filesAlreadyHere) &&
    (folderCount === 0 || foldersAlreadyHere);
  const moveDisabledReason = moveDisabled
    ? folderCount > 0 && fileCount === 0
      ? "Every selected folder is already in this location."
      : fileCount > 0 && folderCount === 0
        ? "Every selected file is already in this folder."
        : "Everything selected is already in this folder."
    : undefined;
  const showCopyAction = fileCount > 0;

  function goToFolderIndex(index: number) {
    onNavigate(index < 0 ? [] : folderStack.slice(0, index + 1));
  }

  function openFolder(folder: FolderItem) {
    if (excludeFolderIds?.has(folder.id)) return;
    if (folderStack.at(-1)?.id === folder.id) return;
    onNavigate([...folderStack, { id: folder.id, name: folder.name }]);
  }

  const title =
    totalCount === 1
      ? "Choose destination folder"
      : `Choose destination for ${totalCount} items`;
  const destinationLabel =
    folderStack.length > 0 ? folderStack[folderStack.length - 1]?.name ?? "My files" : "My files";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-neutral-100 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg text-neutral-900">
            <FolderInput className="size-5 text-blue-600" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription className="text-neutral-500">
            Browse to a folder, then {showCopyAction ? "copy or " : ""}move your selection into{" "}
            <span className="font-medium text-neutral-700">{destinationLabel}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 py-4">
          {/* Agent: Breadcrumb mirrors DrivePage folderStack — root is null parent_id. */}
          <nav
            className="flex flex-wrap items-center gap-1 text-sm text-neutral-600"
            aria-label="Destination folder path"
          >
            <button
              type="button"
              onClick={() => goToFolderIndex(-1)}
              className={cn(
                "rounded px-1 hover:bg-neutral-100",
                folderStack.length === 0
                  ? "font-medium text-neutral-900"
                  : "font-medium text-blue-700 hover:bg-blue-50",
              )}
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

          <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200">
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading folders…
              </p>
            ) : visibleFolders.length === 0 ? (
              <p className="py-10 text-center text-sm text-neutral-500">
                {folderStack.length === 0
                  ? "No subfolders yet — items will go to the drive root."
                  : "This folder has no subfolders."}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {visibleFolders.map((folder) => (
                  <li key={folder.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-neutral-50"
                      onClick={() => openFolder(folder)}
                      onDoubleClick={() => openFolder(folder)}
                    >
                      <Folder className="size-4 shrink-0 text-amber-500" aria-hidden />
                      <span className="truncate font-medium text-neutral-900">{folder.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {moveDisabled && moveDisabledReason ? (
            <p className="text-xs text-neutral-500">{moveDisabledReason}</p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {showCopyAction ? (
            <Button
              type="button"
              variant="outline"
              className="border-blue-200 text-blue-800 hover:bg-blue-50"
              disabled={submitting !== null}
              onClick={() => void onCopy()}
            >
              {submitting === "copy" ? (
                <>
                  <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden />
                  Copying…
                </>
              ) : (
                <>
                  <Copy data-icon="inline-start" aria-hidden />
                  Copy here
                </>
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={submitting !== null || moveDisabled}
            onClick={() => void onMove()}
          >
            {submitting === "move" ? (
              <>
                <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden />
                Moving…
              </>
            ) : (
              <>
                <FolderInput data-icon="inline-start" aria-hidden />
                Move here
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
