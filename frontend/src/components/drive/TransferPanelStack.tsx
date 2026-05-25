// Human: Stacks upload and download transfer panels in the lower-right corner of the drive.
// Agent: FIXED positioning; UPLOADS above DOWNLOADS; shared minimize state per panel.

import { useEffect, useRef, useState } from "react";
import { DownloadTransferPanel } from "@/components/drive/DownloadTransferPanel";
import { UploadTransferPanel } from "@/components/drive/UploadTransferPanel";
import { subscribeDownloadJobs } from "@/lib/download-manager";
import { restoreUploadBatchFromStorage, subscribeUploadBatch } from "@/lib/upload-manager";

// Human: Anchor both non-blocking transfer trays so browsing continues during uploads/downloads.
// Agent: RENDERS UploadTransferPanel when batch active; RENDERS DownloadTransferPanel when jobs exist.
export function TransferPanelStack() {
  const [hasUploadBatch, setHasUploadBatch] = useState(false);
  const [hasDownloads, setHasDownloads] = useState(false);
  const [uploadMinimized, setUploadMinimized] = useState(false);
  const [downloadMinimized, setDownloadMinimized] = useState(false);
  const lastUploadBatchIdRef = useRef<string | null>(null);

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

  if (!hasUploadBatch && !hasDownloads) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,22rem)] flex-col gap-3"
      aria-live="polite"
    >
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
