// Human: Skeleton placeholders for the mobile file list while folder listings load.
// Agent: RENDERS grouped row shimmers matching FileListView layout; USED by DriveCloudExplorer on max-lg.

import { cn } from "@/lib/utils";

type ExplorerListSkeletonProps = {
  /** Human: Number of placeholder rows — defaults to one screen of list items. */
  count?: number;
  className?: string;
};

// Human: Animated skeleton list matching FileListView row height during loading.
// Agent: role=status + aria-busy; RESPECTS prefers-reduced-motion via animate-pulse guard.
export function ExplorerListSkeleton({ count = 6, className }: ExplorerListSkeletonProps) {
  return (
    <div
      className={cn("flex flex-col gap-5 lg:hidden", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading files"
    >
      <ul className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        {Array.from({ length: count }, (_, index) => (
          <li
            key={index}
            className={cn(index > 0 && "border-t border-neutral-100", "flex items-center gap-3 px-3 py-3")}
          >
            <div className="size-11 shrink-0 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-2.5 w-2/5 animate-pulse rounded bg-muted/80 motion-reduce:animate-none" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
