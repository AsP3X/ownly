// Human: Priority thumbnail load queue — visible tiles first, stale jobs cancelled on scroll-away.
// Agent: MAX 4 concurrent jobs; SORT high before low; ABORT via per-file AbortController map.

export type ExplorerThumbnailPriority = "high" | "low";

// Human: Allow more parallel warm-cache fetches while visible tiles still sort ahead via priority.
// Agent: RAISED from 4; HIGH jobs dequeue before LOW prefetch work.
const MAX_CONCURRENT_THUMBNAIL_LOADS = 6;

type QueueJob<T> = {
  fileId: string;
  priority: ExplorerThumbnailPriority;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

let activeLoads = 0;
const pendingJobs: Array<QueueJob<unknown>> = [];
const activeControllers = new Map<string, AbortController>();

function jobPriorityValue(priority: ExplorerThumbnailPriority) {
  return priority === "high" ? 0 : 1;
}

function sortPendingJobs() {
  pendingJobs.sort(
    (left, right) => jobPriorityValue(left.priority) - jobPriorityValue(right.priority),
  );
}

function runNextQueuedThumbnailLoad() {
  while (activeLoads < MAX_CONCURRENT_THUMBNAIL_LOADS && pendingJobs.length > 0) {
    const nextIndex = pendingJobs.findIndex((job) => !job.controller.signal.aborted);
    if (nextIndex < 0) {
      pendingJobs.length = 0;
      return;
    }

    const [job] = pendingJobs.splice(nextIndex, 1);
    activeLoads += 1;
    activeControllers.set(job.fileId, job.controller);

    void job
      .run(job.controller.signal)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeLoads -= 1;
        if (activeControllers.get(job.fileId) === job.controller) {
          activeControllers.delete(job.fileId);
        }
        runNextQueuedThumbnailLoad();
      });
  }
}

// Human: Cancel queued and in-flight thumbnail work for a file that left the viewport.
// Agent: ABORTS AbortController; REMOVES pending queue entries matching fileId.
export function cancelExplorerThumbnailLoad(fileId: string) {
  const active = activeControllers.get(fileId);
  if (active) {
    active.abort();
    activeControllers.delete(fileId);
  }

  for (let index = pendingJobs.length - 1; index >= 0; index -= 1) {
    if (pendingJobs[index]?.fileId === fileId) {
      pendingJobs[index]?.controller.abort();
      pendingJobs.splice(index, 1);
    }
  }
}

// Human: Schedule thumbnail fetch/decode with priority and cooperative cancellation.
// Agent: LINKS parent AbortSignal; DEDUPES by aborting prior active job for same fileId.
export function runExplorerThumbnailLoad<T>(options: {
  fileId: string;
  priority: ExplorerThumbnailPriority;
  parentSignal?: AbortSignal;
  task: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  if (options.parentSignal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  cancelExplorerThumbnailLoad(options.fileId);

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();

    const abortFromParent = () => {
      controller.abort();
      cancelExplorerThumbnailLoad(options.fileId);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (options.parentSignal) {
      options.parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }

    const job: QueueJob<T> = {
      fileId: options.fileId,
      priority: options.priority,
      controller,
      run: options.task,
      resolve: (value) => {
        if (options.parentSignal) {
          options.parentSignal.removeEventListener("abort", abortFromParent);
        }
        resolve(value);
      },
      reject: (error) => {
        if (options.parentSignal) {
          options.parentSignal.removeEventListener("abort", abortFromParent);
        }
        reject(error);
      },
    };

    pendingJobs.push(job as QueueJob<unknown>);
    sortPendingJobs();
    runNextQueuedThumbnailLoad();
  });
}
