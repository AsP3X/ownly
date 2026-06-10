// Human: Stable upload batch snapshot pointer for useSyncExternalStore consumers.
// Agent: WRITES publishUploadBatchSnapshot from emitBatch; READS readUploadBatchSnapshot in getUploadBatch.

import type { UploadBatchSnapshot } from "@/lib/upload-manager";

let cachedBatchSnapshot: UploadBatchSnapshot | null = null;

// Human: Replace the cached snapshot when the in-memory batch changes.
// Agent: CALLED only from upload-manager emitBatch; PREVENTS React #185 update loops.
export function publishUploadBatchSnapshot(snapshot: UploadBatchSnapshot | null): void {
  cachedBatchSnapshot = snapshot;
}

// Human: Current batch snapshot for useSyncExternalStore getSnapshot.
// Agent: RETURNS stable reference until publishUploadBatchSnapshot runs again.
export function readUploadBatchSnapshot(): UploadBatchSnapshot | null {
  return cachedBatchSnapshot;
}
