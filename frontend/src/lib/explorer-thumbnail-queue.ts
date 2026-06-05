// Human: Cap concurrent explorer thumbnail decodes so scroll stays responsive in image-heavy folders.
// Agent: SERIALIZES fetch+resize work; MAX 3 parallel jobs; QUEUES overflow until a slot frees.

const MAX_CONCURRENT_THUMBNAIL_LOADS = 3;

let activeLoads = 0;
const pendingLoads: Array<() => void> = [];

function runNextQueuedThumbnailLoad() {
  if (activeLoads >= MAX_CONCURRENT_THUMBNAIL_LOADS) return;
  const next = pendingLoads.shift();
  if (!next) return;
  next();
}

// Human: Schedule thumbnail fetch/decode work without flooding the main thread during fast scroll.
// Agent: RETURNS promise from task; DECREMENTS activeLoads in finally; STARTS next queued task.
export function runExplorerThumbnailLoad<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const execute = () => {
      activeLoads += 1;
      void task()
        .then(resolve, reject)
        .finally(() => {
          activeLoads -= 1;
          runNextQueuedThumbnailLoad();
        });
    };

    if (activeLoads < MAX_CONCURRENT_THUMBNAIL_LOADS) {
      execute();
      return;
    }

    pendingLoads.push(execute);
  });
}
