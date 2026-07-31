// Human: Command bar shown when one or more files are selected in the My files browser.
// Agent: RENDERS selection count + bulk download/favourite/delete/clear; CALLS parent handlers only.

import type { ReactNode } from "react";
import {
  Check,
  Copy,
  Download,
  FolderInput,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BulkActionsBarProps = {
  selectedCount: number;
  /** Human: Files in the current folder listing that can be bulk-selected. */
  selectableCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  favouriteLabel: string;
  onDownload: () => void;
  onToggleFavourite: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  onCopyToFolder?: () => void;
  onMoveToFolder?: () => void;
  /** Human: Show copy/move icon buttons on the mobile floating bar. */
  showMobileFolderActions?: boolean;
  /** Human: Queue HLS rebuild for every rebuildable video in the selection. */
  onRebuildStreams?: () => void;
  /** Human: True while bulk reprocess requests are in flight. */
  rebuildingStreams?: boolean;
  /** Human: How many selected files can accept a stream rebuild (hides button when 0). */
  rebuildableStreamCount?: number;
};

type BulkActionButtonProps = {
  /** Human: Accessible name and tooltip (full phrase, e.g. "Add to favourites"). */
  label: string;
  /** Human: Short desktop caption; falls back to label when omitted. */
  desktopLabel?: string;
  onClick: () => void;
  icon: ReactNode;
  /** Human: Show a text caption beside the icon on desktop. */
  showDesktopLabel?: boolean;
  tone?: "default" | "danger" | "ghost";
  className?: string;
  disabled?: boolean;
  /** Human: Force this control to render only on mobile (e.g. copy/move). */
  mobileOnly?: boolean;
};

// Human: Shared action control — icon-only on mobile, icon+label on desktop where useful.
// Agent: APPLIES tone-based classes for default/danger/ghost; HIDES when mobileOnly on lg+.
function BulkActionButton({
  label,
  desktopLabel,
  onClick,
  icon,
  showDesktopLabel = false,
  tone = "default",
  className,
  disabled,
  mobileOnly = false,
}: BulkActionButtonProps) {
  const caption = desktopLabel ?? label;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "size-8 shrink-0 rounded-lg font-semibold transition-colors",
        showDesktopLabel && "lg:h-8 lg:w-auto lg:gap-1.5 lg:px-2.5",
        mobileOnly && "lg:hidden",
        // Mobile (dark floating bar)
        "text-white/95 hover:bg-white/12 hover:text-white active:bg-white/15",
        // Desktop (white toolbar)
        "lg:text-ink lg:hover:bg-sunken lg:hover:text-ink",
        tone === "default" &&
          "lg:border lg:border-edge lg:bg-panel lg:shadow-sm lg:hover:border-edge-strong lg:hover:bg-surface",
        tone === "danger" &&
          "lg:border lg:border-danger/30 lg:bg-panel lg:text-danger lg:shadow-sm lg:hover:border-danger/50 lg:hover:bg-danger-weak",
        tone === "ghost" &&
          "lg:border-0 lg:bg-transparent lg:shadow-none lg:text-ink-muted lg:hover:bg-sunken lg:hover:text-ink",
        className,
      )}
    >
      {icon}
      {showDesktopLabel ? (
        <span className="hidden text-[13px] leading-none lg:inline">{caption}</span>
      ) : null}
    </Button>
  );
}

// Human: Bulk toolbar — refined floating dock on mobile, elevated white card on desktop.
// Agent: DISABLES actions when selectedCount is 0; favouriteLabel reflects add vs remove intent.
export function BulkActionsBar({
  selectedCount,
  selectableCount,
  allSelected,
  onSelectAll,
  favouriteLabel,
  onDownload,
  onToggleFavourite,
  onDelete,
  onClearSelection,
  onCopyToFolder,
  onMoveToFolder,
  showMobileFolderActions = false,
  onRebuildStreams,
  rebuildingStreams = false,
  rebuildableStreamCount = 0,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  const showSelectAll = selectableCount > 0 && !allSelected;
  const showMobileCopyMove =
    showMobileFolderActions && selectedCount >= 2 && onCopyToFolder !== undefined;
  const showRebuildStreams =
    onRebuildStreams !== undefined && rebuildableStreamCount > 0;
  const itemLabel = selectedCount === 1 ? "item" : "items";

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        // Human: Mobile — floating dark glass dock above the bottom nav.
        // Agent: fixed bottom + blur + deep shadow; safe-area offset matches MobileBottomNav height.
        // The dock uses the overlay token family, which stays dark in BOTH themes so it reads as
        // an overlay above the content rather than as another page surface.
        "max-lg:fixed max-lg:bottom-[calc(5.25rem+env(safe-area-inset-bottom))] max-lg:left-3 max-lg:right-3 max-lg:z-30",
        "max-lg:rounded-2xl max-lg:border max-lg:border-white/10",
        "max-lg:bg-overlay/92 max-lg:px-3 max-lg:py-2.5 max-lg:text-white",
        "max-lg:shadow-[0_16px_40px_rgba(15,23,42,0.35)] max-lg:backdrop-blur-xl",
        // Human: Desktop — white selection card matching explorer surfaces.
        // Agent: static inside sticky host on DrivePage; ring + soft shadow for elevation.
        "lg:rounded-xl lg:border lg:border-edge lg:bg-panel lg:px-3.5 lg:py-2.5",
        "lg:shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_rgba(16,24,40,0.04)]",
      )}
      role="toolbar"
      aria-label="Bulk file actions"
    >
      {/* Selection summary */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            "bg-brand text-brand-on shadow-sm shadow-brand/25",
            "ring-2 ring-brand/15 lg:ring-4 lg:ring-brand/10",
          )}
          aria-hidden
        >
          <Check className="size-4 stroke-[2.5]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white lg:text-ink">
            <span className="tabular-nums">{selectedCount}</span> {itemLabel} selected
          </p>
          {showSelectAll ? (
            <button
              type="button"
              className={cn(
                "mt-0.5 text-left text-xs font-semibold underline-offset-2 transition-colors",
                "text-overlay-accent hover:text-white hover:underline",
                "lg:text-brand lg:hover:text-brand-hover",
              )}
              onClick={onSelectAll}
              aria-label={`Select all ${selectableCount} items in this folder`}
              title="Select all (Ctrl+A)"
            >
              Select all {selectableCount}
            </button>
          ) : allSelected && selectableCount > 0 ? (
            <p className="mt-0.5 truncate text-xs font-medium text-white/55 lg:text-ink-muted">
              All visible items selected
            </p>
          ) : null}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
        {showMobileCopyMove ? (
          <>
            <BulkActionButton
              label="Copy to folder"
              onClick={onCopyToFolder}
              icon={<Copy className="size-4" />}
              mobileOnly
            />
            <BulkActionButton
              label="Move to folder"
              onClick={() => onMoveToFolder?.()}
              icon={<FolderInput className="size-4" />}
              disabled={!onMoveToFolder}
              mobileOnly
            />
            <span
              className="mx-0.5 hidden h-5 w-px bg-white/15 max-lg:block"
              aria-hidden
            />
          </>
        ) : null}

        <BulkActionButton
          label="Download selected"
          desktopLabel="Download"
          onClick={onDownload}
          icon={<Download className="size-4" />}
          showDesktopLabel
        />
        <BulkActionButton
          label={favouriteLabel}
          desktopLabel="Favourite"
          onClick={onToggleFavourite}
          icon={<Star className="size-4" />}
          showDesktopLabel
        />
        {showRebuildStreams ? (
          <BulkActionButton
            label={
              rebuildingStreams
                ? "Starting stream rebuild…"
                : rebuildableStreamCount === 1
                  ? "Rebuild stream for selected video"
                  : `Rebuild streams for ${rebuildableStreamCount} selected videos`
            }
            desktopLabel={rebuildingStreams ? "Rebuilding…" : "Rebuild"}
            onClick={onRebuildStreams}
            icon={
              <RefreshCw
                className={cn("size-4", rebuildingStreams && "animate-spin")}
              />
            }
            showDesktopLabel
            disabled={rebuildingStreams}
          />
        ) : null}
        <BulkActionButton
          label="Delete selected"
          desktopLabel="Delete"
          onClick={onDelete}
          icon={<Trash2 className="size-4" />}
          showDesktopLabel
          tone="danger"
        />

        <span
          className="mx-0.5 hidden h-5 w-px bg-edge lg:block"
          aria-hidden
        />
        <span className="mx-0.5 h-5 w-px bg-white/15 lg:hidden" aria-hidden />

        <BulkActionButton
          label="Clear selection"
          onClick={onClearSelection}
          icon={<X className="size-4" />}
          tone="ghost"
        />
      </div>
    </div>
  );
}
