// Human: In-memory download job registry with a bounded worker pool and queued state.
// Agent: STORES active jobs; EMITS subscribe updates; RUNS up to MAX concurrent downloads; QUEUES the rest.

import {
  abortActiveDownload,
  cancelBulkDownloadJob,
  cancelFolderDownloadJob,
  downloadBulkFiles,
  downloadFileItem,
  downloadFolderItem,
  getErrorMessage,
  type DownloadMethod,
  type DownloadProgressUpdate,
  type FileItem,
  type FolderItem,
} from "@/api/client";

export type DownloadJobStatus = "queued" | "downloading" | "complete" | "error";
export type DownloadJobKind = "file" | "folder" | "bulk";

export type DownloadJob = {
  id: string;
  kind: DownloadJobKind;
  label: string;
  sizeBytes: number;
  file?: FileItem;
  folder?: FolderItem;
  bulkFiles?: FileItem[];
  bulkJobId?: string;
  progress: number;
  phase: DownloadProgressUpdate["phase"];
  indeterminate: boolean;
  status: DownloadJobStatus;
  method: DownloadMethod | null;
  error?: string;
};

type Listener = (jobs: DownloadJob[]) => void;

// Human: Limit parallel browser downloads so zip prep and byte transfers do not pile up.
// Agent: MATCHES upload dialog pattern; WORKERS claim queued rows synchronously.
const MAX_CONCURRENT_DOWNLOADS = 2;

let jobs: DownloadJob[] = [];
const listeners = new Set<Listener>();
let activeWorkers = 0;
let activeJobId: string | null = null;

function emit() {
  const snapshot = [...jobs];
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function updateJob(id: string, patch: Partial<DownloadJob>) {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
  emit();
}

// Human: Subscribe to download queue changes from React components.
// Agent: CALLS listener immediately; RETURNS unsubscribe function.
export function subscribeDownloadJobs(listener: Listener) {
  listeners.add(listener);
  listener([...jobs]);
  return () => {
    listeners.delete(listener);
  };
}

// Human: Read current jobs without subscribing (e.g. initial render).
export function getDownloadJobs(): DownloadJob[] {
  return [...jobs];
}

// Human: Remove finished jobs from the panel after the user dismisses them.
export function dismissDownloadJob(id: string) {
  jobs = jobs.filter((job) => job.id !== id);
  emit();
}

// Human: Cancel one active or queued download and drop it from the queue.
export function cancelDownloadJob(id: string) {
  const job = jobs.find((item) => item.id === id);
  if (job?.status === "downloading") {
    if (job.kind === "folder" && job.folder) {
      void cancelFolderDownloadJob(job.folder.id);
    } else if (job.kind === "bulk" && job.bulkJobId) {
      void cancelBulkDownloadJob(job.bulkJobId);
    }
    if (activeJobId === id) {
      abortActiveDownload();
      activeJobId = null;
    }
  }
  jobs = jobs.filter((item) => item.id !== id);
  emit();
  pumpDownloadQueue();
}

// Human: Claim the next queued row synchronously so parallel workers never double-start a job.
// Agent: READS/WRITES jobs array; RETURNS claimed job or null when queue is empty.
function claimNextQueued(): DownloadJob | null {
  const index = jobs.findIndex((item) => item.status === "queued");
  if (index === -1) return null;

  const claimed = { ...jobs[index], status: "downloading" as const };
  jobs = jobs.map((job, i) => (i === index ? claimed : job));
  emit();
  return claimed;
}

// Human: Start queued downloads until the concurrency cap is reached.
// Agent: INCREMENTS activeWorkers; CALLS runDownloadJob for each claimed row.
function pumpDownloadQueue() {
  while (activeWorkers < MAX_CONCURRENT_DOWNLOADS) {
    const next = claimNextQueued();
    if (!next) break;

    activeWorkers += 1;
    void runDownloadJob(next).finally(() => {
      activeWorkers -= 1;
      if (activeJobId === next.id) {
        activeJobId = null;
      }
      pumpDownloadQueue();
    });
  }
}

// Human: Execute one claimed download — file, bulk zip, or folder zip.
// Agent: CALLS api client helpers; UPDATES job row; HANDLES cancel/errors.
async function runDownloadJob(job: DownloadJob) {
  activeJobId = job.id;

  try {
    if (job.kind === "file" && job.file) {
      const result = await downloadFileItem(job.file, (update) => {
        updateJob(job.id, {
          progress: update.percent,
          phase: update.phase,
          indeterminate: update.indeterminate ?? false,
        });
      });
      updateJob(job.id, {
        progress: 100,
        phase: "saving",
        indeterminate: false,
        status: "complete",
        method: result.method,
      });
      return;
    }

    if (job.kind === "bulk" && job.bulkFiles) {
      const result = await downloadBulkFiles(
        job.bulkFiles,
        (update) => {
          updateJob(job.id, {
            progress: update.percent,
            phase: update.phase,
            indeterminate: update.indeterminate ?? false,
            ...(update.archiveName ? { label: update.archiveName } : {}),
          });
        },
        (jobId) => {
          updateJob(job.id, { bulkJobId: jobId });
        },
      );
      updateJob(job.id, {
        label: result.archiveName,
        progress: 100,
        phase: "saving",
        indeterminate: false,
        status: "complete",
        method: result.method,
      });
      return;
    }

    if (job.kind === "folder" && job.folder) {
      const result = await downloadFolderItem(job.folder, (update) => {
        updateJob(job.id, {
          progress: update.percent,
          phase: update.phase,
          indeterminate: update.indeterminate ?? false,
          ...(update.archiveName ? { label: update.archiveName } : {}),
        });
      });
      updateJob(job.id, {
        label: result.archiveName,
        progress: 100,
        phase: "saving",
        indeterminate: false,
        status: "complete",
        method: result.method,
      });
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes("cancelled")) {
      jobs = jobs.filter((item) => item.id !== job.id);
      emit();
      return;
    }
    updateJob(job.id, {
      status: "error",
      error: message,
      indeterminate: false,
    });
  }
}

function enqueueJobRow(row: DownloadJob) {
  jobs = [...jobs, row];
  emit();
  pumpDownloadQueue();
}

// Human: Queue a background file download — returns immediately; progress via subscribe.
// Agent: ADDS queued row; PUMPS worker pool; DOES NOT block the drive UI.
export function enqueueDownload(file: FileItem) {
  const id = crypto.randomUUID();
  enqueueJobRow({
    id,
    kind: "file",
    label: file.name,
    sizeBytes: file.size_bytes,
    file,
    progress: 0,
    phase: "downloading",
    indeterminate: false,
    status: "queued",
    method: null,
  });
  return id;
}

// Human: Queue a background zip download for multiple selected files.
// Agent: ADDS queued row; RUNS bulk runner when claimed; SHOWS compressing in tray.
export function enqueueBulkDownload(files: FileItem[]) {
  const id = crypto.randomUUID();
  const label = `${files.length} files`;
  enqueueJobRow({
    id,
    kind: "bulk",
    label,
    sizeBytes: files.reduce((total, file) => total + file.size_bytes, 0),
    bulkFiles: files,
    progress: 0,
    phase: "processing",
    indeterminate: true,
    status: "queued",
    method: null,
  });
  return id;
}

// Human: Queue a background folder zip download with server-side max compression.
// Agent: ADDS queued row; CALLS downloadFolderItem when worker claims the job.
export function enqueueFolderDownload(folder: FolderItem) {
  const id = crypto.randomUUID();
  enqueueJobRow({
    id,
    kind: "folder",
    label: folder.name,
    sizeBytes: 0,
    folder,
    progress: 0,
    phase: "processing",
    indeterminate: true,
    status: "queued",
    method: null,
  });
  return id;
}
