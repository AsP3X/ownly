// Human: Stacks upload and download transfer panels in the lower-right corner of the drive.
// Agent: FIXED positioning; UPLOADS above DOWNLOADS; shared minimize state per panel.

import { useEffect, useRef, useState } from "react";
import { DownloadTransferPanel } from "@/components/drive/DownloadTransferPanel";
import { StorageMigrationTransferPanel } from "@/components/drive/StorageMigrationTransferPanel";
import { UploadTransferPanel } from "@/components/drive/UploadTransferPanel";
import { subscribeDownloadJobs } from "@/lib/download-manager";
import { subscribeStorageMigrationJob } from "@/lib/storage-migration-manager";
import { restoreUploadBatchFromStorage, subscribeUploadBatch } from "@/lib/upload-manager";

// Human: Anchor non-blocking transfer trays (migration, uploads, downloads) in the lower-right corner.
// Agent: RENDERS panels when respective managers report active jobs; FIXED bottom-right stack.
export function TransferPanelStack() {
  const [hasUploadBatch, setHasUploadBatch] = useState(false);
  const [hasDownloads, setHasDownloads] = useState(false);
  const [hasStorageMigration, setHasStorageMigration] = useState(false);
  const [uploadMinimized, setUploadMinimized] = useState(false);
  const [downloadMinimized, setDownloadMinimized] = useState(false);
  const [migrationMinimized, setMigrationMinimized] = useState(false);
  const lastUploadBatchIdRef = useRef<string | null>(null);
  const lastMigrationJobIdRef = useRef<string | null>(null);

  // Human: Reopen the upload tray after reload when server-side processing is still running.
  // Agent: CALLS restoreUploadBatchFromStorage once on mount; READS localStorage + /jobs fallback.
  useEffect(() => {
    void restoreUploadBatchFromStorage();
  }, []);

  useEffect(
    () =>
      subscribeUploadBatch((batch) => {
        setHasUploadBatch(batch !== null);
        if (batch && batch.id !== lastUploadBatchIdRef.current) {
          lastUploadBatchIdRef.current = batch.id;
          setUploadMinimized(false);
        }
        if (!batch) {
          lastUploadBatchIdRef.current = null;
        }
      }),
    [],
  );

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
        setHasStorageMigration(job !== null);
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
      className="pointer-events-none fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex w-[min(100vw-2rem,22.5rem)] flex-col gap-3 lg:bottom-4"
      aria-live="polite"
    >
      {hasStorageMigration ? (
        <StorageMigrationTransferPanel
          minimized={migrationMinimized}
          onMinimizedChange={setMigrationMinimized}
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
