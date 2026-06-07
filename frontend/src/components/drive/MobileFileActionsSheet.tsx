// Human: Touch-friendly bottom action sheet for file/folder actions on mobile.
// Agent: Sheet side=bottom; CALLS parent handlers; CLOSES on action selection.

import { useEffect, useState } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  Link2,
  Star,
  Trash2,
} from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { isFileProcessing } from "@/lib/file-processing";
import {
  isAudioMime,
  isPdfMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
} from "@/lib/utils-app";
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
  /** Human: Delete every checked file when the sheet targets one of them. */
  onBulkDelete?: () => void;
  onShareFile: (file: FileItem) => void;
  onShareFolder: (folder: FolderItem) => void;
  onDetailsFile: (file: FileItem) => void;
  onDetailsFolder: (folder: FolderItem) => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  onCopyToFolder?: () => void;
  onMoveToFolder?: () => void;
  selectedFileIds?: Set<string>;
  bulkSelectionCount?: number;
  /** Human: Enter tap-to-select mode and check the target file. */
  onEnterMobileSelection?: (fileId: string) => void;
};

// Human: Full-width action row inside the grouped action card.
// Agent: RENDERS button; destructive variant for delete actions.
function ActionRow({
  icon,
  label,
  onClick,
  disabled,
  destructive,
  indented,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  indented?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 py-3.5 text-left text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        indented ? "pl-8 pr-4" : "px-4",
        destructive ? "text-red-600 active:bg-red-50" : "text-neutral-900 active:bg-neutral-50",
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            destructive ? "bg-red-50 text-red-600" : "bg-neutral-100 text-neutral-700",
          )}
        >
          {icon}
        </span>
      ) : (
        <span className="size-9 shrink-0" aria-hidden />
      )}
      {label}
    </button>
  );
}

function ActionDivider() {
  return <div className="mx-4 border-t border-neutral-100" />;
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
  onBulkDelete,
  onShareFile,
  onShareFolder,
  onDetailsFile,
  onDetailsFolder,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onCopyToFolder,
  onMoveToFolder,
  selectedFileIds,
  bulkSelectionCount = 0,
  onEnterMobileSelection,
}: MobileFileActionsSheetProps) {
  const [openWithExpanded, setOpenWithExpanded] = useState(false);
  const file = target?.kind === "file" ? target.file : undefined;
  const folder = target?.kind === "folder" ? target.folder : undefined;
  const favourited = file ? favouriteIds.has(file.id) : false;
  const processing = file ? isFileProcessing(file) : false;
  const isVideo = file?.mime_type?.startsWith("video/") ?? false;
  const bulkSelectionOnTargetFile =
    bulkSelectionCount >= 2 && file !== undefined && selectedFileIds?.has(file.id) === true;
  const showBulkActions = bulkSelectionOnTargetFile;

  // Human: Collapse Open with when the sheet closes so the next open starts at the top-level list.
  // Agent: RESETS openWithExpanded on open=false.
  useEffect(() => {
    if (!open) {
      setOpenWithExpanded(false);
    }
  }, [open]);

  function closeThen(run: () => void) {
    onOpenChange(false);
    run();
  }

  // Human: Primary Open — preview playable media; everything else opens details.
  // Agent: CALLS onPreviewVideo when video+hls_ready; FALLS BACK to onDetailsFile.
  function handleOpen(fileItem: FileItem) {
    if (isVideo && fileItem.hls_ready && onPreviewVideo) {
      onPreviewVideo(fileItem);
      return;
    }
    onDetailsFile(fileItem);
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
              {onEnterMobileSelection ? (
                <ActionRow
                  icon={<CheckSquare className="size-4" />}
                  label="Select"
                  disabled={processing}
                  onClick={() => closeThen(() => onEnterMobileSelection(file.id))}
                />
              ) : null}

              {onEnterMobileSelection ? <ActionDivider /> : null}

              <ActionRow
                icon={<ExternalLink className="size-4" />}
                label="Open"
                disabled={
                  processing ||
                  (isVideo && (!file.hls_ready || onPreviewVideo === undefined))
                }
                onClick={() => closeThen(() => handleOpen(file))}
              />
              <ActionDivider />

              <button
                type="button"
                disabled={processing}
                onClick={() => setOpenWithExpanded((expanded) => !expanded)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium text-neutral-900 transition-colors active:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
                  <ExternalLink className="size-4" />
                </span>
                Open with
                <span className="ml-auto text-neutral-400">
                  {openWithExpanded ? (
                    <ChevronUp className="size-4" aria-hidden />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden />
                  )}
                </span>
              </button>
              {openWithExpanded ? (
                <div className="border-t border-neutral-100 bg-neutral-50/60">
                  <ActionRow
                    icon={null}
                    label="Download to device"
                    indented
                    disabled={processing}
                    onClick={() => closeThen(() => onDownload(file))}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={null}
                    label="Play in browser"
                    indented
                    disabled={
                      processing || !isVideo || onPreviewVideo === undefined
                    }
                    onClick={() => closeThen(() => onPreviewVideo?.(file))}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={null}
                    label="View in gallery"
                    indented
                    disabled={
                      processing ||
                      !file.mime_type?.startsWith("image/") ||
                      onPreviewImage === undefined
                    }
                    onClick={() => closeThen(() => onPreviewImage?.(file))}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={null}
                    label="View PDF"
                    indented
                    disabled={
                      processing || !isPdfMime(file.mime_type) || onPreviewPdf === undefined
                    }
                    onClick={() => closeThen(() => onPreviewPdf?.(file))}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={null}
                    label="Open spreadsheet"
                    indented
                    disabled={
                      processing ||
                      !isSpreadsheetPreviewMime(file.mime_type, file.name) ||
                      onPreviewSpreadsheet === undefined
                    }
                    onClick={() => closeThen(() => onPreviewSpreadsheet?.(file))}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={null}
                    label="Edit in code editor"
                    indented
                    disabled={
                      processing ||
                      !isTextCodePreviewMime(file.mime_type, file.name) ||
                      onPreviewText === undefined
                    }
                    onClick={() => closeThen(() => onPreviewText?.(file))}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={null}
                    label="Play audio"
                    indented
                    disabled={
                      processing || !isAudioMime(file.mime_type) || onPreviewAudio === undefined
                    }
                    onClick={() => closeThen(() => onPreviewAudio?.(file))}
                  />
                </div>
              ) : null}
              <ActionDivider />

              <ActionRow
                icon={<Download className="size-4" />}
                label="Download"
                disabled={processing}
                onClick={() => closeThen(() => onDownload(file))}
              />
              <ActionDivider />

              <ActionRow
                icon={
                  <Star className={cn("size-4", favourited && "fill-current text-amber-500")} />
                }
                label={favourited ? "Remove from favourites" : "Add to favourites"}
                disabled={processing}
                onClick={() => closeThen(() => onToggleFavourite(file.id))}
              />
              <ActionDivider />

              <ActionRow
                icon={<Link2 className="size-4" />}
                label="Share link"
                disabled={processing}
                onClick={() => closeThen(() => onShareFile(file))}
              />

              {showBulkActions ? (
                <>
                  <ActionDivider />
                  <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {bulkSelectionCount} files selected
                  </p>
                  <ActionRow
                    icon={<Copy className="size-4" />}
                    label="Copy to…"
                    disabled={!onCopyToFolder}
                    onClick={() => closeThen(() => onCopyToFolder?.())}
                  />
                  <ActionDivider />
                  <ActionRow
                    icon={<FolderInput className="size-4" />}
                    label="Move to…"
                    disabled={!onMoveToFolder}
                    onClick={() => closeThen(() => onMoveToFolder?.())}
                  />
                </>
              ) : null}

              <ActionDivider />
              <ActionRow
                icon={<Trash2 className="size-4" />}
                label={
                  bulkSelectionOnTargetFile
                    ? `Delete ${bulkSelectionCount} files`
                    : "Delete"
                }
                disabled={processing}
                destructive
                onClick={() =>
                  closeThen(() =>
                    bulkSelectionOnTargetFile ? onBulkDelete?.() : onDelete(file.id),
                  )
                }
              />
            </>
          ) : folder ? (
            <>
              <ActionRow
                icon={<ExternalLink className="size-4" />}
                label="Open"
                onClick={() => closeThen(() => onDetailsFolder(folder))}
              />
              <ActionDivider />
              <ActionRow
                icon={<Download className="size-4" />}
                label="Download"
                onClick={() => closeThen(() => onDownloadFolder(folder))}
              />
              <ActionDivider />
              <ActionRow
                icon={<Link2 className="size-4" />}
                label="Share link"
                onClick={() => closeThen(() => onShareFolder(folder))}
              />
              <ActionDivider />
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
