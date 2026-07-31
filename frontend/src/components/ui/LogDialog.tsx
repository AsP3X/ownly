// Human: Reusable scrollable log viewer dialog — paginated entries with level styling.
// Agent: RENDERS Dialog shell; CALLS onLoadMore for cursor pagination; USED by admin maintenance flows.

import { useEffect, useRef } from "react";
import { Loader2, ScrollText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LogDialogEntry = {
  id: string;
  timestamp?: string;
  level?: "info" | "warn" | "error";
  message: string;
  meta?: string;
};

type LogDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  entries: LogDialogEntry[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
};

function levelClass(level?: LogDialogEntry["level"]) {
  if (level === "error") return "text-danger";
  if (level === "warn") return "text-warn";
  return "text-ink-muted";
}

// Human: Generic operator log modal — supports infinite scroll via onLoadMore at the list bottom.
// Agent: READS entries prop; RENDERS monospace lines; SCROLL container with max height.
export function LogDialog({
  open,
  onOpenChange,
  title,
  description,
  entries,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  emptyMessage = "No log entries yet.",
}: LogDialogProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Human: When the user scrolls near the bottom, fetch the next log page.
  // Agent: CALLS onLoadMore when hasMore and not already loadingMore.
  useEffect(() => {
    const element = listRef.current;
    if (!open || !element || !hasMore || !onLoadMore) return;

    function handleScroll() {
      if (!element || loadingMore) return;
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining < 96) {
        onLoadMore?.();
      }
    }

    element.addEventListener("scroll", handleScroll);
    return () => element.removeEventListener("scroll", handleScroll);
  }, [open, hasMore, loadingMore, onLoadMore]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border border-edge bg-panel p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-hairline px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg text-ink">
            <ScrollText className="size-5 shrink-0 text-ink-muted" aria-hidden />
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-ink-muted">{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <div
          ref={listRef}
          className="max-h-[min(70vh,28rem)] overflow-y-auto px-6 py-4"
          aria-live="polite"
          aria-busy={loading || loadingMore}
        >
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading log…
            </div>
          ) : null}

          {!loading && entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">{emptyMessage}</p>
          ) : null}

          <ul className="space-y-2 font-mono text-xs">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-md border border-hairline bg-surface px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {entry.timestamp ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
                      {entry.timestamp}
                    </span>
                  ) : null}
                  {entry.level ? (
                    <span
                      className={cn(
                        "shrink-0 text-[10px] font-semibold uppercase tracking-wide",
                        levelClass(entry.level),
                      )}
                    >
                      {entry.level}
                    </span>
                  ) : null}
                  <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-all", levelClass(entry.level))}>
                    {entry.message}
                  </span>
                </div>
                {entry.meta ? (
                  <p className="mt-1 text-[10px] text-ink-muted">{entry.meta}</p>
                ) : null}
              </li>
            ))}
          </ul>

          {loadingMore ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-ink-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading more…
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-hairline bg-surface/80 px-6 py-4">
          {hasMore && onLoadMore ? (
            <Button type="button" variant="outline" onClick={() => onLoadMore()} disabled={loadingMore}>
              Load more
            </Button>
          ) : null}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
