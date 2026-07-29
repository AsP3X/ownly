// Human: Memoized folder and file tiles for the My Cloud explorer grid.
// Agent: EXTRACTED from DriveCloudExplorer; RENDERS previews, selection, drag-drop; MEMO avoids full-grid re-renders.

import { memo, useRef, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
import { Check, Folder, MoreVertical } from "lucide-react";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import { ExplorerFileGlyph } from "@/components/drive/ExplorerFileGlyph";
import { ExplorerGridPreviewSlot } from "@/components/drive/ExplorerGridPreviewSlot";
import { ExplorerDocumentThumbnail } from "@/components/drive/ExplorerDocumentThumbnail";
import { ExplorerImageThumbnail } from "@/components/drive/ExplorerImageThumbnail";
import { ExplorerVideoThumbnail } from "@/components/drive/ExplorerVideoThumbnail";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { FileProcessingProgressOverlay } from "@/components/drive/FileProcessingProgressOverlay";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import { explorerFileRowRenderEqual } from "@/lib/explorer-file-list-updates";
import { splitFilenameExtension } from "@/lib/explorer-grid-filename";
import { isFileProcessing, isThumbnailProcessing } from "@/lib/file-processing";
import { ExplorerThumbnailShimmer } from "@/components/drive/ExplorerThumbnailShimmer";
import {
  formatBytes,
  formatFileUpdatedRelative,
  isAudioMime,
  isImageMime,
  isEpubMime,
  isPdfMime,
  isRtfPreviewMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
} from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import type { ExplorerTouchDragBindings } from "@/components/drive/useExplorerTouchDrag";
import { cn } from "@/lib/utils";

// Human: Browser skips layout/paint for off-screen tiles without JS scroll handlers.
// Agent: APPLIED to folder/file shells; contain-intrinsic-size reserves scroll height.
export const EXPLORER_GRID_TILE_PERF =
  "[content-visibility:auto] max-lg:[contain-intrinsic-size:auto_148px] lg:[contain-intrinsic-size:auto_192px]";

export type ExplorerGridEntry =
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem };

type ExplorerGridFileNameProps = {
  name: string;
  selected?: boolean;
};

// Human: One-line filename — truncates the base, always shows the extension (.xlsx, .pdf, …).
// Agent: SPLITS via splitFilenameExtension; CSS truncate on base span only; title holds full name.
function ExplorerGridFileName({ name, selected = false }: ExplorerGridFileNameProps) {
  const { base, extension } = splitFilenameExtension(name);
  return (
    <span
      className={cn(
        // Human: Left-aligned, not centered — centered filenames are the tell of a stock template
        // and make scanning a column of names harder.
        "flex min-w-0 w-full items-baseline text-xs font-medium leading-snug lg:text-[13px]",
        selected ? "text-brand" : "text-ink",
      )}
      title={name}
    >
      <span className="min-w-0 truncate">{base}</span>
      {extension ? <span className="shrink-0 text-ink-faint">{extension}</span> : null}
    </span>
  );
}

export type ExplorerFolderGridTileProps = {
  folder: FolderItem;
  shareFlags?: ShareFlags;
  isDropTarget: boolean;
  dragEnabled: boolean;
  selectionEnabled?: boolean;
  isSelected?: boolean;
  hasActiveSelection?: boolean;
  isDragging?: boolean;
  isArmedForTouchDrag?: boolean;
  touchDragEnabled?: boolean;
  getTouchDragBindings?: () => ExplorerTouchDragBindings;
  onToggleSelected?: (folderId: string, checked: boolean) => void;
  onOpenFolder: (folder: FolderItem) => void;
  onDragStart?: (event: DragEvent<HTMLElement>, folderId: string) => void;
  onDragEnd?: () => void;
  onDragEnter: (event: DragEvent<HTMLElement>, folderId: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (folderId: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, folderId: string) => void;
};

// Human: Folder tile — navigation target, optional drag source, and drop target for files/folders.
// Agent: MEMOIZED; CALLS parent drag handlers; RENDERS SharedIndicator from folderShareFlags.
export const ExplorerFolderGridTile = memo(function ExplorerFolderGridTile({
  folder,
  shareFlags,
  isDropTarget,
  dragEnabled,
  selectionEnabled = false,
  isSelected = false,
  hasActiveSelection = false,
  isDragging = false,
  isArmedForTouchDrag = false,
  touchDragEnabled = false,
  getTouchDragBindings,
  onToggleSelected,
  onOpenFolder,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: ExplorerFolderGridTileProps) {
  const touchDragBindings = touchDragEnabled ? getTouchDragBindings?.() : undefined;
  // Human: Once bulk selection is active, the whole folder card toggles select instead of opening.
  // Agent: READS hasActiveSelection + selectionEnabled; USED by onClick to call onToggleSelected.
  const cardSelectMode = selectionEnabled && hasActiveSelection && onToggleSelected !== undefined;

  return (
    <div
      data-folder-id={folder.id}
      data-explorer-entry="folder"
      onDragEnter={(event) => onDragEnter(event, folder.id)}
      onDragOver={onDragOver}
      onDragLeave={() => onDragLeave(folder.id)}
      onDrop={(event) => onDrop(event, folder.id)}
      className={cn(
        EXPLORER_GRID_TILE_PERF,
        "group relative min-w-0 w-full overflow-hidden rounded-lg border bg-panel transition-[border-color,box-shadow,background-color]",
        isSelected
          ? "border-brand bg-brand-weak"
          : "border-edge hover:border-edge-strong hover:bg-surface",
        isDropTarget && "border-brand bg-brand-weak ring-2 ring-brand/25",
        isDragging && "opacity-50",
        isArmedForTouchDrag && !isDragging && "scale-[0.98] ring-2 ring-brand/50",
        touchDragEnabled && "touch-manipulation",
        cardSelectMode && "cursor-pointer",
      )}
    >
      {selectionEnabled && onToggleSelected ? (
        <label
          className={cn(
            "absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md transition-opacity",
            isSelected || hasActiveSelection
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onToggleSelected(folder.id, event.target.checked)
            }
            className="peer sr-only"
            aria-label={`Select ${folder.name}`}
            onClick={(event) => event.stopPropagation()}
          />
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-md border transition-colors",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-1",
              isSelected
                ? "border-brand bg-brand text-brand-on"
                : "border-edge-strong bg-panel text-transparent shadow-sm",
            )}
            aria-hidden
          >
            <Check className="size-3.5 stroke-[2.5]" />
          </span>
        </label>
      ) : null}
      <button
        type="button"
        data-explorer-activate
        draggable={dragEnabled && !touchDragEnabled}
        aria-label={
          cardSelectMode
            ? isSelected
              ? `Deselect folder ${folder.name}`
              : `Select folder ${folder.name}`
            : `Open folder ${folder.name}`
        }
        onClick={() => {
          if (touchDragBindings?.consumeSuppressedClick()) return;
          if (cardSelectMode && onToggleSelected) {
            onToggleSelected(folder.id, !isSelected);
            return;
          }
          onOpenFolder(folder);
        }}
        onDragStart={(event) => onDragStart?.(event, folder.id)}
        onDragEnd={onDragEnd}
        onPointerDown={touchDragBindings?.onPointerDown}
        onPointerMove={touchDragBindings?.onPointerMove}
        onPointerUp={touchDragBindings?.onPointerUp}
        onPointerCancel={touchDragBindings?.onPointerCancel}
        className={cn(
          "flex h-full w-full flex-col items-stretch p-1 text-left",
          touchDragBindings && "touch-pan-y",
        )}
      >
        {/* Human: Same preview slot footprint as file tiles so folders align in the grid. */}
        {/* Agent: RENDERS centered folder icon inside the shared square preview slot. */}
        <ExplorerGridPreviewSlot>
          <Folder className="size-7 text-amber-600 dark:text-amber-400" aria-hidden />
        </ExplorerGridPreviewSlot>
        {/* Human: Metadata footer separated by a hairline rather than floating under the image. */}
        {/* Agent: mt-1 + border-t; keeps the tile's overall height stable for contain-intrinsic-size. */}
        <span className="mt-1 flex flex-col gap-0.5 border-t border-hairline px-1 pt-1.5">
          <span
            className={cn(
              "w-full truncate text-xs font-medium leading-snug lg:text-[13px]",
              isSelected ? "text-brand" : "text-ink",
            )}
            title={folder.name}
          >
            {folder.name}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-ink-faint lg:text-[11px]">
            Folder
            <SharedIndicator flags={shareFlags} className="size-3" />
          </span>
        </span>
      </button>
    </div>
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
  onPreviewEpub?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewRtf?: (file: FileItem) => void;
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
  onPreviewEpub,
  onPreviewText,
  onPreviewRtf,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onOpenActions,
}: ExplorerFileGridTileProps) {
  const isVideo = file.mime_type?.startsWith("video/") ?? false;
  const isImage = isImageMime(file.mime_type);
  const isPdf = isPdfMime(file.mime_type);
  const isEpub = isEpubMime(file.mime_type, file.name);
  const isSpreadsheet = isSpreadsheetPreviewMime(file.mime_type, file.name);
  const isAudio = isAudioMime(file.mime_type);
  const processing = isFileProcessing(file);
  const thumbnailProcessing = isThumbnailProcessing(file);
  const canPreviewVideo = isVideo && onPreviewVideo !== undefined && !processing;
  const canPreviewImage = isImage && onPreviewImage !== undefined && !processing;
  const canPreviewPdf = isPdf && onPreviewPdf !== undefined && !processing;
  const canPreviewEpub = isEpub && onPreviewEpub !== undefined && !processing;
  const canPreviewSpreadsheet =
    isSpreadsheet && onPreviewSpreadsheet !== undefined && !processing;
  const canPreviewText =
    isTextCodePreviewMime(file.mime_type, file.name) &&
    onPreviewText !== undefined &&
    !processing;
  const canPreviewRtf =
    isRtfPreviewMime(file.mime_type, file.name) &&
    onPreviewRtf !== undefined &&
    !processing;
  const canPreviewAudio = isAudio && onPreviewAudio !== undefined && !processing;
  const canPreview =
    canPreviewVideo ||
    canPreviewImage ||
    canPreviewPdf ||
    canPreviewEpub ||
    canPreviewSpreadsheet ||
    canPreviewText ||
    canPreviewRtf ||
    canPreviewAudio;
  const showImagePreview = isImage && !processing;
  const showVideoPreview = isVideo && file.video_thumbnail_ready;
  const showDocumentPreview = (isPdf || isSpreadsheet || isEpub) && !processing;
  // Human: PDF, spreadsheet, and EPUB tiles wait for stored document JPEG sidecars.
  // Agent: showDocumentPreview USES ExplorerDocumentThumbnail; SKIPS client-side xlsx mini-grid fallback.
  const showLiveThumbnailPreview =
    showImagePreview || showVideoPreview || showDocumentPreview;
  const touchDragBindings = touchDragEnabled ? getTouchDragBindings?.() : undefined;
  // Human: In bulk-select mode (or mobile selection mode), the whole card toggles selection.
  // Agent: READS hasActiveSelection + mobileSelectionMode; USED by pointer/click handlers instead of preview.
  const cardSelectMode =
    selectionEnabled && !processing && (hasActiveSelection || mobileSelectionMode);
  // Human: Track tap start so scroll gestures on a tile do not toggle selection.
  // Agent: READS pointer down/up delta; CALLS toggleCardSelection only within MOBILE_TAP_SLOP_PX.
  const mobileTapStartRef = useRef<{ x: number; y: number } | null>(null);
  // Human: After a touch/pen toggle on pointerup, ignore the synthetic click that follows.
  // Agent: WRITES true on successful touch toggle; CLEARS in onClick to prevent double select.
  const suppressNextClickRef = useRef(false);
  const MOBILE_TAP_SLOP_PX = 10;

  function toggleCardSelection() {
    if (onTapToggleFileSelection) {
      onTapToggleFileSelection(file.id);
      return;
    }
    onToggleSelected(file.id, !isSelected);
  }

  function handleTilePointerDown(event: PointerEvent<HTMLButtonElement>) {
    // Human: Touch scroll-safe select — arm only on coarse pointers while card-select is active.
    // Agent: WRITES mobileTapStartRef for pointerType touch/pen; desktop mouse uses onClick instead.
    if (cardSelectMode && (event.pointerType === "touch" || event.pointerType === "pen")) {
      mobileTapStartRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (cardSelectMode) return;
    touchDragBindings?.onPointerDown(event);
  }

  function handleTilePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (cardSelectMode && (event.pointerType === "touch" || event.pointerType === "pen")) {
      const start = mobileTapStartRef.current;
      mobileTapStartRef.current = null;
      if (!start) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance <= MOBILE_TAP_SLOP_PX) {
        toggleCardSelection();
        suppressNextClickRef.current = true;
      }
      return;
    }
    if (cardSelectMode) return;
    touchDragBindings?.onPointerUp(event);
  }

  function handleTilePointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (cardSelectMode) {
      mobileTapStartRef.current = null;
      return;
    }
    touchDragBindings?.onPointerCancel(event);
  }

  return (
    <div
      data-file-id={file.id}
      data-explorer-entry="file"
      className={cn(
        EXPLORER_GRID_TILE_PERF,
        "group relative min-w-0 w-full overflow-hidden rounded-lg border bg-panel transition-[border-color,box-shadow,background-color]",
        isSelected
          ? "border-brand bg-brand-weak"
          : "border-edge hover:border-edge-strong hover:bg-surface",
        cardSelectMode && !isSelected && "hover:bg-brand-weak/60",
        processing && "opacity-80",
        isDragging && "opacity-50",
        isArmedForTouchDrag && !isDragging && "scale-[0.98] ring-2 ring-brand/50",
        touchDragEnabled && "touch-manipulation",
        cardSelectMode && "cursor-pointer",
      )}
    >
      {selectionEnabled ? (
        <label
          className={cn(
            "absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md transition-opacity",
            isSelected || hasActiveSelection || mobileSelectionMode
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            // Human: Card-select uses one handler on the tile — ignore checkbox hits to avoid double toggles.
            // Agent: APPLIES pointer-events-none while cardSelectMode so only the tile button toggles.
            cardSelectMode && "pointer-events-none",
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
              "peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-1",
              isSelected
                ? "border-brand bg-brand text-brand-on"
                : "border-edge-strong bg-panel text-transparent shadow-sm",
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
            "absolute left-1.5 top-1.5 z-10 size-7 text-ink-faint lg:hidden",
            isSelected && "bg-panel/80",
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
        data-explorer-activate
        draggable={dragEnabled && !processing && !touchDragEnabled && !cardSelectMode}
        aria-label={
          cardSelectMode
            ? isSelected
              ? `Deselect ${file.name}`
              : `Select ${file.name}`
            : canPreview
              ? `Preview ${file.name}`
              : file.name
        }
        onDragStart={(event) => onDragStart(event, file.id)}
        onDragEnd={onDragEnd}
        onPointerDown={handleTilePointerDown}
        onPointerMove={touchDragBindings?.onPointerMove}
        onPointerUp={handleTilePointerUp}
        onPointerCancel={handleTilePointerCancel}
        onClick={() => {
          // Human: Mouse/keyboard activate the card for select or preview; touch select is pointer-up.
          // Agent: SKIPS when suppressNextClickRef (touch already toggled); else toggles or previews.
          if (cardSelectMode) {
            if (suppressNextClickRef.current) {
              suppressNextClickRef.current = false;
              return;
            }
            toggleCardSelection();
            return;
          }
          if (touchDragBindings?.consumeSuppressedClick()) return;
          if (!canPreview) return;
          if (canPreviewVideo) onPreviewVideo!(file);
          else if (canPreviewImage) onPreviewImage!(file);
          else if (canPreviewPdf) onPreviewPdf!(file);
          else if (canPreviewEpub) onPreviewEpub!(file);
          else if (canPreviewSpreadsheet) onPreviewSpreadsheet!(file);
          else if (canPreviewRtf) onPreviewRtf!(file);
          else if (canPreviewText) onPreviewText!(file);
          else if (canPreviewAudio) onPreviewAudio!(file);
        }}
        className={cn(
          "flex h-full w-full flex-col items-stretch p-1 text-left",
          // Human: pan-y keeps list scroll working on first touch over a tile; drag arms only after long-press.
          // Agent: AVOIDS touch-none here — that blocks native vertical scroll across the whole grid on mobile.
          touchDragBindings && !cardSelectMode && "touch-pan-y",
        )}
      >
        {/* Human: Every tile reserves the same preview frame — thumbnails fill it; others show a centered icon. */}
        {/* Agent: WRAPS lazy thumbnail loaders; KEEPS grid row height uniform across preview and non-preview files. */}
        <ExplorerGridPreviewSlot
          centerContent={!showLiveThumbnailPreview && !thumbnailProcessing}
        >
          {showImagePreview ? (
            <ExplorerImageThumbnail file={file} slotFill />
          ) : showVideoPreview ? (
            <ExplorerVideoThumbnail
              key={`${file.id}-${file.video_thumbnail_selected_index ?? 0}`}
              file={file}
              slotFill
            />
          ) : showDocumentPreview ? (
            <ExplorerDocumentThumbnail file={file} slotFill />
          ) : thumbnailProcessing ? (
            <ExplorerThumbnailShimmer slotFill />
          ) : (
            <ExplorerFileGlyph mimeType={file.mime_type} className="size-7" />
          )}
          {processing ? <FileProcessingProgressOverlay file={file} /> : null}
        </ExplorerGridPreviewSlot>
        {/* Human: Metadata footer separated by a hairline — mirrors the folder tile rhythm. */}
        {/* Agent: mt-1 + border-t; size/date use tabular numerals so columns of tiles line up. */}
        <span className="mt-1 flex flex-col gap-0.5 border-t border-hairline px-1 pt-1.5">
          <ExplorerGridFileName name={file.name} selected={isSelected} />
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-ink-faint lg:text-[11px]">
            {formatBytes(file.size_bytes)}
            <span aria-hidden>·</span>
            {formatFileUpdatedRelative(file.updated_at)}
            <SharedIndicator flags={shareFlags} className="size-3" />
          </span>
          {processing ? (
            <span className="mt-0.5 flex w-full max-w-full overflow-hidden">
              <FileProcessingBadge file={file} compact className="bg-proc-weak text-proc" />
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}, explorerFileGridTilePropsEqual);
