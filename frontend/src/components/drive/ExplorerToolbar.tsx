// Human: Explorer command bar — folder trail, search, layout switch, filter, sort and create actions.
// Agent: PRESENTATIONAL; all state lives in DriveCloudExplorer/DrivePage; STICKS to the scrollport top.

import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";

import { ArrowUpDown, FolderPlus, Search, SlidersHorizontal, Upload } from "lucide-react";
import {
  ExplorerBreadcrumbs,
  type ExplorerFolderCrumb,
} from "@/components/drive/ExplorerBreadcrumbs";
import { ExplorerSelectMenu } from "@/components/drive/ExplorerSelectMenu";
import { ExplorerViewSwitcher } from "@/components/drive/ExplorerViewSwitcher";
import {
  EXPLORER_FILE_SORT_OPTIONS,
  type ExplorerFileSort,
  type ExplorerViewMode,
} from "@/lib/drive-preferences";
import type { FileTypeFilter } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

export type ExplorerToolbarProps = {
  folderStack: ExplorerFolderCrumb[];
  onNavigateHome: () => void;
  onNavigateMyCloudRoot: () => void;
  onGoToFolderIndex: (index: number) => void;
  dragEnabled?: boolean;
  dropTargetBreadcrumb?: string | null;
  onBreadcrumbDragEnter?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
  onBreadcrumbDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onBreadcrumbDragLeave?: (dropTarget: string) => void;
  onBreadcrumbDrop?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;

  query: string;
  onQueryChange: (value: string) => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;

  typeFilter: FileTypeFilter;
  onTypeFilterChange: (filter: FileTypeFilter) => void;
  typeFilterOptions: readonly { id: FileTypeFilter; label: string }[];

  fileSort: ExplorerFileSort;
  onFileSortChange: (sort: ExplorerFileSort) => void;

  viewMode: ExplorerViewMode;
  onViewModeChange: (mode: ExplorerViewMode) => void;

  onCreateFolder: () => void;
  onUpload: () => void;
  /**
   * Human: Bulk actions bar, rendered inside the sticky block so it stacks under the toolbar
   * instead of fighting it for `top: 0`.
   * Agent: On mobile BulkActionsBar positions itself `fixed`, so this DOM slot is inert there.
   */
  bulkActionsSlot?: ReactNode;
  /**
   * Human: Lets the explorer measure the bar's height so the list column header can stick
   * directly beneath it — the height changes when the bulk actions bar appears.
   * Agent: WRITTEN by DriveCloudExplorer's ResizeObserver; do not read it during render.
   */
  containerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
};

// Human: Neutral-styled toolbar button used for the secondary "New Folder" action.
// Agent: RENDERS a plain button (not the shadcn Button) so drive tokens fully control its chrome.
function ToolbarButton({
  onClick,
  icon,
  children,
  primary = false,
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
        primary
          ? "bg-brand text-brand-on hover:bg-brand-hover"
          : "border border-edge bg-panel text-ink hover:bg-surface",
      )}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  );
}

// Human: Single sticky bar holding navigation and every explorer command.
// Agent: TWO rows below lg (trail, then controls); ONE row on lg+ where space allows.
export function ExplorerToolbar({
  folderStack,
  onNavigateHome,
  onNavigateMyCloudRoot,
  onGoToFolderIndex,
  dragEnabled = false,
  dropTargetBreadcrumb,
  onBreadcrumbDragEnter,
  onBreadcrumbDragOver,
  onBreadcrumbDragLeave,
  onBreadcrumbDrop,
  query,
  onQueryChange,
  onSearchKeyDown,
  searchInputRef,
  typeFilter,
  onTypeFilterChange,
  typeFilterOptions,
  fileSort,
  onFileSortChange,
  viewMode,
  onViewModeChange,
  onCreateFolder,
  onUpload,
  bulkActionsSlot,
  containerRef,
  className,
}: ExplorerToolbarProps) {
  return (
    <div
      ref={containerRef}
      className={cn(
        "sticky top-0 z-20 flex flex-col gap-2.5 border-b border-edge bg-surface/95 pb-2.5 pt-1 backdrop-blur-sm",
        className,
      )}
    >
      <ExplorerBreadcrumbs
        folderStack={folderStack}
        onNavigateHome={onNavigateHome}
        onNavigateMyCloudRoot={onNavigateMyCloudRoot}
        onGoToFolderIndex={onGoToFolderIndex}
        dragEnabled={dragEnabled}
        dropTargetBreadcrumb={dropTargetBreadcrumb}
        onBreadcrumbDragEnter={onBreadcrumbDragEnter}
        onBreadcrumbDragOver={onBreadcrumbDragOver}
        onBreadcrumbDragLeave={onBreadcrumbDragLeave}
        onBreadcrumbDrop={onBreadcrumbDrop}
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* Human: Search grows to fill the bar; Ctrl+K focus is wired in DriveCloudExplorer. */}
        {/* Agent: type=search keeps the native clear affordance; Enter submits via onSearchKeyDown. */}
        <div className="flex h-9 min-w-[10rem] flex-1 items-center gap-2 rounded-lg border border-edge bg-panel px-3 focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-focus/25 lg:max-w-[22rem]">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search files…"
            aria-label="Search files. Press Enter to search, Ctrl+K or Command+K to focus."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-edge bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-faint lg:inline">
            ⌘K
          </kbd>
        </div>

        <div className="flex items-center gap-2 max-lg:w-full max-lg:justify-between lg:ml-auto">
          <div className="flex items-center gap-2">
            <ExplorerViewSwitcher value={viewMode} onChange={onViewModeChange} />

            <ExplorerSelectMenu
              label="Filter"
              icon={<SlidersHorizontal className="size-4" />}
              options={typeFilterOptions}
              value={typeFilter}
              neutralValue="all"
              onChange={onTypeFilterChange}
              menuLabel="Filter by file type"
            />

            <ExplorerSelectMenu
              label="Sort"
              icon={<ArrowUpDown className="size-4" />}
              options={EXPLORER_FILE_SORT_OPTIONS}
              value={fileSort}
              neutralValue="name-asc"
              onChange={onFileSortChange}
              menuLabel="Sort files"
              menuClassName="min-w-[15rem]"
            />
          </div>

          <div className="flex items-center gap-2">
            <ToolbarButton onClick={onCreateFolder} icon={<FolderPlus className="size-4" />}>
              <span className="max-sm:sr-only">New Folder</span>
            </ToolbarButton>
            <ToolbarButton onClick={onUpload} icon={<Upload className="size-4" />} primary>
              <span className="max-sm:sr-only">Upload Files</span>
            </ToolbarButton>
          </div>
        </div>
      </div>

      {bulkActionsSlot}
    </div>
  );
}
