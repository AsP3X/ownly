// Human: Persistent explorer status strip — counts, selection, storage and refresh state.
// Agent: REPLACES the old desktop-only status line in DrivePage; READS counts from the drive shell.

import { Check, Loader2, RefreshCw } from "lucide-react";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

export type ExplorerStatusBarProps = {
  /** Human: Instance branding shown as the leading label, matching the previous status line. */
  instanceName: string;
  folderCount: number;
  /** Human: Files currently rendered — may be fewer than totalFileCount while paging in. */
  loadedFileCount: number;
  totalFileCount: number;
  selectedCount: number;
  usedBytes: number;
  quotaBytes: number;
  /** Human: True during an explorer listing fetch — drives the spinner affordance. */
  loading?: boolean;
  /** Human: True while a name search is active; counts then describe matches, not the folder. */
  isSearching?: boolean;
  className?: string;
};

// Human: One status segment; segments are separated by hairline dividers rather than dots.
// Agent: RENDERS label span; hides overflow so long instance names cannot break the row.
function StatusSegment({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 shrink-0 items-center gap-1.5", className)}>
      {children}
    </span>
  );
}

function StatusDivider() {
  return <span className="h-3 w-px shrink-0 bg-edge" aria-hidden />;
}

/**
 * Human: Always-visible footer for the explorer. On desktop it sticks to the bottom of the
 * scroll pane; on mobile it sits above the bottom nav and yields to the bulk actions bar,
 * which already reports the selection.
 * Agent: READS counts + storage; RENDERS aria-live polite so screen readers hear count changes.
 */
export function ExplorerStatusBar({
  instanceName,
  folderCount,
  loadedFileCount,
  totalFileCount,
  selectedCount,
  usedBytes,
  quotaBytes,
  loading = false,
  isSearching = false,
  className,
}: ExplorerStatusBarProps) {
  const storagePercent =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const filesPartiallyLoaded = loadedFileCount < totalFileCount;

  return (
    <div
      className={cn(
        // Human: Fully opaque — a translucent footer lets file rows read through the counts.
        "sticky z-10 flex items-center gap-2.5 overflow-x-auto border-t border-edge bg-surface px-3 py-2 text-[11px] text-ink-muted",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // Human: Desktop pins to the scrollport floor; mobile clears the fixed bottom nav.
        "lg:bottom-0",
        "max-lg:bottom-[calc(5.25rem+env(safe-area-inset-bottom))] max-lg:rounded-lg max-lg:border",
        // Human: While selecting on mobile the bulk bar occupies this slot and reports the count.
        selectedCount > 0 && "max-lg:hidden",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label="Explorer status"
    >
      <StatusSegment className="text-ink-faint">
        <span className="truncate font-medium">{instanceName}</span>
      </StatusSegment>

      <StatusDivider />

      <StatusSegment>
        <span className="tabular-nums font-medium text-ink">{folderCount}</span>
        <span>{folderCount === 1 ? "folder" : "folders"}</span>
      </StatusSegment>

      <StatusDivider />

      <StatusSegment>
        <span className="tabular-nums font-medium text-ink">
          {filesPartiallyLoaded ? `${loadedFileCount} of ${totalFileCount}` : totalFileCount}
        </span>
        <span>
          {isSearching
            ? totalFileCount === 1
              ? "match"
              : "matches"
            : totalFileCount === 1
              ? "file"
              : "files"}
        </span>
      </StatusSegment>

      {selectedCount > 0 ? (
        <>
          <StatusDivider />
          <StatusSegment className="text-brand">
            <Check className="size-3 shrink-0" aria-hidden />
            <span className="tabular-nums font-semibold">{selectedCount}</span>
            <span className="font-medium">selected</span>
          </StatusSegment>
        </>
      ) : null}

      {/* Human: Storage summary keeps the sidebar quota visible while browsing deep folders. */}
      {/* Agent: READS usedBytes/quotaBytes; hidden on the narrowest screens to protect counts. */}
      <StatusDivider />
      <StatusSegment className="max-sm:hidden">
        <span className="tabular-nums font-medium text-ink">{formatBytes(usedBytes)}</span>
        <span>of</span>
        <span className="tabular-nums">{formatBytes(quotaBytes)}</span>
        <span
          className={cn(
            "ml-0.5 rounded px-1 py-px text-[10px] font-semibold tabular-nums",
            storagePercent >= 90
              ? "bg-danger-weak text-danger"
              : storagePercent >= 75
                ? "bg-warn-weak text-warn"
                : "bg-sunken text-ink-muted",
          )}
        >
          {storagePercent}%
        </span>
      </StatusSegment>

      {/* Human: Live fetch indicator — replaces the old "Loading more files…" paragraph. */}
      {/* Agent: READS loading; ml-auto pushes it to the trailing edge of the strip. */}
      <StatusSegment className="ml-auto pl-2">
        {loading ? (
          <>
            <Loader2 className="size-3 shrink-0 animate-spin text-brand" aria-hidden />
            <span className="font-medium text-brand">Loading…</span>
          </>
        ) : (
          <>
            <RefreshCw className="size-3 shrink-0 text-ok" aria-hidden />
            <span className="font-medium text-ok max-sm:hidden">Up to date</span>
          </>
        )}
      </StatusSegment>
    </div>
  );
}
