// Human: Global storage migration overlays — result summary dialog and full log viewer.
// Agent: SUBSCRIBES storage-migration-manager; MOUNTS from App shell for admin + drive routes.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ScrollText } from "lucide-react";
import {
  fetchStorageMigrationLogs,
  type StorageMigrationLogEntry,
} from "@/api/client";
import { LogDialog, type LogDialogEntry } from "@/components/ui/LogDialog";
import {
  closeStorageMigrationResultDialog,
  dismissStorageMigrationJob,
  openStorageMigrationLogDialog,
  restoreStorageMigrationFromServer,
  subscribeStorageMigrationJob,
  subscribeStorageMigrationLogDialog,
  subscribeStorageMigrationResultDialog,
  type StorageMigrationJob,
} from "@/lib/storage-migration-manager";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function formatTimestamp(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function mapLogEntry(entry: StorageMigrationLogEntry): LogDialogEntry {
  const meta = [entry.node_id, entry.object_key].filter(Boolean).join(" · ");
  return {
    id: String(entry.id),
    timestamp: formatTimestamp(entry.created_at),
    level: entry.level,
    message: entry.message,
    meta: meta || undefined,
  };
}

function resultTitle(job: StorageMigrationJob) {
  if (job.kind === "preview") {
    if (job.status === "complete") return "Preview complete";
    if (job.status === "error") return "Preview failed";
    return "Preview stopped";
  }
  if (job.status === "complete") return "Migration complete";
  if (job.status === "error") return "Migration finished with errors";
  return "Migration stopped";
}

// Human: Modal summary after a terminal preview or migrate run.
// Agent: SHOWS totals and failures; OFFERS View log + Dismiss actions.
function StorageMigrationResultDialog({
  job,
  open,
  onOpenChange,
  onViewLog,
}: {
  job: StorageMigrationJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewLog: () => void;
}) {
  const success = job.status === "complete";
  const isPreview = job.kind === "preview";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-neutral-200 bg-white p-0 sm:max-w-md">
        <DialogHeader className="border-b border-neutral-100 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg text-neutral-900">
            {success ? (
              <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-hidden />
            ) : (
              <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
            )}
            {resultTitle(job)}
          </DialogTitle>
          <DialogDescription className="text-neutral-500">
            {isPreview
              ? "Legacy object storage preview finished. Review the totals below before starting migration."
              : "Legacy object storage migration finished. Review the totals below."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 py-5 text-sm text-neutral-800">
          {isPreview ? (
            <p>
              <span className="font-semibold">{job.migrated}</span> object(s) need migration.
            </p>
          ) : job.status === "complete" ? (
            <p>
              <span className="font-semibold">{job.migrated}</span>
              {job.totalTarget ? ` of ${job.totalTarget}` : ""} object(s) migrated successfully.
            </p>
          ) : (
            <p>
              <span className="font-semibold">{job.migrated}</span>
              {job.totalTarget ? ` of ${job.totalTarget}` : ""} object(s) migrated before stop.
            </p>
          )}
          <p>
            {job.skipped} skipped · {job.scanned} scanned
            {job.failed > 0 ? ` · ${job.failed} failed` : ""}
          </p>
          {job.failed > 0 && !isPreview ? (
            <p className="text-amber-800">
              {job.failed} object(s) failed — open the log for per-object details.
            </p>
          ) : null}
          {job.error ? <p className="text-red-700">{job.error}</p> : null}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-6 py-4">
          <Button type="button" variant="outline" onClick={onViewLog}>
            <ScrollText className="size-4" aria-hidden />
            View log
          </Button>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              void dismissStorageMigrationJob();
            }}
          >
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Human: Hosts migration result + log dialogs outside the transfer tray stack.
// Agent: RESTORES via manager on mount; LOADS paginated logs for active run id.
export function StorageMigrationUi() {
  const [job, setJob] = useState<StorageMigrationJob | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<LogDialogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logLoadingMore, setLogLoadingMore] = useState(false);
  const [logHasMore, setLogHasMore] = useState(false);
  const [logCursor, setLogCursor] = useState<number | null>(null);

  const loadLogs = useCallback(
    async (runId: string, after?: number, append = false) => {
      if (append) {
        setLogLoadingMore(true);
      } else {
        setLogLoading(true);
      }
      try {
        const response = await fetchStorageMigrationLogs(runId, {
          after,
          limit: 200,
        });
        const mapped = response.entries.map(mapLogEntry);
        setLogEntries((prev) => (append ? [...prev, ...mapped] : mapped));
        setLogHasMore(response.has_more);
        setLogCursor(response.next_after);
      } finally {
        setLogLoading(false);
        setLogLoadingMore(false);
      }
    },
    [],
  );

  // Human: Restore server migration state on any route — preview and migrate share the same overlays.
  // Agent: CALLS restoreStorageMigrationFromServer once; OPENS result dialog for terminal migrate runs.
  useEffect(() => {
    void restoreStorageMigrationFromServer();
  }, []);

  useEffect(() => subscribeStorageMigrationJob(setJob), []);
  useEffect(
    () =>
      subscribeStorageMigrationResultDialog((open) => {
        setResultOpen(open);
      }),
    [],
  );
  useEffect(() => subscribeStorageMigrationLogDialog(setLogOpen), []);

  useEffect(() => {
    if (!logOpen || !job) return;
    setLogEntries([]);
    setLogCursor(null);
    void loadLogs(job.id);
  }, [logOpen, job, loadLogs]);

  function openLogDialog() {
    openStorageMigrationLogDialog();
  }

  function handleResultOpenChange(open: boolean) {
    setResultOpen(open);
    if (!open) {
      closeStorageMigrationResultDialog();
    }
  }

  const terminalJob =
    job && (job.status === "complete" || job.status === "error" || job.status === "cancelled")
      ? job
      : null;

  return (
    <>
      {terminalJob ? (
        <StorageMigrationResultDialog
          job={terminalJob}
          open={resultOpen}
          onOpenChange={handleResultOpenChange}
          onViewLog={openLogDialog}
        />
      ) : null}

      <LogDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        title={job?.kind === "preview" ? "Storage migration preview log" : "Storage migration log"}
        description={
          job
            ? `Run ${job.id.slice(0, 8)}… · ${job.migrated} migrated · ${job.failed} failed`
            : undefined
        }
        entries={logEntries}
        loading={logLoading}
        loadingMore={logLoadingMore}
        hasMore={logHasMore}
        onLoadMore={
          job && logHasMore && logCursor != null
            ? () => void loadLogs(job.id, logCursor, true)
            : undefined
        }
      />
    </>
  );
}
