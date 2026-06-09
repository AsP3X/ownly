// Human: Background legacy blob migration job — batches API calls and emits progress for the transfer tray.
// Agent: LOOPS migrateStorageBlobs until truncated=false or cancel; SUBSCRIBE pattern matches download-manager.

import {
  getErrorMessage,
  migrateStorageBlobs,
  type MigrateStorageBlobsResponse,
} from "@/api/client";
import { createClientId } from "@/lib/utils-app";

export type StorageMigrationJobStatus = "running" | "complete" | "error" | "cancelled";

export type StorageMigrationJob = {
  id: string;
  status: StorageMigrationJobStatus;
  dryRun: boolean;
  nodeId?: string;
  prefix?: string;
  /** Human: When true the manager auto-fetches subsequent pages (single-node migrations). */
  autoContinue: boolean;
  batchNumber: number;
  migrated: number;
  skipped: number;
  failed: number;
  scanned: number;
  /** Human: True while waiting on the current HTTP batch request. */
  waitingOnBatch: boolean;
  error?: string;
  lastNodeSummaries: string[];
};

type Listener = (job: StorageMigrationJob | null) => void;

const BATCH_LIMIT = 25;

let activeJob: StorageMigrationJob | null = null;
let cancelRequested = false;
let runToken = 0;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = activeJob ? { ...activeJob } : null;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function patchJob(patch: Partial<StorageMigrationJob>) {
  if (!activeJob) return;
  activeJob = { ...activeJob, ...patch };
  emit();
}

// Human: Subscribe to the active storage migration job (null when dismissed).
// Agent: CALLS listener immediately; RETURNS unsubscribe.
export function subscribeStorageMigrationJob(listener: Listener) {
  listeners.add(listener);
  listener(activeJob ? { ...activeJob } : null);
  return () => {
    listeners.delete(listener);
  };
}

// Human: Clear the finished migration card from the transfer stack.
// Agent: SETS activeJob null; NO-OP while status running.
export function dismissStorageMigrationJob() {
  if (activeJob?.status === "running") return;
  activeJob = null;
  emit();
}

// Human: Stop after the in-flight batch completes — does not abort the HTTP request.
// Agent: SETS cancelRequested; LOOP exits before next migrateStorageBlobs call.
export function cancelStorageMigrationJob() {
  if (!activeJob || activeJob.status !== "running") return;
  cancelRequested = true;
}

function summarizeNodes(result: MigrateStorageBlobsResponse, dryRun: boolean): string[] {
  return result.nodes.map((node) => {
    const verb = dryRun ? "would migrate" : "migrated";
    return `${node.node_id}: ${verb} ${node.migrated}, skipped ${node.skipped}, failed ${node.failed}`;
  });
}

function accumulate(
  job: StorageMigrationJob,
  result: MigrateStorageBlobsResponse,
): StorageMigrationJob {
  let migrated = job.migrated;
  let skipped = job.skipped;
  let failed = job.failed;
  let scanned = job.scanned;
  for (const node of result.nodes) {
    migrated += node.migrated;
    skipped += node.skipped;
    failed += node.failed;
    scanned += node.scanned;
  }
  return {
    ...job,
    migrated,
    skipped,
    failed,
    scanned,
    lastNodeSummaries: summarizeNodes(result, job.dryRun),
  };
}

function resolveCursor(
  result: MigrateStorageBlobsResponse,
  nodeId: string | undefined,
  autoContinue: boolean,
): string | undefined {
  if (!autoContinue) return undefined;
  const node = result.nodes[0];
  if (!node?.is_truncated) return undefined;
  return node.next_start_after ?? undefined;
}

// Human: Start legacy blob migration — shows progress in StorageMigrationTransferPanel.
// Agent: CREATES job; RUNS batched POST /admin/maintenance/migrate-storage-blobs until done or cancel.
export function startStorageMigration(options: {
  nodeId?: string;
  prefix?: string;
  dryRun?: boolean;
  autoContinue: boolean;
}) {
  if (activeJob?.status === "running") {
    return;
  }

  const token = ++runToken;
  cancelRequested = false;

  activeJob = {
    id: createClientId(),
    status: "running",
    dryRun: options.dryRun ?? false,
    nodeId: options.nodeId,
    prefix: options.prefix,
    autoContinue: options.autoContinue,
    batchNumber: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    scanned: 0,
    waitingOnBatch: true,
    lastNodeSummaries: [],
  };
  emit();

  void (async () => {
    let cursor: string | undefined;
    try {
      while (!cancelRequested && token === runToken) {
        patchJob({ waitingOnBatch: true, batchNumber: (activeJob?.batchNumber ?? 0) + 1 });

        const result = await migrateStorageBlobs({
          node_id: options.nodeId,
          prefix: options.prefix,
          limit: BATCH_LIMIT,
          start_after: cursor,
          dry_run: options.dryRun ?? false,
        });

        if (token !== runToken || !activeJob) {
          return;
        }

        if (cancelRequested) {
          patchJob({ status: "cancelled", waitingOnBatch: false });
          return;
        }

        const updated = accumulate(activeJob, result);
        activeJob = {
          ...updated,
          waitingOnBatch: false,
        };
        emit();

        const truncated = result.nodes.some((node) => node.is_truncated);
        const hasFailures = result.nodes.some((node) => node.failed > 0);

        if (options.dryRun || !options.autoContinue || !truncated) {
          patchJob({
            status: hasFailures && !options.dryRun ? "error" : "complete",
            waitingOnBatch: false,
            error:
              hasFailures && !options.dryRun
                ? "One or more objects failed to migrate. Check audit logs for details."
                : undefined,
          });
          return;
        }

        cursor = resolveCursor(result, options.nodeId, options.autoContinue);
        if (!cursor) {
          patchJob({ status: "complete", waitingOnBatch: false });
          return;
        }
      }
    } catch (error) {
      if (token !== runToken) return;
      if (cancelRequested) {
        patchJob({ status: "cancelled", waitingOnBatch: false });
        return;
      }
      patchJob({
        status: "error",
        waitingOnBatch: false,
        error: getErrorMessage(error),
      });
    }
  })();
}
