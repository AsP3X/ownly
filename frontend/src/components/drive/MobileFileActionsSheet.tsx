// Human: Touch-friendly bottom action sheet for file/folder actions on mobile.
// Agent: Sheet side=bottom; CALLS parent handlers; CLOSES on action selection.

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

// Human: Full-width action row inside the grouped action card.
// Agent: RENDERS button; destructive variant for delete actions.
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
        "flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        destructive ? "text-red-600 active:bg-red-50" : "text-neutral-900 active:bg-neutral-50",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          destructive ? "bg-red-50 text-red-600" : "bg-neutral-100 text-neutral-700",
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

// Human: iOS-style action sheet with drag handle, grouped actions, and separate cancel pill.
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
        ? "File actions"
        : folder
          ? "Folder actions"
          : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-3 rounded-t-[1.25rem] border-0 bg-transparent p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-none"
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-neutral-300/80" aria-hidden />

        <SheetHeader className="rounded-2xl bg-white px-4 py-4 text-left shadow-sm ring-1 ring-neutral-200/70">
          <SheetTitle className="truncate text-base font-semibold">{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
          {file ? (
            <>
              <ActionRow
                icon={<Info className="size-4" />}
                label="Details"
                disabled={processing}
                onClick={() => closeThen(() => onDetailsFile(file))}
              />
              <div className="mx-4 border-t border-neutral-100" />
              <ActionRow
                icon={<Download className="size-4" />}
                label="Download"
                disabled={processing}
                onClick={() => closeThen(() => onDownload(file))}
              />
              <div className="mx-4 border-t border-neutral-100" />
              <ActionRow
                icon={
                  <Star className={cn("size-4", favourited && "fill-current text-amber-500")} />
                }
                label={favourited ? "Remove from favourites" : "Add to favourites"}
                disabled={processing}
                onClick={() => closeThen(() => onToggleFavourite(file.id))}
              />
              <div className="mx-4 border-t border-neutral-100" />
              <ActionRow
                icon={<Link2 className="size-4" />}
                label="Share link"
                disabled={processing}
                onClick={() => closeThen(() => onShareFile(file))}
              />
              {showBulkActions ? (
                <>
                  <div className="mx-4 border-t border-neutral-100" />
                  <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {bulkSelectionCount} files selected
                  </p>
                  <ActionRow
                    icon={<Copy className="size-4" />}
                    label="Copy to…"
                    disabled={!onCopyToFolder}
                    onClick={() => closeThen(() => onCopyToFolder?.())}
                  />
                  <div className="mx-4 border-t border-neutral-100" />
                  <ActionRow
                    icon={<FolderInput className="size-4" />}
                    label="Move to…"
                    disabled={!onMoveToFolder}
                    onClick={() => closeThen(() => onMoveToFolder?.())}
                  />
                </>
              ) : null}
              <div className="mx-4 border-t border-neutral-100" />
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
              <div className="mx-4 border-t border-neutral-100" />
              <ActionRow
                icon={<Download className="size-4" />}
                label="Download"
                onClick={() => closeThen(() => onDownloadFolder(folder))}
              />
              <div className="mx-4 border-t border-neutral-100" />
              <ActionRow
                icon={<Link2 className="size-4" />}
                label="Share link"
                onClick={() => closeThen(() => onShareFolder(folder))}
              />
              <div className="mx-4 border-t border-neutral-100" />
              <ActionRow
                icon={<Trash2 className="size-4" />}
                label="Delete"
                destructive
                onClick={() => closeThen(() => onDeleteFolder(folder.id))}
              />
            </>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-12 w-full rounded-2xl border-0 bg-white text-[15px] font-semibold shadow-sm ring-1 ring-neutral-200/70"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
      </SheetContent>
    </Sheet>
  );
}
