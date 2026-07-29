// Human: Explorer folder trail — Home › My Cloud › folder path, with drag-drop move targets.
// Agent: EXTRACTED from DriveCloudExplorer; CALLS parent navigation handlers; COLLAPSES deep paths.

import { useMemo, useSyncExternalStore, type DragEvent } from "react";
import { ChevronRight, House } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExplorerFolderCrumb = { id: string; name: string };

/**
 * Human: How many folder crumbs stay visible before the trail collapses behind a `…` jump.
 * Agent: Mobile keeps 2 (narrow bar); desktop keeps 4 so long paths no longer overflow the toolbar.
 */
const BREADCRUMB_COLLAPSE_DEPTH_MOBILE = 2;
const BREADCRUMB_COLLAPSE_DEPTH_DESKTOP = 4;

// Human: Match Tailwind lg breakpoint for viewport-dependent breadcrumb behavior.
// Agent: READS matchMedia (max-width: 1023px); SUBSCRIBES to viewport resize.
export function useMaxLgViewport(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mediaQuery = window.matchMedia("(max-width: 1023px)");
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(max-width: 1023px)").matches,
    () => false,
  );
}

type ExplorerBreadcrumbCrumbProps = {
  label: string;
  isCurrent: boolean;
  onClick: () => void;
  className?: string;
  /** Human: When set, this crumb accepts drag-drop moves into the encoded parent folder (root = `root`). */
  breadcrumbDropTarget?: string;
  isDropTarget?: boolean;
  dragEnabled?: boolean;
  onBreadcrumbDragEnter?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
  onBreadcrumbDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onBreadcrumbDragLeave?: (dropTarget: string) => void;
  onBreadcrumbDrop?: (event: DragEvent<HTMLButtonElement>, dropTarget: string) => void;
};

// Human: One tappable breadcrumb segment with truncation for long folder names.
// Agent: RENDERS button; SETS title tooltip to full name; OPTIONAL drop target.
function ExplorerBreadcrumbCrumb({
  label,
  isCurrent,
  onClick,
  className,
  breadcrumbDropTarget,
  isDropTarget = false,
  dragEnabled = false,
  onBreadcrumbDragEnter,
  onBreadcrumbDragOver,
  onBreadcrumbDragLeave,
  onBreadcrumbDrop,
}: ExplorerBreadcrumbCrumbProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={isCurrent ? "page" : undefined}
      data-breadcrumb-drop={breadcrumbDropTarget}
      onDragEnter={
        dragEnabled && breadcrumbDropTarget !== undefined
          ? (event) => onBreadcrumbDragEnter?.(event, breadcrumbDropTarget)
          : undefined
      }
      onDragOver={dragEnabled ? onBreadcrumbDragOver : undefined}
      onDragLeave={
        dragEnabled && breadcrumbDropTarget !== undefined
          ? () => onBreadcrumbDragLeave?.(breadcrumbDropTarget)
          : undefined
      }
      onDrop={
        dragEnabled && breadcrumbDropTarget !== undefined
          ? (event) => onBreadcrumbDrop?.(event, breadcrumbDropTarget)
          : undefined
      }
      className={cn(
        "shrink-0 rounded-md px-1.5 py-1 transition-colors max-w-[9.5rem] truncate lg:max-w-[12rem]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
        isCurrent
          ? "font-semibold text-ink"
          : "text-ink-muted hover:bg-surface hover:text-ink",
        isDropTarget && "bg-brand-weak text-brand ring-2 ring-brand/40",
        className,
      )}
    >
      {label}
    </button>
  );
}

export type ExplorerBreadcrumbsProps = {
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
  className?: string;
};

// Human: Breadcrumb trail; crumbs double as drop targets so items can be moved up the tree.
// Agent: SCROLLS horizontally when narrow; COLLAPSES middle crumbs behind a `…` jump button.
export function ExplorerBreadcrumbs({
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
  className,
}: ExplorerBreadcrumbsProps) {
  const isMobile = useMaxLgViewport();
  const collapseDepth = isMobile
    ? BREADCRUMB_COLLAPSE_DEPTH_MOBILE
    : BREADCRUMB_COLLAPSE_DEPTH_DESKTOP;
  const shouldCollapse = folderStack.length > collapseDepth;

  // Human: Keep the last `collapseDepth` crumbs; earlier ones hide behind the `…` control.
  // Agent: RETURNS crumbs with their original stack index so navigation stays correct.
  const visibleFolderCrumbs = useMemo(() => {
    if (!shouldCollapse) {
      return folderStack.map((crumb, index) => ({ crumb, index }));
    }
    return folderStack.slice(-collapseDepth).map((crumb, offset) => ({
      crumb,
      index: folderStack.length - collapseDepth + offset,
    }));
  }, [collapseDepth, folderStack, shouldCollapse]);

  const collapsedJumpIndex = shouldCollapse ? folderStack.length - collapseDepth - 1 : -1;
  const collapsedJumpLabel =
    collapsedJumpIndex >= 0 ? folderStack[collapsedJumpIndex]?.name : null;

  return (
    <nav
      className={cn(
        "flex min-w-0 items-center gap-0.5 text-[13px]",
        "-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      aria-label="Folder path"
    >
      <button
        type="button"
        onClick={onNavigateHome}
        title="Home"
        aria-label="Home"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
      >
        <House className="size-4" aria-hidden />
      </button>
      <ChevronRight className="size-3.5 shrink-0 text-ink-faint/70" aria-hidden />
      <ExplorerBreadcrumbCrumb
        label="My Cloud"
        isCurrent={folderStack.length === 0}
        onClick={onNavigateMyCloudRoot}
        breadcrumbDropTarget="root"
        isDropTarget={dropTargetBreadcrumb === "root"}
        dragEnabled={dragEnabled}
        onBreadcrumbDragEnter={onBreadcrumbDragEnter}
        onBreadcrumbDragOver={onBreadcrumbDragOver}
        onBreadcrumbDragLeave={onBreadcrumbDragLeave}
        onBreadcrumbDrop={onBreadcrumbDrop}
      />
      {shouldCollapse ? (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-ink-faint/70" aria-hidden />
          <button
            type="button"
            onClick={() => onGoToFolderIndex(collapsedJumpIndex)}
            title={collapsedJumpLabel ?? "Show earlier folders"}
            aria-label={
              collapsedJumpLabel ? `Go to ${collapsedJumpLabel}` : "Show earlier folders"
            }
            className="shrink-0 rounded-md px-1.5 py-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
          >
            …
          </button>
        </>
      ) : null}
      {visibleFolderCrumbs.map(({ crumb, index }) => (
        <span key={crumb.id} className="flex shrink-0 items-center gap-0.5">
          <ChevronRight className="size-3.5 shrink-0 text-ink-faint/70" aria-hidden />
          <ExplorerBreadcrumbCrumb
            label={crumb.name}
            isCurrent={index === folderStack.length - 1}
            onClick={() => onGoToFolderIndex(index)}
            breadcrumbDropTarget={crumb.id}
            isDropTarget={dropTargetBreadcrumb === crumb.id}
            dragEnabled={dragEnabled}
            onBreadcrumbDragEnter={onBreadcrumbDragEnter}
            onBreadcrumbDragOver={onBreadcrumbDragOver}
            onBreadcrumbDragLeave={onBreadcrumbDragLeave}
            onBreadcrumbDrop={onBreadcrumbDrop}
          />
        </span>
      ))}
    </nav>
  );
}
