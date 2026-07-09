// Human: Skeleton placeholders for the explorer grid while folder listings load.
// Agent: RENDERS shimmer tiles matching EXPLORER_GRID_LAYOUT_CLASS; USED by DriveCloudExplorer.

import { EXPLORER_GRID_LAYOUT_CLASS, EXPLORER_GRID_PREVIEW_SLOT_CLASS } from "@/components/drive/ExplorerGridPreviewSlot";
import { ExplorerThumbnailShimmer } from "@/components/drive/ExplorerThumbnailShimmer";
import { cn } from "@/lib/utils";

type ExplorerGridSkeletonProps = {
  /** Human: Number of placeholder tiles — defaults to one screen of mobile grid. */
  count?: number;
  className?: string;
};

// Human: Animated skeleton grid matching explorer tile layout during loading.
// Agent: role=status + aria-busy for screen readers; RESPECTS prefers-reduced-motion via shimmer component.
export function ExplorerGridSkeleton({ count = 8, className }: ExplorerGridSkeletonProps) {
  return (
    <div
      className={cn(EXPLORER_GRID_LAYOUT_CLASS, className)}
      role="status"
      aria-busy="true"
      aria-label="Loading files"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-1.5 lg:gap-2">
          <div className={cn(EXPLORER_GRID_PREVIEW_SLOT_CLASS, "overflow-hidden rounded-xl border border-border bg-muted/40")}>
            <ExplorerThumbnailShimmer label="Loading preview" />
          </div>
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/80 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
