// Human: Background legacy blob migration job — preview scan then batched migrate with real progress.
// Agent: LOOPS migrateStorageBlobs per node until truncated=false; STORES preview totals; SUBSCRIBE pattern.

import {
  getErrorMessage,
  migrateStorageBlobs,
  type MigrateStorageBlobsResponse,
} from "@/api/client";
import { createClientId } from "@/lib/utils-app";

export type StorageMigrationJobStatus = "running" | "complete" | "error" | "cancelled";
export type StorageMigrationJobKind = "preview" | "migrate";

export type StorageMigrationJob = {
  id: string;
  kind: StorageMigrationJobKind;
  status: StorageMigrationJobStatus;
  nodeId?: string;
  prefix?: string;
  /** Human: Objects that need migration — from preview; drives migrate progress percent. */
  totalTarget?: number;
  batchNumber: number;
  migrated: number;
  skipped: number;
  failed: number;
  scanned: number;
  /** Human: Node currently being scanned or migrated (multi-node runs). */
  currentNodeId?: string;
  /** Human: True while waiting on the current HTTP batch request. */
  waitingOnBatch: boolean;
  error?: string;
  lastNodeSummaries: string[];
};

export type StorageMigrationPreview = {
  nodeId?: string;
  prefix?: string;
  totalWouldMigrate: number;
  totalSkipped: number;
  totalScanned: number;
  completedAt: number;
};

type JobListener = (job: StorageMigrationJob | null) => void;
type PreviewListener = (preview: StorageMigrationPreview | null) => void;

const BATCH_LIMIT = 25;

let activeJob: StorageMigrationJob | null = null;
let storedPreview: StorageMigrationPreview | null = null;
let cancelRequested = false;
let runToken = 0;
const jobListeners = new Set<JobListener>();
const previewListeners = new Set<PreviewListener>();

function emitJob() {
  const snapshot = activeJob ? { ...activeJob } : null;
  for (const listener of jobListeners) {
    listener(snapshot);
  }
}

function emitPreview() {
  const snapshot = storedPreview ? { ...storedPreview } : null;
  for (const listener of previewListeners) {
    listener(snapshot);
  }
}

function patchJob(patch: Partial<StorageMigrationJob>) {
  if (!activeJob) return;
  activeJob = { ...activeJob, ...patch };
  emitJob();
}

// Human: Stable key for matching preview scope to current admin form values.
// Agent: RETURNS nodeId or "*" plus optional prefix.
export function previewScopeKey(nodeId?: string, prefix?: string): string {
  return `${nodeId?.trim() || "*"}|${prefix?.trim() || ""}`;
}

// Human: True when stored preview matches the selected node and prefix.
// Agent: COMPARES previewScopeKey on preview vs form inputs.
export function previewMatchesScope(
  preview: StorageMigrationPreview | null,
  nodeId?: string,
  prefix?: string,
): boolean {
  if (!preview) return false;
  return previewScopeKey(preview.nodeId, preview.prefix) === previewScopeKey(nodeId, prefix);
}

// Human: Percent complete for migrate jobs; null means indeterminate (preview scan in flight).
// Agent: USES migrated+failed over totalTarget from preview.
export function migrationProgressPercent(job: StorageMigrationJob): number | null {
  if (job.kind === "migrate" && job.totalTarget && job.totalTarget > 0) {
    const processed = job.migrated + job.failed;
    return Math.min(100, Math.round((processed / job.totalTarget) * 100));
  }
  if (job.kind === "preview" && job.status === "complete") {
    return 100;
  }
  return null;
}

// Human: Subscribe to the active storage migration job (null when dismissed).
// Agent: CALLS listener immediately; RETURNS unsubscribe.
export function subscribeStorageMigrationJob(listener: JobListener) {
  jobListeners.add(listener);
  listener(activeJob ? { ...activeJob } : null);
  return () => {
    jobListeners.delete(listener);
  };
}

// Human: Subscribe to the last completed preview totals for the admin settings form.
// Agent: CALLS listener immediately; RETURNS unsubscribe.
export function subscribeStorageMigrationPreview(listener: PreviewListener) {
  previewListeners.add(listener);
  listener(storedPreview ? { ...storedPreview } : null);
  return () => {
    previewListeners.delete(listener);
  };
}

export function getStorageMigrationPreview(): StorageMigrationPreview | null {
  return storedPreview ? { ...storedPreview } : null;
}

// Human: Drop stored preview when node or prefix changes in admin settings.
// Agent: SETS storedPreview null; EMITS preview listeners.
export function clearStorageMigrationPreview() {
  storedPreview = null;
  emitPreview();
}

// Human: Clear the finished migration card from the transfer stack.
// Agent: SETS activeJob null; NO-OP while status running.
export function dismissStorageMigrationJob() {
  if (activeJob?.status === "running") return;
  activeJob = null;
  emitJob();
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
  dryRun: boolean,
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
    lastNodeSummaries: summarizeNodes(result, dryRun),
  };
}

function resolveNodeCursor(result: MigrateStorageBlobsResponse, nodeId: string): string | undefined {
  const node = result.nodes.find((entry) => entry.node_id === nodeId) ?? result.nodes[0];
  if (!node?.is_truncated) return undefined;
  return node.next_start_after ?? undefined;
}

type RunOptions = {
  kind: StorageMigrationJobKind;
  nodeId?: string;
  nodeIds: string[];
  prefix?: string;
  totalTarget?: number;
};

// Human: Shared batched loop — paginates each storage node until listing is exhausted.
// Agent: CALLS migrateStorageBlobs with dry_run for preview; WRITES storedPreview on preview complete.
function startBatchedJob(options: RunOptions) {
  if (activeJob?.status === "running") {
    return;
  }

  const nodesToProcess =
    options.nodeId?.trim()
      ? [options.nodeId.trim()]
      : options.nodeIds.map((id) => id.trim()).filter((id) => id.length > 0);

  if (nodesToProcess.length === 0) {
    activeJob = {
      id: createClientId(),
      kind: options.kind,
      status: "error",
      nodeId: options.nodeId,
      prefix: options.prefix,
      totalTarget: options.totalTarget,
      batchNumber: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      scanned: 0,
      waitingOnBatch: false,
      error: "No storage nodes available to scan.",
      lastNodeSummaries: [],
    };
    emitJob();
    return;
  }

  const token = ++runToken;
  cancelRequested = false;
  const dryRun = options.kind === "preview";

  if (dryRun) {
    storedPreview = null;
    emitPreview();
  }

  activeJob = {
    id: createClientId(),
    kind: options.kind,
    status: "running",
    nodeId: options.nodeId,
    prefix: options.prefix,
    totalTarget: options.totalTarget,
    batchNumber: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    scanned: 0,
    waitingOnBatch: true,
    lastNodeSummaries: [],
  };
  emitJob();

  void (async () => {
    try {
      for (const nodeId of nodesToProcess) {
        if (cancelRequested || token !== runToken) {
          return;
        }

        let cursor: string | undefined;
        while (!cancelRequested && token === runToken) {
          patchJob({
            waitingOnBatch: true,
            batchNumber: (activeJob?.batchNumber ?? 0) + 1,
            currentNodeId: nodeId,
          });

          const result = await migrateStorageBlobs({
            node_id: nodeId,
            prefix: options.prefix,
            limit: BATCH_LIMIT,
            start_after: cursor,
            dry_run: dryRun,
          });

          if (token !== runToken || !activeJob) {
            return;
          }

          if (cancelRequested) {
            patchJob({ status: "cancelled", waitingOnBatch: false });
            return;
          }

          const updated = accumulate(activeJob, result, dryRun);
          activeJob = {
            ...updated,
            waitingOnBatch: false,
          };
          emitJob();

          const truncated = result.nodes.some((node) => node.is_truncated);
          if (!truncated) {
            break;
          }

          cursor = resolveNodeCursor(result, nodeId);
          if (!cursor) {
            break;
          }
        }
      }

      if (token !== runToken || !activeJob) {
        return;
      }

      if (cancelRequested) {
        patchJob({ status: "cancelled", waitingOnBatch: false });
        return;
      }

      const hasFailures = activeJob.failed > 0;

      if (dryRun) {
        storedPreview = {
          nodeId: options.nodeId,
          prefix: options.prefix,
          totalWouldMigrate: activeJob.migrated,
          totalSkipped: activeJob.skipped,
          totalScanned: activeJob.scanned,
          completedAt: Date.now(),
        };
        emitPreview();
        patchJob({
          status: "complete",
          waitingOnBatch: false,
          totalTarget: activeJob.migrated,
        });
        return;
      }

      patchJob({
        status: hasFailures ? "error" : "complete",
        waitingOnBatch: false,
        error: hasFailures
          ? "One or more objects failed to migrate. Check audit logs for details."
          : undefined,
      });
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

// Human: Full dry-run scan — counts all objects that need migration and unlocks Start migration.
// Agent: PAGINATES every selected node; STORES StorageMigrationPreview on success.
export function startStorageMigrationPreview(options: {
  nodeId?: string;
  nodeIds: string[];
  prefix?: string;
}) {
  startBatchedJob({
    kind: "preview",
    nodeId: options.nodeId,
    nodeIds: options.nodeIds,
    prefix: options.prefix,
  });
}

// Human: Start legacy blob migration after preview — progress uses preview total for percent.
// Agent: REQUIRES matching storedPreview; RUNS batched migrate until all nodes complete.
export function startStorageMigration(options: {
  nodeId?: string;
  nodeIds: string[];
  prefix?: string;
}) {
  if (!previewMatchesScope(storedPreview, options.nodeId, options.prefix)) {
    return;
  }
  if (!storedPreview || storedPreview.totalWouldMigrate === 0) {
    return;
  }

  startBatchedJob({
    kind: "migrate",
    nodeId: options.nodeId,
    nodeIds: options.nodeIds,
    prefix: options.prefix,
    totalTarget: storedPreview.totalWouldMigrate,
  });
}
