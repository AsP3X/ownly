// Human: Windowed explorer grid — renders only visible rows when folders + files exceed a threshold.
// Agent: USES @tanstack/react-virtual row virtualizer; PACKS entries by column count from ResizeObserver.

import { useLayoutEffect, useMemo, useRef, type DragEvent, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import type { FileItem, FolderItem, ShareFlags } from "@/api/client";
import {
  ExplorerFileGridTile,
  ExplorerFolderGridTile,
} from "@/components/drive/ExplorerGridTiles";
import { useGridColumnCount } from "@/hooks/useGridColumnCount";

export type ExplorerGridEntry =
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem };

/** Human: Switch to virtualized rendering once a folder has enough tiles to stress layout/paint. */
export const EXPLORER_GRID_VIRTUALIZE_THRESHOLD = 48;

const GRID_MIN_TILE_WIDTH = 140;
const GRID_GAP_PX = 16;
const GRID_ROW_ESTIMATE_PX = 176;

type VirtualizedExplorerGridProps = {
  entries: ExplorerGridEntry[];
  scrollElementRef?: RefObject<HTMLElement | null>;
  isSearching: boolean;
  dragEnabled: boolean;
  selectionEnabled: boolean;
  selectedFileIds: Set<string>;
  hasActiveSelection: boolean;
  draggingFileId: string | null;
  dropTargetFolderId: string | null;
  fileShareFlags: Record<string, ShareFlags>;
  folderShareFlags: Record<string, ShareFlags>;
  onOpenFolder: (folder: FolderItem) => void;
  onToggleSelected: (fileId: string, checked: boolean) => void;
  onFolderDragEnter: (event: DragEvent<HTMLButtonElement>, folderId: string) => void;
  onFolderDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onFolderDragLeave: (folderId: string) => void;
  onFolderDrop: (event: DragEvent<HTMLButtonElement>, folderId: string) => void;
  onFileDragStart: (event: DragEvent<HTMLButtonElement>, fileId: string) => void;
  onFileDragEnd: () => void;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewText?: (file: FileItem) => void;
  onPreviewSpreadsheet?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  onOpenActions?: (target: MobileActionTarget) => void;
};

// Human: Row-based virtual grid for large folders — keeps DOM node count near viewport size.
// Agent: READS scrollElementRef; RENDERS ExplorerFolderGridTile / ExplorerFileGridTile per visible row slice.
export function VirtualizedExplorerGrid({
  entries,
  scrollElementRef,
  isSearching,
  dragEnabled,
  selectionEnabled,
  selectedFileIds,
  hasActiveSelection,
  draggingFileId,
  dropTargetFolderId,
  fileShareFlags,
  folderShareFlags,
  onOpenFolder,
  onToggleSelected,
  onFolderDragEnter,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onFileDragStart,
  onFileDragEnd,
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewText,
  onPreviewSpreadsheet,
  onPreviewAudio,
  onOpenActions,
}: VirtualizedExplorerGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columnCount = useGridColumnCount(gridRef, {
    minTileWidth: GRID_MIN_TILE_WIDTH,
    gapPx: GRID_GAP_PX,
  });

  const rowCount = Math.max(1, Math.ceil(entries.length / columnCount));

  // Human: Re-measure virtual rows when column count or entry list changes (resize / pagination).
  // Agent: getScrollElement prefers parent scroll container; estimateSize includes row gap.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElementRef?.current ?? null,
    estimateSize: () => GRID_ROW_ESTIMATE_PX,
    overscan: 4,
    getItemKey: (index) => `explorer-row-${index}-${columnCount}`,
  });

  // Human: Re-measure row heights after resize reflow or when new pages append to the grid.
  // Agent: CALLS rowVirtualizer.measure when columnCount or entries.length changes.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [columnCount, entries.length, rowVirtualizer]);

  const rowStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    }),
    [columnCount],
  );

  return (
    <div ref={gridRef} className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const startIndex = virtualRow.index * columnCount;
        const rowEntries = entries.slice(startIndex, startIndex + columnCount);

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            className="absolute left-0 top-0 grid w-full gap-3 sm:gap-4"
            style={{
              ...rowStyle,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {rowEntries.map((entry) =>
              entry.kind === "folder" ? (
                <ExplorerFolderGridTile
                  key={`folder-${entry.folder.id}`}
                  folder={entry.folder}
                  shareFlags={folderShareFlags[entry.folder.id]}
                  isDropTarget={dropTargetFolderId === entry.folder.id}
                  dragEnabled={dragEnabled && !isSearching}
                  onOpenFolder={onOpenFolder}
                  onDragEnter={onFolderDragEnter}
                  onDragOver={onFolderDragOver}
                  onDragLeave={onFolderDragLeave}
                  onDrop={onFolderDrop}
                />
              ) : (
                <ExplorerFileGridTile
                  key={entry.file.id}
                  file={entry.file}
                  shareFlags={fileShareFlags[entry.file.id]}
                  selectionEnabled={selectionEnabled}
                  isSelected={selectedFileIds.has(entry.file.id)}
                  hasActiveSelection={hasActiveSelection}
                  isDragging={draggingFileId === entry.file.id}
                  dragEnabled={dragEnabled}
                  onToggleSelected={onToggleSelected}
                  onDragStart={onFileDragStart}
                  onDragEnd={onFileDragEnd}
                  onPreviewVideo={onPreviewVideo}
                  onPreviewImage={onPreviewImage}
                  onPreviewPdf={onPreviewPdf}
                  onPreviewText={onPreviewText}
                  onPreviewSpreadsheet={onPreviewSpreadsheet}
                  onPreviewAudio={onPreviewAudio}
                  onOpenActions={onOpenActions}
                />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
