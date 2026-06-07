// Human: Memoized folder and file tiles for the My Cloud explorer grid.
// Agent: EXTRACTED from DriveCloudExplorer; RENDERS previews, selection, drag-drop; MEMO avoids full-grid re-renders.

import { memo, useRef, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
import {
  Check,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  ImageIcon,
  MoreVertical,
  Music,
  Presentation,
} from "lucide-react";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import { ExplorerImageThumbnail } from "@/components/drive/ExplorerImageThumbnail";
import { LazyExplorerSpreadsheetThumbnail } from "@/components/drive/lazy-explorer-spreadsheet-thumbnail";
import { ExplorerVideoThumbnail } from "@/components/drive/ExplorerVideoThumbnail";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import { explorerFileRowRenderEqual } from "@/lib/explorer-file-list-updates";
import { isFileProcessing } from "@/lib/file-processing";
import {
  formatBytes,
  formatFileOpened,
  isAudioMime,
  isImageMime,
  isPdfMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
} from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import type { ExplorerTouchDragBindings } from "@/components/drive/useExplorerTouchDrag";
import { cn } from "@/lib/utils";

// Human: Browser skips layout/paint for off-screen tiles without JS scroll handlers.
// Agent: APPLIED to folder/file shells; contain-intrinsic-size reserves scroll height.
export const EXPLORER_GRID_TILE_PERF =
  "[content-visibility:auto] [contain-intrinsic-size:auto_176px]";

export type ExplorerGridEntry =
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem };

// Human: Large centered icon for explorer file tiles (32px per wireframe).
// Agent: READS mime_type; RETURNS lucide icon in brand blue.
function ExplorerFileIcon({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  const className = "size-8 text-[#2563EB]";
  if (mime.startsWith("image/")) return <ImageIcon className={className} aria-hidden />;
  if (mime.startsWith("video/")) return <Film className={className} aria-hidden />;
  if (mime.startsWith("audio/")) return <Music className={className} aria-hidden />;
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) {
    return <FileSpreadsheet className={className} aria-hidden />;
  }
  if (mime.includes("presentation") || mime.includes("powerpoint")) {
    return <Presentation className={className} aria-hidden />;
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("document")
  ) {
    return <FileText className={className} aria-hidden />;
  }
  return <FileIcon className={className} aria-hidden />;
}

export type ExplorerFolderGridTileProps = {
  folder: FolderItem;
  shareFlags?: ShareFlags;
  isDropTarget: boolean;
  dragEnabled: boolean;
  onOpenFolder: (folder: FolderItem) => void;
  onDragEnter: (event: DragEvent<HTMLButtonElement>, folderId: string) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: (folderId: string) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>, folderId: string) => void;
};

// Human: Folder tile — navigation target and optional drag-drop move target.
// Agent: MEMOIZED; CALLS parent drag handlers; RENDERS SharedIndicator from folderShareFlags.
export const ExplorerFolderGridTile = memo(function ExplorerFolderGridTile({
  folder,
  shareFlags,
  isDropTarget,
  dragEnabled,
  onOpenFolder,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: ExplorerFolderGridTileProps) {
  return (
    <button
      type="button"
      data-folder-id={folder.id}
      onClick={() => onOpenFolder(folder)}
      onDragEnter={(event) => onDragEnter(event, folder.id)}
      onDragOver={onDragOver}
      onDragLeave={() => onDragLeave(folder.id)}
      onDrop={(event) => onDrop(event, folder.id)}
      className={cn(
        EXPLORER_GRID_TILE_PERF,
        "flex min-h-[108px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-3.5 text-center transition-[border-color,box-shadow,background-color] hover:border-blue-200 hover:shadow-sm",
        isDropTarget && "border-blue-400 bg-blue-50/90 shadow-md shadow-blue-500/10",
        !dragEnabled && "cursor-pointer",
      )}
    >
      <Folder className="size-8 text-[#2563EB]" aria-hidden />
      <span className="line-clamp-2 w-full text-[13px] font-semibold leading-tight text-[#1A1A1A]">
        {folder.name}
      </span>
      <span className="text-[11px] text-[#888888]">Folder</span>
      <SharedIndicator flags={shareFlags} className="size-3" />
    </button>
  );
});

export type ExplorerFileGridTileProps = {
  file: FileItem;
  shareFlags?: ShareFlags;
  selectionEnabled: boolean;
  isSelected: boolean;
  hasActiveSelection: boolean;
  /** Human: Mobile tap-to-select mode — tile taps toggle checkboxes instead of opening previews. */
  mobileSelectionMode?: boolean;
  isDragging: boolean;
  isArmedForTouchDrag?: boolean;
  dragEnabled: boolean;
  touchDragEnabled?: boolean;
  getTouchDragBindings?: () => ExplorerTouchDragBindings;
  onToggleSelected: (fileId: string, checked: boolean) => void;
  /** Human: Mobile tap-select toggle backed by DrivePage's synchronous selection ref. */
  onTapToggleFileSelection?: (fileId: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onDragEnd: () => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  onOpenActions?: (target: MobileActionTarget) => void;
};

function shareFlagsEqual(a?: ShareFlags, b?: ShareFlags): boolean {
  return (
    (a?.public ?? false) === (b?.public ?? false) &&
    (a?.users ?? false) === (b?.users ?? false)
  );
}

// Human: Custom memo compare — only re-render a tile when its visible props change.
// Agent: COMPARES file row render fields + selection/drag flags; IGNORES stable handler refs.
function explorerFileGridTilePropsEqual(
  prev: ExplorerFileGridTileProps,
  next: ExplorerFileGridTileProps,
): boolean {
  return (
    explorerFileRowRenderEqual(prev.file, next.file) &&
    shareFlagsEqual(prev.shareFlags, next.shareFlags) &&
    prev.selectionEnabled === next.selectionEnabled &&
    prev.isSelected === next.isSelected &&
    prev.hasActiveSelection === next.hasActiveSelection &&
    prev.mobileSelectionMode === next.mobileSelectionMode &&
    prev.isDragging === next.isDragging &&
    prev.isArmedForTouchDrag === next.isArmedForTouchDrag &&
    prev.dragEnabled === next.dragEnabled &&
    prev.touchDragEnabled === next.touchDragEnabled
  );
}

// Human: File tile — preview, selection checkbox, drag source, and mobile actions.
// Agent: MEMOIZED; LAZY-LOADS thumbnails via child components; SKIPS preview when processing.
export const ExplorerFileGridTile = memo(function ExplorerFileGridTile({
  file,
  shareFlags,
  selectionEnabled,
  isSelected,
  hasActiveSelection,
  mobileSelectionMode = false,
  isDragging,
  isArmedForTouchDrag = false,
  dragEnabled,
  touchDragEnabled = false,
  getTouchDragBindings,
  onToggleSelected,
  onTapToggleFileSelection,
  onDragStart,
  onDragEnd,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onOpenActions,
}: ExplorerFileGridTileProps) {
  const isVideo = file.mime_type?.startsWith("video/") ?? false;
  const isImage = isImageMime(file.mime_type);
  const isPdf = isPdfMime(file.mime_type);
  const isSpreadsheet = isSpreadsheetPreviewMime(file.mime_type, file.name);
  const isAudio = isAudioMime(file.mime_type);
  const processing = isFileProcessing(file);
  const canPreviewVideo = isVideo && onPreviewVideo !== undefined && !processing;
  const canPreviewImage = isImage && onPreviewImage !== undefined && !processing;
  const canPreviewPdf = isPdf && onPreviewPdf !== undefined && !processing;
  const canPreviewSpreadsheet =
    isSpreadsheet && onPreviewSpreadsheet !== undefined && !processing;
  const canPreviewText =
    isTextCodePreviewMime(file.mime_type, file.name) &&
    onPreviewText !== undefined &&
    !processing;
  const canPreviewAudio = isAudio && onPreviewAudio !== undefined && !processing;
  const canPreview =
    canPreviewVideo ||
    canPreviewImage ||
    canPreviewPdf ||
    canPreviewSpreadsheet ||
    canPreviewText ||
    canPreviewAudio;
  const showImagePreview = isImage && !processing;
  const showVideoPreview = isVideo && file.video_thumbnail_ready;
  const showSpreadsheetPreview = isSpreadsheet && !processing;
  // Human: PDF grid tiles use the file icon — react-pdf canvases per row destroy scroll performance.
  // Agent: full PDF preview remains on tile click via onPreviewPdf; SKIPS live PDF thumbnail in grid.
  const showThumbnailPreview =
    showImagePreview || showVideoPreview || showSpreadsheetPreview;
  const touchDragBindings = touchDragEnabled ? getTouchDragBindings?.() : undefined;
  // Human: Track tap start so scroll gestures on a tile do not toggle selection.
  // Agent: READS pointer down/up delta; CALLS onTapToggleFileSelection only within MOBILE_TAP_SLOP_PX.
  const mobileTapStartRef = useRef<{ x: number; y: number } | null>(null);
  const MOBILE_TAP_SLOP_PX = 10;

  function handleTilePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (mobileSelectionMode && selectionEnabled && !processing) {
      mobileTapStartRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    touchDragBindings?.onPointerDown(event);
  }

  function handleTilePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (mobileSelectionMode && selectionEnabled && !processing) {
      const start = mobileTapStartRef.current;
      mobileTapStartRef.current = null;
      if (!start || !onTapToggleFileSelection) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance <= MOBILE_TAP_SLOP_PX) {
        onTapToggleFileSelection(file.id);
      }
      return;
    }
    touchDragBindings?.onPointerUp(event);
  }

  function handleTilePointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (mobileSelectionMode) {
      mobileTapStartRef.current = null;
      return;
    }
    touchDragBindings?.onPointerCancel(event);
  }

  return (
    <div
      data-file-id={file.id}
      className={cn(
        EXPLORER_GRID_TILE_PERF,
        "group relative overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow,background-color]",
        isSelected
          ? "border-blue-500 bg-blue-50/90 shadow-md shadow-blue-500/10"
          : "border-[#E5E7EB] hover:border-blue-200 hover:shadow-sm",
        canPreview && !isSelected && "hover:bg-[#F7F8FA]",
        canPreview && isSelected && "hover:bg-blue-100/50",
        processing && "opacity-80",
        isDragging && "opacity-50",
        isArmedForTouchDrag && !isDragging && "scale-[0.98] ring-2 ring-blue-400/60",
        touchDragEnabled && "touch-manipulation",
      )}
    >
      {selectionEnabled ? (
        <label
          className={cn(
            "absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md transition-opacity",
            isSelected || hasActiveSelection || mobileSelectionMode
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            // Human: Mobile tap-select uses one pointer handler on the tile — ignore checkbox hits.
            // Agent: APPLIES pointer-events-none while mobileSelectionMode to avoid double toggles.
            mobileSelectionMode && "pointer-events-none",
          )}
        >
          <input
            type="checkbox"
            checked={isSelected}
            disabled={processing}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onToggleSelected(file.id, event.target.checked)
            }
            className="peer sr-only"
            aria-label={`Select ${file.name}`}
            onClick={(event) => event.stopPropagation()}
          />
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-md border transition-colors",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-1",
              isSelected
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-[#D1D5DB] bg-white text-transparent shadow-sm",
            )}
            aria-hidden
          >
            <Check className="size-3.5 stroke-[2.5]" />
          </span>
        </label>
      ) : null}
      {onOpenActions ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "absolute left-1.5 top-1.5 z-10 size-7 text-[#888888] lg:hidden",
            isSelected && "bg-white/80",
          )}
          aria-label={`Actions for ${file.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenActions({ kind: "file", file });
          }}
        >
          <MoreVertical className="size-4" aria-hidden />
        </Button>
      ) : null}
      <button
        type="button"
        draggable={dragEnabled && !processing && !touchDragEnabled}
        onDragStart={(event) => onDragStart(event, file.id)}
        onDragEnd={onDragEnd}
        onPointerDown={handleTilePointerDown}
        onPointerMove={touchDragBindings?.onPointerMove}
        onPointerUp={handleTilePointerUp}
        onPointerCancel={handleTilePointerCancel}
        onClick={() => {
          if (mobileSelectionMode && selectionEnabled && !processing) {
            return;
          }
          if (touchDragBindings?.consumeSuppressedClick()) return;
          if (!canPreview) return;
          if (canPreviewVideo) onPreviewVideo!(file);
          else if (canPreviewImage) onPreviewImage!(file);
          else if (canPreviewPdf) onPreviewPdf!(file);
          else if (canPreviewSpreadsheet) onPreviewSpreadsheet!(file);
          else if (canPreviewText) onPreviewText!(file);
          else if (canPreviewAudio) onPreviewAudio!(file);
        }}
        className={cn(
          "flex h-full w-full flex-col gap-1.5 text-center",
          // Human: pan-y keeps list scroll working on first touch over a tile; drag arms only after long-press.
          // Agent: AVOIDS touch-none here — that blocks native vertical scroll across the whole grid on mobile.
          touchDragBindings && !mobileSelectionMode && "touch-pan-y",
          showThumbnailPreview
            ? "min-h-[148px] items-stretch p-2"
            : "min-h-[108px] items-center justify-center px-2.5 py-3.5",
        )}
      >
        {showImagePreview ? (
          <ExplorerImageThumbnail file={file} />
        ) : showVideoPreview ? (
          <ExplorerVideoThumbnail
            key={`${file.id}-${file.video_thumbnail_selected_index ?? 0}`}
            file={file}
          />
        ) : showSpreadsheetPreview ? (
          <LazyExplorerSpreadsheetThumbnail file={file} />
        ) : (
          <ExplorerFileIcon mimeType={file.mime_type} />
        )}
        <span
          className={cn(
            "line-clamp-2 w-full text-[13px] font-semibold leading-snug",
            isSelected ? "text-blue-950" : "text-[#1A1A1A]",
          )}
        >
          {file.name}
        </span>
        <span
          className={cn(
            "text-[11px]",
            isSelected ? "text-blue-700/80" : "text-[#888888]",
          )}
        >
          {formatBytes(file.size_bytes)} · {formatFileOpened(file.updated_at)}
        </span>
        {processing ? (
          <div className="mt-1 flex w-full max-w-full justify-center overflow-hidden px-0.5">
            <FileProcessingBadge
              file={file}
              compact
              className="bg-violet-100 text-violet-900"
            />
          </div>
        ) : null}
        <SharedIndicator flags={shareFlags} className="size-3" />
      </button>
    </div>
  );
}, explorerFileGridTilePropsEqual);
