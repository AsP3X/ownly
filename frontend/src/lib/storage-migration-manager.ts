// Human: Server-backed storage migration state — polls API so any admin session restores progress.
// Agent: POST preview/migrate endpoints; POLL status; EMIT job/preview/result dialog subscribers.

import {
  cancelStorageMigrationRun,
  dismissStorageMigrationRun,
  fetchStorageMigrationStatus,
  getErrorMessage,
  startStorageMigrationPreviewRun,
  startStorageMigrationRun,
  type StorageMigrationRun,
} from "@/api/client";

export type StorageMigrationJobStatus = "running" | "complete" | "error" | "cancelled";
export type StorageMigrationJobKind = "preview" | "migrate";

export type StorageMigrationJob = {
  id: string;
  kind: StorageMigrationJobKind;
  status: StorageMigrationJobStatus;
  nodeId?: string;
  prefix?: string;
  totalTarget?: number;
  batchNumber: number;
  migrated: number;
  skipped: number;
  failed: number;
  scanned: number;
  currentNodeId?: string;
  waitingOnBatch: boolean;
  error?: string;
  lastNodeSummaries: string[];
};

export type StorageMigrationPreview = {
  runId: string;
  nodeId?: string;
  prefix?: string;
  totalWouldMigrate: number;
  totalSkipped: number;
  totalScanned: number;
  completedAt: number;
};

type JobListener = (job: StorageMigrationJob | null) => void;
type PreviewListener = (preview: StorageMigrationPreview | null) => void;
type ResultDialogListener = (open: boolean) => void;
type LogDialogListener = (open: boolean) => void;

const POLL_INTERVAL_MS = 2000;

let activeJob: StorageMigrationJob | null = null;
let storedPreview: StorageMigrationPreview | null = null;
let resultDialogOpen = false;
let logDialogOpen = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let restoreAttempted = false;

const jobListeners = new Set<JobListener>();
const previewListeners = new Set<PreviewListener>();
const resultDialogListeners = new Set<ResultDialogListener>();
const logDialogListeners = new Set<LogDialogListener>();

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

function emitResultDialog() {
  for (const listener of resultDialogListeners) {
    listener(resultDialogOpen);
  }
}

function emitLogDialog() {
  for (const listener of logDialogListeners) {
    listener(logDialogOpen);
  }
}

function isTerminal(status: StorageMigrationJobStatus) {
  return status === "complete" || status === "error" || status === "cancelled";
}

function runToJob(run: StorageMigrationRun): StorageMigrationJob {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    nodeId: run.node_id ?? undefined,
    prefix: run.prefix || undefined,
    totalTarget: run.total_target > 0 ? run.total_target : undefined,
    batchNumber: run.batch_number,
    migrated: run.migrated,
    skipped: run.skipped,
    failed: run.failed,
    scanned: run.scanned,
    currentNodeId: run.current_node_id ?? undefined,
    waitingOnBatch: run.status === "running",
    error: run.error_message ?? undefined,
    lastNodeSummaries: [],
  };
}

function syncPreviewFromRun(run: StorageMigrationRun) {
  if (run.kind !== "preview" || run.status !== "complete") {
    return;
  }
  storedPreview = {
    runId: run.id,
    nodeId: run.node_id ?? undefined,
    prefix: run.prefix || undefined,
    totalWouldMigrate: run.migrated,
    totalSkipped: run.skipped,
    totalScanned: run.scanned,
    completedAt: run.completed_at ? Date.parse(run.completed_at) : Date.now(),
  };
  emitPreview();
}

function applyRun(run: StorageMigrationRun, options?: { openResultOnTerminal?: boolean }) {
  const previousStatus = activeJob?.status;
  const previousId = activeJob?.id;

  activeJob = runToJob(run);
  emitJob();
  syncPreviewFromRun(run);

  if (run.kind === "preview" && run.status === "complete") {
    activeJob = {
      ...activeJob,
      totalTarget: run.migrated,
    };
    emitJob();
  }

  const becameTerminal =
    isTerminal(activeJob.status) &&
    (previousStatus === "running" || previousId !== activeJob.id);

  if ((options?.openResultOnTerminal || becameTerminal) && isTerminal(activeJob.status)) {
    resultDialogOpen = true;
    emitResultDialog();
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollStorageMigrationStatus() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const run = await fetchStorageMigrationStatus();
    applyRun(run);
    if (run.status !== "running") {
      stopPolling();
    }
  } catch {
    stopPolling();
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  stopPolling();
  void pollStorageMigrationStatus();
  pollTimer = setInterval(() => {
    void pollStorageMigrationStatus();
  }, POLL_INTERVAL_MS);
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

// Human: Percent complete for migrate jobs; null means indeterminate while preview scans.
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

export function subscribeStorageMigrationJob(listener: JobListener) {
  jobListeners.add(listener);
  listener(activeJob ? { ...activeJob } : null);
  return () => {
    jobListeners.delete(listener);
  };
}

export function subscribeStorageMigrationPreview(listener: PreviewListener) {
  previewListeners.add(listener);
  listener(storedPreview ? { ...storedPreview } : null);
  return () => {
    previewListeners.delete(listener);
  };
}

export function subscribeStorageMigrationResultDialog(listener: ResultDialogListener) {
  resultDialogListeners.add(listener);
  listener(resultDialogOpen);
  return () => {
    resultDialogListeners.delete(listener);
  };
}

export function subscribeStorageMigrationLogDialog(listener: LogDialogListener) {
  logDialogListeners.add(listener);
  listener(logDialogOpen);
  return () => {
    logDialogListeners.delete(listener);
  };
}

// Human: Open the reusable log dialog for the active server migration run.
// Agent: SETS logDialogOpen; READ by StorageMigrationUi subscriber.
export function openStorageMigrationLogDialog() {
  if (!activeJob) return;
  logDialogOpen = true;
  emitLogDialog();
}

export function getStorageMigrationPreview(): StorageMigrationPreview | null {
  return storedPreview ? { ...storedPreview } : null;
}

export function clearStorageMigrationPreview() {
  storedPreview = null;
  emitPreview();
}

// Human: Restore migration UI after reload — any InstanceAdmin sees the same server run.
// Agent: GET status once on mount; STARTS polling when running; OPENS result dialog when terminal.
export async function restoreStorageMigrationFromServer() {
  if (restoreAttempted) return;
  restoreAttempted = true;
  try {
    const run = await fetchStorageMigrationStatus();
    applyRun(run, { openResultOnTerminal: isTerminal(run.status) });
    if (run.status === "running") {
      startPolling();
    }
  } catch {
    activeJob = null;
    emitJob();
  }
}

// Human: Hide the finished migration card and dismiss on the server.
// Agent: POST dismiss; CLEARS local active job.
export async function dismissStorageMigrationJob() {
  if (!activeJob || activeJob.status === "running") return;
  try {
    await dismissStorageMigrationRun(activeJob.id);
  } catch {
    return;
  }
  activeJob = null;
  resultDialogOpen = false;
  emitResultDialog();
  emitJob();
}

export function closeStorageMigrationResultDialog() {
  resultDialogOpen = false;
  emitResultDialog();
}

// Human: Cancel the server-side worker between batches.
// Agent: POST cancel; POLL until status leaves running.
export async function cancelStorageMigrationJob() {
  if (!activeJob || activeJob.status !== "running") return;
  try {
    await cancelStorageMigrationRun(activeJob.id);
    startPolling();
  } catch (error) {
    if (activeJob) {
      activeJob = {
        ...activeJob,
        status: "error",
        error: getErrorMessage(error),
        waitingOnBatch: false,
      };
      emitJob();
    }
  }
}

async function beginRun(start: () => Promise<StorageMigrationRun>) {
  try {
    const run = await start();
    applyRun(run);
    startPolling();
  } catch (error) {
    activeJob = {
      id: "error",
      kind: "preview",
      status: "error",
      batchNumber: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      scanned: 0,
      waitingOnBatch: false,
      error: getErrorMessage(error),
      lastNodeSummaries: [],
    };
    emitJob();
  }
}

// Human: Start full per-object preview on the API server.
// Agent: POST preview endpoint; POLL status for all admin sessions.
export function startStorageMigrationPreview(options: {
  nodeId?: string;
  prefix?: string;
}) {
  void beginRun(() =>
    startStorageMigrationPreviewRun({
      node_id: options.nodeId,
      prefix: options.prefix,
    }),
  );
}

// Human: Start migrate after server preview — progress uses preview total for percent.
// Agent: POST migrate endpoint; REQUIRES matching completed preview on server.
export function startStorageMigration(options: {
  nodeId?: string;
  prefix?: string;
}) {
  void beginRun(() =>
    startStorageMigrationRun({
      node_id: options.nodeId,
      prefix: options.prefix,
    }),
  );
}
