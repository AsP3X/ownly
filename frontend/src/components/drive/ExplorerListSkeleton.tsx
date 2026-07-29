// Human: Skeleton placeholders for the explorer list layout while folder listings load.
// Agent: RENDERS row shimmers matching FileListView row height; USED by DriveCloudExplorer in list view.

import { cn } from "@/lib/utils";

type ExplorerListSkeletonProps = {
  /** Human: Number of placeholder rows — defaults to one screen of list items. */
  count?: number;
  className?: string;
};

// Human: Animated skeleton rows matching the list layout during loading.
// Agent: role=status + aria-busy; RESPECTS prefers-reduced-motion via animate-pulse guard.
export function ExplorerListSkeleton({ count = 10, className }: ExplorerListSkeletonProps) {
  return (
    <div
      className={cn("flex flex-col", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading files"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-hairline px-2 py-2.5"
        >
          <div className="size-4 shrink-0 animate-pulse rounded bg-sunken motion-reduce:animate-none" />
          <div className="h-3.5 flex-1 animate-pulse rounded bg-sunken motion-reduce:animate-none" />
          <div className="hidden h-3 w-16 animate-pulse rounded bg-sunken motion-reduce:animate-none lg:block" />
          <div className="hidden h-3 w-20 animate-pulse rounded bg-sunken motion-reduce:animate-none lg:block" />
          <div className="hidden h-3 w-24 animate-pulse rounded bg-sunken motion-reduce:animate-none lg:block" />
        </div>
      ))}
    </div>
  );
}
