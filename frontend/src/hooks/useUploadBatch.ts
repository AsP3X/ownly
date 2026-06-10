// Human: React hook for the floating upload transfer panel — mirrors upload-manager batch state.
// Agent: READS getUploadBatch via useSyncExternalStore; SUBSCRIBES subscribeUploadBatch on emitBatch.

import { useSyncExternalStore } from "react";
import {
  getUploadBatch,
  subscribeUploadBatch,
  type UploadBatchSnapshot,
} from "@/lib/upload-manager";

// Human: Live upload batch snapshot for transfer panels — null when no active or completed batch.
// Agent: useSyncExternalStore avoids useEffect lag so the tray renders on the first paint after queueing.
export function useUploadBatch(): UploadBatchSnapshot | null {
  return useSyncExternalStore(
    (onStoreChange) => subscribeUploadBatch(() => onStoreChange()),
    getUploadBatch,
    () => null,
  );
}
