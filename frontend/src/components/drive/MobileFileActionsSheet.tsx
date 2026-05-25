// Human: Touch-friendly bottom sheet listing file/folder actions — replaces right-click menu on mobile.
// Agent: Sheet side=bottom; CALLS parent handlers for download/share/delete/details; CLOSES on action.

import {
  Copy,
  Download,
  FolderInput,
  Info,
  Link2,
  Star,
  Trash2,
} from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type MobileActionTarget =
  | { kind: "file"; file: FileItem }
  | { kind: "folder"; folder: FolderItem };

type MobileFileActionsSheetProps = {
  target: MobileActionTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  favouriteIds: Set<string>;
  onDownload: (file: FileItem) => void;
  onDownloadFolder: (folder: FolderItem) => void;
  onToggleFavourite: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onShareFile: (file: FileItem) => void;
  onShareFolder: (folder: FolderItem) => void;
  onDetailsFile: (file: FileItem) => void;
  onDetailsFolder: (folder: FolderItem) => void;
  onCopyToFolder?: () => void;
  onMoveToFolder?: () => void;
  bulkSelectionCount?: number;
};

// Human: Full-width tappable row inside the mobile action sheet.
// Agent: RENDERS button; variant destructive for delete actions.
function ActionRow({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        destructive
          ? "text-red-700 hover:bg-red-50"
          : "text-neutral-800 hover:bg-neutral-50",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100">
        {icon}
      </span>
      {label}
    </button>
  );
}

// Human: Native-style action sheet for a single file or folder row on mobile.
// Agent: READS target kind; WRITES onOpenChange(false) after each handler fires.
export function MobileFileActionsSheet({
  target,
  open,
  onOpenChange,
  favouriteIds,
  onDownload,
  onDownloadFolder,
  onToggleFavourite,
  onDelete,
  onDeleteFolder,
  onShareFile,
  onShareFolder,
  onDetailsFile,
  onDetailsFolder,
  onCopyToFolder,
  onMoveToFolder,
  bulkSelectionCount = 0,
}: MobileFileActionsSheetProps) {
  const file = target?.kind === "file" ? target.file : undefined;
  const folder = target?.kind === "folder" ? target.folder : undefined;
  const favourited = file ? favouriteIds.has(file.id) : false;
  const processing = file ? isFileProcessing(file) : false;
  const showBulkActions = bulkSelectionCount >= 2 && file !== undefined;

  function closeThen(run: () => void) {
    onOpenChange(false);
    run();
  }

  const title = file?.name ?? folder?.name ?? "Actions";
  const subtitle =
    file && processing
      ? "Processing — most actions are unavailable"
      : file
        ? "Choose an action for this file"
        : folder
          ? "Choose an action for this folder"
          : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b border-neutral-100 px-4 py-4 text-left">
          <SheetTitle className="truncate pr-8 text-base">{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>

        <div className="overflow-y-auto px-2 py-2">
          {file ? (
            <>
              <ActionRow
                icon={<Info className="size-4" />}
                label="Details"
                disabled={processing}
                onClick={() => closeThen(() => onDetailsFile(file))}
              />
              <ActionRow
                icon={<Download className="size-4" />}
                label="Download"
                disabled={processing}
                onClick={() => closeThen(() => onDownload(file))}
              />
              <ActionRow
                icon={
                  <Star className={cn("size-4", favourited && "fill-current text-amber-500")} />
                }
                label={favourited ? "Remove from favourites" : "Add to favourites"}
                disabled={processing}
                onClick={() => closeThen(() => onToggleFavourite(file.id))}
              />
              <ActionRow
                icon={<Link2 className="size-4" />}
                label="Share link"
                disabled={processing}
                onClick={() => closeThen(() => onShareFile(file))}
              />
              {showBulkActions ? (
                <>
                  <Separator className="my-2" />
                  <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {bulkSelectionCount} files selected
                  </p>
                  <ActionRow
                    icon={<Copy className="size-4" />}
                    label="Copy to…"
                    disabled={!onCopyToFolder}
                    onClick={() => closeThen(() => onCopyToFolder?.())}
                  />
                  <ActionRow
                    icon={<FolderInput className="size-4" />}
                    label="Move to…"
                    disabled={!onMoveToFolder}
                    onClick={() => closeThen(() => onMoveToFolder?.())}
                  />
                </>
              ) : null}
              <Separator className="my-2" />
              <ActionRow
                icon={<Trash2 className="size-4" />}
                label="Delete"
                disabled={processing}
                destructive
                onClick={() => closeThen(() => onDelete(file.id))}
              />
            </>
          ) : folder ? (
            <>
              <ActionRow
                icon={<Info className="size-4" />}
                label="Details"
                onClick={() => closeThen(() => onDetailsFolder(folder))}
              />
              <ActionRow
                icon={<Download className="size-4" />}
                label="Download"
                onClick={() => closeThen(() => onDownloadFolder(folder))}
              />
              <ActionRow
                icon={<Link2 className="size-4" />}
                label="Share link"
                onClick={() => closeThen(() => onShareFolder(folder))}
              />
              <Separator className="my-2" />
              <ActionRow
                icon={<Trash2 className="size-4" />}
                label="Delete"
                destructive
                onClick={() => closeThen(() => onDeleteFolder(folder.id))}
              />
            </>
          ) : null}
        </div>

        <div className="border-t border-neutral-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
