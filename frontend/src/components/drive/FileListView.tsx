// Human: Detail-row layout for the explorer — sortable columns on desktop, stacked rows on mobile.
// Agent: FEATURE-PARITY with ExplorerGridTiles: selection, drag-drop, touch drag, previews, processing.

import { memo, useRef, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, Check, Folder, MoreVertical } from "lucide-react";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import { ExplorerFileGlyph } from "@/components/drive/ExplorerFileGlyph";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { FavouriteIndicator } from "@/components/drive/FavouriteIndicator";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import type { ExplorerTouchDragBindings } from "@/components/drive/useExplorerTouchDrag";
import { explorerFileRowRenderEqual } from "@/lib/explorer-file-list-updates";
import { fileTypeLabel } from "@/lib/explorer-file-type";
import { isFileProcessing } from "@/lib/file-processing";
import {
  EXPLORER_LIST_COLUMN_SORTS,
  type ExplorerFileSort,
} from "@/lib/drive-preferences";
import {
  formatBytes,
  formatFileUpdatedRelative,
  isAudioMime,
  isEpubMime,
  isImageMime,
  isPdfMime,
  isRtfPreviewMime,
  isSpreadsheetPreviewMime,
  isTextCodePreviewMime,
} from "@/lib/utils-app";
import { cn } from "@/lib/utils";

/**
 * Human: Shared column geometry — the header and every row use this one grid definition so
 * columns stay aligned without a <table>, which cannot host the drag/drop handlers we need.
 * Agent: CHANGE HERE ONLY; header and rows both consume it.
 */
const LIST_GRID_CLASS =
  "grid grid-cols-[minmax(0,1fr)_5.5rem_7rem_9rem_2.25rem] items-center gap-3";

// Human: Tick box shared by folder and file rows; mirrors the grid tile checkbox behaviour.
// Agent: RENDERS sr-only input + styled box; stopPropagation keeps row click handlers out of it.
function ListSelectBox({
  checked,
  disabled,
  label,
  onChange,
  hidden,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  /** Human: In card-select mode the row itself toggles, so the box must not double-fire. */
  hidden?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md",
        hidden && "pointer-events-none",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
        onClick={(event) => event.stopPropagation()}
        className="peer sr-only"
        aria-label={label}
      />
      <span
        className={cn(
          "flex size-4.5 items-center justify-center rounded border transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-1",
          checked
            ? "border-brand bg-brand text-brand-on"
            : "border-edge-strong bg-panel text-transparent",
        )}
        aria-hidden
      >
        <Check className="size-3 stroke-[3]" />
      </span>
    </label>
  );
}

export type ExplorerListHeaderProps = {
  fileSort: ExplorerFileSort;
  onFileSortChange: (sort: ExplorerFileSort) => void;
  /** Human: Header select-all reflects and drives selection of every selectable row. */
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  selectionEnabled: boolean;
};

// Human: Desktop column header with click-to-sort on Name and Modified.
// Agent: MAPS columns to existing ExplorerFileSort ids via EXPLORER_LIST_COLUMN_SORTS — no new sort semantics.
function ExplorerListHeader({
  fileSort,
  onFileSortChange,
  allSelected,
  someSelected,
  onToggleSelectAll,
  selectionEnabled,
}: ExplorerListHeaderProps) {
  // Human: Clicking an active column flips direction; clicking a new column uses its primary order.
  // Agent: READS the [primary, secondary] pair for the column; CALLS onFileSortChange.
  function handleSort(column: keyof typeof EXPLORER_LIST_COLUMN_SORTS) {
    const [primary, secondary] = EXPLORER_LIST_COLUMN_SORTS[column];
    onFileSortChange(fileSort === primary ? secondary : primary);
  }

  function sortIndicator(column: keyof typeof EXPLORER_LIST_COLUMN_SORTS) {
    const [primary, secondary] = EXPLORER_LIST_COLUMN_SORTS[column];
    if (fileSort === primary) return <ArrowDown className="size-3" aria-hidden />;
    if (fileSort === secondary) return <ArrowUp className="size-3" aria-hidden />;
    return null;
  }

  function ariaSort(
    column: keyof typeof EXPLORER_LIST_COLUMN_SORTS,
  ): "ascending" | "descending" | "none" {
    const [primary, secondary] = EXPLORER_LIST_COLUMN_SORTS[column];
    if (fileSort === primary) return column === "name" ? "ascending" : "descending";
    if (fileSort === secondary) return column === "name" ? "descending" : "ascending";
    return "none";
  }

  return (
    // Human: Pins directly beneath the toolbar, whose height DriveCloudExplorer measures.
    // Agent: READS --explorer-toolbar-h; falls back to 0 before the first ResizeObserver tick.
    <div
      className="sticky z-10 hidden border-b border-edge bg-surface/95 backdrop-blur-sm lg:block"
      style={{ top: "var(--explorer-toolbar-h, 0px)" }}
    >
      <div className={cn(LIST_GRID_CLASS, "px-2 py-1.5")}>
        <div className="flex min-w-0 items-center gap-2">
          {selectionEnabled ? (
            <ListSelectBox
              checked={allSelected}
              label={allSelected ? "Deselect all items" : "Select all items"}
              onChange={onToggleSelectAll}
              // Human: Indeterminate is conveyed visually by the dash tint below.
              hidden={false}
            />
          ) : null}
          <button
            type="button"
            onClick={() => handleSort("name")}
            aria-sort={ariaSort("name")}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint transition-colors hover:text-ink"
          >
            Name
            {sortIndicator("name")}
          </button>
          {someSelected && !allSelected ? (
            <span className="sr-only">Some items selected</span>
          ) : null}
        </div>
        <span className="text-right text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Size
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Type
        </span>
        <button
          type="button"
          onClick={() => handleSort("uploaded")}
          aria-sort={ariaSort("uploaded")}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint transition-colors hover:text-ink"
        >
          Modified
          {sortIndicator("uploaded")}
        </button>
        <span className="sr-only">Actions</span>
      </div>
    </div>
  );
}

export type ExplorerFolderListRowProps = {
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
  onOpenActions?: (target: MobileActionTarget) => void;
  onDragStart?: (event: DragEvent<HTMLElement>, folderId: string) => void;
  onDragEnd?: () => void;
  onDragEnter: (event: DragEvent<HTMLElement>, folderId: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (folderId: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, folderId: string) => void;
};

// Human: Folder row — opens on click, accepts drops, and joins bulk selection.
// Agent: MEMOIZED; MIRRORS ExplorerFolderGridTile behaviour in row form.
export const ExplorerFolderListRow = memo(function ExplorerFolderListRow({
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
  onOpenActions,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: ExplorerFolderListRowProps) {
  const touchDragBindings = touchDragEnabled ? getTouchDragBindings?.() : undefined;
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
        "group relative border-b border-hairline transition-colors",
        isSelected ? "bg-brand-weak" : "hover:bg-surface",
        isDropTarget && "bg-brand-weak ring-1 ring-inset ring-brand/40",
        isDragging && "opacity-50",
        isArmedForTouchDrag && !isDragging && "ring-2 ring-inset ring-brand/50",
      )}
    >
      <div className={cn(LIST_GRID_CLASS, "max-lg:flex max-lg:items-center max-lg:gap-3")}>
        {/* Human: max-lg:flex-1 claims the leftover row width so the ⋯ button lands on the
            right edge and long names truncate instead of pushing it around. */}
        <div className="flex min-w-0 items-center gap-2 py-2 pl-2 max-lg:flex-1">
          {selectionEnabled && onToggleSelected ? (
            <ListSelectBox
              checked={isSelected}
              label={`Select ${folder.name}`}
              onChange={(checked) => onToggleSelected(folder.id, checked)}
              hidden={cardSelectMode}
            />
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
              "flex min-w-0 flex-1 items-center gap-2.5 text-left",
              touchDragBindings && "touch-pan-y",
            )}
          >
            <Folder className="size-4 shrink-0 text-warn dark:text-warn" aria-hidden />
            <span className="truncate text-[13px] font-medium text-ink" title={folder.name}>
              {folder.name}
            </span>
            <SharedIndicator flags={shareFlags} className="size-3 shrink-0" />
          </button>
        </div>

        <span className="hidden text-right text-[12px] tabular-nums text-ink-faint lg:block">
          —
        </span>
        <span className="hidden text-[12px] text-ink-muted lg:block">Folder</span>
        <span className="hidden text-[12px] tabular-nums text-ink-faint lg:block">—</span>

        {onOpenActions ? (
          <button
            type="button"
            aria-label={`Actions for ${folder.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenActions({ kind: "folder", folder });
            }}
            className="mr-1 flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          >
            <MoreVertical className="size-4" aria-hidden />
          </button>
        ) : (
          <span aria-hidden />
        )}
      </div>
    </div>
  );
});

export type ExplorerFileListRowProps = {
  file: FileItem;
  shareFlags?: ShareFlags;
  selectionEnabled: boolean;
  isSelected: boolean;
  /** Human: Starred for this account — rendered as a badge next to the name. */
  isFavourite?: boolean;
  hasActiveSelection: boolean;
  mobileSelectionMode?: boolean;
  isDragging: boolean;
  isArmedForTouchDrag?: boolean;
  dragEnabled: boolean;
  touchDragEnabled?: boolean;
  getTouchDragBindings?: () => ExplorerTouchDragBindings;
  onToggleSelected: (fileId: string, checked: boolean) => void;
  onTapToggleFileSelection?: (fileId: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, fileId: string) => void;
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
    (a?.public ?? false) === (b?.public ?? false) && (a?.users ?? false) === (b?.users ?? false)
  );
}

// Human: Custom memo compare — only re-render a row when its visible props change.
// Agent: MIRRORS explorerFileGridTilePropsEqual so both layouts share update semantics.
function explorerFileListRowPropsEqual(
  prev: ExplorerFileListRowProps,
  next: ExplorerFileListRowProps,
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

const MOBILE_TAP_SLOP_PX = 10;

// Human: File row — preview on click, drag source, selection target, mobile actions.
// Agent: MEMOIZED; ROUTES previews exactly like ExplorerFileGridTile; SKIPS preview while processing.
export const ExplorerFileListRow = memo(function ExplorerFileListRow({
  file,
  shareFlags,
  selectionEnabled,
  isSelected,
  isFavourite = false,
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
}: ExplorerFileListRowProps) {
  const processing = isFileProcessing(file);
  const canPreviewVideo =
    (file.mime_type?.startsWith("video/") ?? false) && onPreviewVideo !== undefined && !processing;
  const canPreviewImage = isImageMime(file.mime_type) && onPreviewImage !== undefined && !processing;
  const canPreviewPdf = isPdfMime(file.mime_type) && onPreviewPdf !== undefined && !processing;
  const canPreviewEpub =
    isEpubMime(file.mime_type, file.name) && onPreviewEpub !== undefined && !processing;
  const canPreviewSpreadsheet =
    isSpreadsheetPreviewMime(file.mime_type, file.name) &&
    onPreviewSpreadsheet !== undefined &&
    !processing;
  const canPreviewText =
    isTextCodePreviewMime(file.mime_type, file.name) && onPreviewText !== undefined && !processing;
  const canPreviewRtf =
    isRtfPreviewMime(file.mime_type, file.name) && onPreviewRtf !== undefined && !processing;
  const canPreviewAudio = isAudioMime(file.mime_type) && onPreviewAudio !== undefined && !processing;
  const canPreview =
    canPreviewVideo ||
    canPreviewImage ||
    canPreviewPdf ||
    canPreviewEpub ||
    canPreviewSpreadsheet ||
    canPreviewText ||
    canPreviewRtf ||
    canPreviewAudio;

  const touchDragBindings = touchDragEnabled ? getTouchDragBindings?.() : undefined;
  const cardSelectMode =
    selectionEnabled && !processing && (hasActiveSelection || mobileSelectionMode);
  const mobileTapStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  function toggleRowSelection() {
    if (onTapToggleFileSelection) {
      onTapToggleFileSelection(file.id);
      return;
    }
    onToggleSelected(file.id, !isSelected);
  }

  // Human: Touch select must survive scroll gestures — only a near-stationary tap toggles.
  // Agent: WRITES mobileTapStartRef on coarse pointers; desktop mouse falls through to onClick.
  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (cardSelectMode && (event.pointerType === "touch" || event.pointerType === "pen")) {
      mobileTapStartRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (cardSelectMode) return;
    touchDragBindings?.onPointerDown(event);
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    if (cardSelectMode && (event.pointerType === "touch" || event.pointerType === "pen")) {
      const start = mobileTapStartRef.current;
      mobileTapStartRef.current = null;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= MOBILE_TAP_SLOP_PX) {
        toggleRowSelection();
        suppressNextClickRef.current = true;
      }
      return;
    }
    if (cardSelectMode) return;
    touchDragBindings?.onPointerUp(event);
  }

  function handlePointerCancel(event: PointerEvent<HTMLElement>) {
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
        "group relative border-b border-hairline transition-colors",
        isSelected ? "bg-brand-weak" : "hover:bg-surface",
        processing && "bg-proc-weak/40",
        isDragging && "opacity-50",
        isArmedForTouchDrag && !isDragging && "ring-2 ring-inset ring-brand/50",
      )}
    >
      <div className={cn(LIST_GRID_CLASS, "max-lg:flex max-lg:items-center max-lg:gap-3")}>
        {/* Human: max-lg:flex-1 claims the leftover row width so the ⋯ button lands on the
            right edge and long names truncate instead of pushing it around. */}
        <div className="flex min-w-0 items-center gap-2 py-2 pl-2 max-lg:flex-1">
          {selectionEnabled ? (
            <ListSelectBox
              checked={isSelected}
              disabled={processing}
              label={`Select ${file.name}`}
              onChange={(checked) => onToggleSelected(file.id, checked)}
              hidden={cardSelectMode}
            />
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
            onPointerDown={handlePointerDown}
            onPointerMove={touchDragBindings?.onPointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onClick={() => {
              if (cardSelectMode) {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  return;
                }
                toggleRowSelection();
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
              "flex min-w-0 flex-1 items-center gap-2.5 text-left",
              touchDragBindings && !cardSelectMode && "touch-pan-y",
              !canPreview && !cardSelectMode && "cursor-default",
            )}
          >
            <ExplorerFileGlyph mimeType={file.mime_type} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-ink" title={file.name}>
                  {file.name}
                </span>
                <SharedIndicator flags={shareFlags} className="size-3 shrink-0" />
                <FavouriteIndicator favourite={isFavourite} className="size-3 shrink-0" />
              </span>
              {/* Human: Mobile has no columns — fold size and date under the name instead. */}
              {/* Agent: lg:hidden; desktop reads the same values from the dedicated columns. */}
              <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-ink-faint lg:hidden">
                {formatBytes(file.size_bytes)}
                <span aria-hidden>·</span>
                {formatFileUpdatedRelative(file.updated_at)}
              </span>
            </span>
          </button>
        </div>

        <span className="hidden text-right text-[12px] tabular-nums text-ink-muted lg:block">
          {formatBytes(file.size_bytes)}
        </span>
        <span className="hidden truncate text-[12px] text-ink-muted lg:block">
          {fileTypeLabel(file.mime_type, file.name)}
        </span>
        <span className="hidden text-[12px] tabular-nums text-ink-muted lg:block">
          {formatFileUpdatedRelative(file.updated_at)}
        </span>

        {onOpenActions ? (
          <button
            type="button"
            aria-label={`Actions for ${file.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenActions({ kind: "file", file });
            }}
            className="mr-1 flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          >
            <MoreVertical className="size-4" aria-hidden />
          </button>
        ) : (
          <span aria-hidden />
        )}
      </div>

      {/* Human: Processing files keep their status badge visible in row form too. */}
      {/* Agent: RENDERS FileProcessingBadge below the name when isFileProcessing(file). */}
      {processing ? (
        <div className="px-2 pb-2 pl-10">
          <FileProcessingBadge file={file} compact className="bg-proc-weak text-proc" />
        </div>
      ) : null}
    </div>
  );
}, explorerFileListRowPropsEqual);

export { ExplorerListHeader };
