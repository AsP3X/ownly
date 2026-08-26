// Human: Stacks upload and download transfer panels in the lower-right corner of the drive.
// Agent: FIXED positioning; UPLOADS above DOWNLOADS; shared minimize state per panel.

import { useEffect, useRef, useState } from "react";
import { DownloadTransferPanel } from "@/components/drive/DownloadTransferPanel";
import { StorageMigrationTransferPanel } from "@/components/drive/StorageMigrationTransferPanel";
import { cn } from "@/lib/utils";
import { UploadTransferPanel } from "@/components/drive/UploadTransferPanel";
import { useUploadBatch } from "@/hooks/useUploadBatch";
import { subscribeDownloadJobs } from "@/lib/download-manager";
import {
  openStorageMigrationLogDialog,
  subscribeStorageMigrationJob,
} from "@/lib/storage-migration-manager";
import { restoreUploadBatchFromStorage } from "@/lib/upload-manager";

// Human: Anchor non-blocking transfer trays (migration, uploads, downloads) in the lower-right corner.
// Agent: RENDERS panels when respective managers report active jobs; FIXED bottom-right stack.
export function TransferPanelStack() {
  const uploadBatch = useUploadBatch();
  const hasUploadBatch = uploadBatch !== null;
  const [hasDownloads, setHasDownloads] = useState(false);
  const [hasStorageMigration, setHasStorageMigration] = useState(false);
  const [uploadMinimized, setUploadMinimized] = useState(false);
  const [downloadMinimized, setDownloadMinimized] = useState(false);
  const [migrationMinimized, setMigrationMinimized] = useState(false);
  const lastUploadBatchIdRef = useRef<string | null>(null);
  const lastUploadItemCountRef = useRef(0);
  const lastMigrationJobIdRef = useRef<string | null>(null);

  // Human: Reopen the upload tray after reload when server-side processing is still running.
  // Agent: CALLS restoreUploadBatchFromStorage once on mount; READS localStorage + /jobs fallback.
  useEffect(() => {
    void restoreUploadBatchFromStorage();
  }, []);

  // Human: Expand the upload tray when a new batch starts or more files join an in-flight batch.
  // Agent: COMPARES batch id + item count; WRITES uploadMinimized false so appended uploads stay visible.
  useEffect(() => {
    if (!uploadBatch) {
      lastUploadBatchIdRef.current = null;
      lastUploadItemCountRef.current = 0;
      return;
    }

    const isNewBatch = uploadBatch.id !== lastUploadBatchIdRef.current;
    const hasMoreItems = uploadBatch.items.length > lastUploadItemCountRef.current;
    if (isNewBatch || hasMoreItems) {
      setUploadMinimized(false);
    }

    lastUploadBatchIdRef.current = uploadBatch.id;
    lastUploadItemCountRef.current = uploadBatch.items.length;
  }, [uploadBatch]);

  useEffect(
    () =>
      subscribeDownloadJobs((jobs) => {
        setHasDownloads(jobs.length > 0);
      }),
    [],
  );

  useEffect(
    () =>
      subscribeStorageMigrationJob((job) => {
        setHasStorageMigration(job?.status === "running");
        if (job && job.id !== lastMigrationJobIdRef.current) {
          lastMigrationJobIdRef.current = job.id;
          setMigrationMinimized(false);
        }
        if (!job) {
          lastMigrationJobIdRef.current = null;
        }
      }),
    [],
  );

  if (!hasUploadBatch && !hasDownloads && !hasStorageMigration) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed right-4 z-50 flex w-[min(100vw-2rem,22.5rem)] flex-col gap-3 transition-[gap] duration-300",
        "bottom-[calc(7.5rem+env(safe-area-inset-bottom))] lg:bottom-4",
        // Human: Two or three stacked panels could add up to more than the screen, pushing the
        // top one off-view with no way to reach its controls. Bound the stack and let it scroll.
        // Agent: pointer-events-auto is set per panel, so the scroll container needs it too.
        "max-h-[calc(100dvh-9rem)] overflow-y-auto overscroll-contain lg:max-h-[calc(100dvh-2rem)]",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        (hasStorageMigration ? 1 : 0) + (hasUploadBatch ? 1 : 0) + (hasDownloads ? 1 : 0) > 1 &&
          "pointer-events-auto",
      )}
      aria-live="polite"
    >
      {hasStorageMigration ? (
        <StorageMigrationTransferPanel
          minimized={migrationMinimized}
          onMinimizedChange={setMigrationMinimized}
          onViewLog={() => openStorageMigrationLogDialog()}
        />
      ) : null}
      {hasUploadBatch ? (
        <UploadTransferPanel
          minimized={uploadMinimized}
          onMinimizedChange={setUploadMinimized}
        />
      ) : null}
      {hasDownloads ? (
        <DownloadTransferPanel
          minimized={downloadMinimized}
          onMinimizedChange={setDownloadMinimized}
        />
      ) : null}
    </div>
  );
}
