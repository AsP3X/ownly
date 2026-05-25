// Human: In-memory download job registry for non-blocking background transfers.
// Agent: STORES active jobs; EMITS subscribe updates; START/CANCEL download jobs from DrivePage.

import {
  abortActiveDownload,
  downloadFileItem,
  getErrorMessage,
  type DownloadMethod,
  type DownloadProgressUpdate,
  type FileItem,
} from "@/api/client";

export type DownloadJobStatus = "downloading" | "complete" | "error";

export type DownloadJob = {
  id: string;
  file: FileItem;
  progress: number;
  phase: DownloadProgressUpdate["phase"];
  indeterminate: boolean;
  status: DownloadJobStatus;
  method: DownloadMethod | null;
  error?: string;
};

type Listener = (jobs: DownloadJob[]) => void;

let jobs: DownloadJob[] = [];
const listeners = new Set<Listener>();

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

// Human: Cancel one active download and drop it from the queue.
export function cancelDownloadJob(id: string) {
  const job = jobs.find((item) => item.id === id);
  if (job?.status === "downloading") {
    abortActiveDownload();
  }
  jobs = jobs.filter((item) => item.id !== id);
  emit();
}

// Human: Start a background download — returns immediately; progress via subscribe.
// Agent: CALLS downloadFileItem; UPDATES job row; DOES NOT block the drive UI.
export function enqueueDownload(file: FileItem) {
  const id = crypto.randomUUID();
  jobs = [
    ...jobs,
    {
      id,
      file,
      progress: 0,
      phase: "downloading",
      indeterminate: false,
      status: "downloading",
      method: null,
    },
  ];
  emit();

  void downloadFileItem(file, (update) => {
    updateJob(id, {
      progress: update.percent,
      phase: update.phase,
      indeterminate: update.indeterminate ?? false,
    });
  })
    .then((result) => {
      updateJob(id, {
        progress: 100,
        phase: "saving",
        indeterminate: false,
        status: "complete",
        method: result.method,
      });
    })
    .catch((error) => {
      const message = getErrorMessage(error);
      if (message.includes("cancelled")) {
        jobs = jobs.filter((item) => item.id !== id);
        emit();
        return;
      }
      updateJob(id, {
        status: "error",
        error: message,
        indeterminate: false,
      });
    });

  return id;
}
