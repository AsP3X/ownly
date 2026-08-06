// Human: Explorer command bar — folder trail, search, layout switch, filter, sort and create actions.
// Agent: PRESENTATIONAL; all state lives in DriveCloudExplorer/DrivePage; STICKS to the scrollport top.

import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import {
  ArrowUpDown,
  FilePlus2,
  FolderPlus,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import {
  ExplorerBreadcrumbs,
  useMaxLgViewport,
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
  /** Human: Opens the New document picker — the entry point for the built-in editors. */
  onCreateDocument: () => void;
  onUpload: () => void;
  /** Human: Opens the ⌘K palette — the chip inside the search field is its visible affordance. */
  onOpenCommandPalette: () => void;
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
  /**
   * Human: Desktop shows the folder trail up in the topbar instead of above the search row.
   * Agent: PORTAL TARGET from DrivePage's topbar slot. The breadcrumb element is unchanged, so
   *        its drop targets keep talking to the drag state that lives in DriveCloudExplorer.
   *        Ignored below lg, where the topbar is hidden and the trail stays inline.
   */
  breadcrumbPortalTarget?: HTMLElement | null;
  className?: string;
};

// Human: Neutral-styled toolbar button used for the secondary "New Folder" action.
// Agent: RENDERS a plain button (not the shadcn Button) so drive tokens fully control its chrome.
function ToolbarButton({
  onClick,
  icon,
  label,
  primary = false,
  className,
}: {
  onClick: () => void;
  icon: ReactNode;
  /** Human: Visible caption from sm up; always the accessible name, since it is icon-only below sm. */
  label: string;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
        // Human: Icon-only widths below sm need a square touch target, not a 36px pill.
        "max-sm:size-11 max-sm:justify-center max-sm:gap-0 max-sm:px-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
        primary
          ? "bg-brand text-brand-on hover:bg-brand-hover"
          : "border border-edge bg-panel text-ink hover:bg-surface",
        className,
      )}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="max-sm:hidden" aria-hidden>
        {label}
      </span>
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
  onCreateDocument,
  onUpload,
  onOpenCommandPalette,
  bulkActionsSlot,
  containerRef,
  breadcrumbPortalTarget,
  className,
}: ExplorerToolbarProps) {
  // Human: Below lg the topbar is hidden, so the trail has to stay in the toolbar.
  const isMaxLg = useMaxLgViewport();
  const breadcrumbs = (
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
  );
  const hoistBreadcrumbs = !isMaxLg && breadcrumbPortalTarget !== null && breadcrumbPortalTarget !== undefined;
  // Human: At the root on mobile the trail reads "Home › My Cloud", which the sticky mobile header
  // already says one line above. Drop the row there and keep it once you are inside a folder,
  // where it is the only way to jump more than one level up.
  const showInlineBreadcrumbs = !isMaxLg || folderStack.length > 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        // Human: No backdrop-filter here. It would make this element the containing block for
        // its fixed-position descendants, and the mobile bulk actions bar renders inside this
        // block — it would then anchor to the toolbar and cover the search field instead of
        // floating above the bottom nav. bg-surface/95 already reads as opaque.
        "sticky top-0 z-20 flex flex-col gap-2.5 border-b border-edge bg-surface/95 pb-2.5 pt-1",
        className,
      )}
    >
      {hoistBreadcrumbs
        ? createPortal(breadcrumbs, breadcrumbPortalTarget)
        : showInlineBreadcrumbs
          ? breadcrumbs
          : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* Human: Search filters this view; the ⌘K chip opens the palette that searches everything. */}
        {/* Agent: type=search keeps the native clear affordance; Enter submits via onSearchKeyDown. */}
        <div className="flex h-9 min-w-[10rem] flex-1 items-center gap-2 rounded-lg border border-edge bg-panel px-3 focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-focus/25 max-lg:h-11 lg:max-w-[22rem]">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search files…"
            aria-label="Search files. Press Enter to search."
            // Human: text-base below lg — iOS Safari zooms the whole page when a focused field
            // is under 16px, and this raw input bypassed the ui/Input component that guards it.
            // h-full makes the whole 44px field tappable; the bare input was only 24px tall, so
            // most of what reads as the search box did not actually focus it.
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none lg:text-[13px]"
          />
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Open the command palette to search everywhere. Shortcut: Ctrl+K or Command+K."
            className="hidden shrink-0 rounded border border-edge bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-faint transition-colors hover:border-brand/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 lg:inline"
          >
            ⌘K
          </button>
        </div>

        {/* Human: Wraps below ~350px — the view/filter/sort group plus both action buttons no
            longer fit on one line there, and without wrapping the Upload button is clipped
            off-screen by the pane's overflow-hidden. */}
        {/* Human: Tighter gaps below lg — at 320px the two clusters plus 8px gaps overflowed by a
            few pixels and wrapped the row onto a third line. */}
        <div className="flex flex-wrap items-center gap-2 max-lg:w-full max-lg:justify-between max-lg:gap-1.5 lg:ml-auto">
          <div className="flex items-center gap-2 max-lg:gap-1.5">
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

          <div className="flex items-center gap-2 max-lg:gap-1.5">
            <ToolbarButton
              onClick={onCreateFolder}
              icon={<FolderPlus className="size-4" />}
              label="New Folder"
            />
            <ToolbarButton
              onClick={onCreateDocument}
              icon={<FilePlus2 className="size-4" />}
              label="New Document"
            />
            {/* Human: Hidden below lg — the mobile bottom nav carries the Upload tab, and three
                identical upload entry points on one phone screen is two too many. */}
            <ToolbarButton
              onClick={onUpload}
              icon={<Upload className="size-4" />}
              label="Upload Files"
              primary
              className="max-lg:hidden"
            />
          </div>
        </div>
      </div>

      {bulkActionsSlot}
    </div>
  );
}
