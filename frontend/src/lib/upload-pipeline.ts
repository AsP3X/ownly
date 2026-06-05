// Human: Per-stage upload pipeline slots — up to two files in processing, encrypting, and storing at once.
// Agent: ACQUIRE blocks until a stage slot opens; RELEASE drains wait queues and unblocks the next file.

export type PipelinePostStage = "processing" | "encrypting" | "storing";

/** Human: Independent concurrency ceiling for each post-upload pipeline stage (matches upload slot count). */
export const PIPELINE_STAGE_LIMIT = 2;

const POST_STAGES: PipelinePostStage[] = ["processing", "encrypting", "storing"];

const stageSlots: Record<PipelinePostStage, Set<string>> = {
  processing: new Set(),
  encrypting: new Set(),
  storing: new Set(),
};

const stageWaitQueues: Record<PipelinePostStage, string[]> = {
  processing: [],
  encrypting: [],
  storing: [],
};

// Human: Resolvers for rows blocked on a full stage — keyed by item id then stage.
// Agent: SET on enqueue; CALL when drainWaitQueue admits the row.
const stageWaitResolvers = new Map<string, Map<PipelinePostStage, () => void>>();

function tryOccupyStage(stage: PipelinePostStage, itemId: string): boolean {
  const slots = stageSlots[stage];
  if (slots.has(itemId)) return true;
  if (slots.size >= PIPELINE_STAGE_LIMIT) return false;
  slots.add(itemId);
  return true;
}

function resolveStageWaiter(itemId: string, stage: PipelinePostStage) {
  const resolver = stageWaitResolvers.get(itemId)?.get(stage);
  if (!resolver) return;
  stageWaitResolvers.get(itemId)?.delete(stage);
  resolver();
}

function drainStageWaitQueue(stage: PipelinePostStage) {
  const slots = stageSlots[stage];
  const queue = stageWaitQueues[stage];
  while (slots.size < PIPELINE_STAGE_LIMIT && queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId) break;
    slots.add(nextId);
    resolveStageWaiter(nextId, stage);
  }
}

function releaseStageSlot(itemId: string, stage: PipelinePostStage) {
  const slots = stageSlots[stage];
  if (!slots.delete(itemId)) return;
  stageWaitQueues[stage] = stageWaitQueues[stage].filter((id) => id !== itemId);
  drainStageWaitQueue(stage);
}

function waitForStageSlot(itemId: string, stage: PipelinePostStage): Promise<void> {
  if (tryOccupyStage(stage, itemId)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    if (!stageWaitResolvers.has(itemId)) {
      stageWaitResolvers.set(itemId, new Map());
    }
    stageWaitResolvers.get(itemId)!.set(stage, resolve);
    const queue = stageWaitQueues[stage];
    if (!queue.includes(itemId)) {
      queue.push(itemId);
    }
    drainStageWaitQueue(stage);
  });
}

// Human: Enter a post-upload stage — releases prior stages for this row, then waits for a free slot.
// Agent: AWAITS waitForStageSlot; USED by upload-manager and uploadFileWithProgress phase gates.
export async function acquirePipelineStage(
  itemId: string,
  stage: PipelinePostStage,
): Promise<void> {
  for (const other of POST_STAGES) {
    if (other !== stage) {
      releaseStageSlot(itemId, other);
    }
  }
  await waitForStageSlot(itemId, stage);
}

// Human: Drop all pipeline slots for a finished, cancelled, or errored row.
// Agent: CLEARS stageSlots + wait queues for itemId; DRAINS queues so waiting rows can advance.
export function releaseAllPipelineStages(itemId: string) {
  for (const stage of POST_STAGES) {
    releaseStageSlot(itemId, stage);
    stageWaitQueues[stage] = stageWaitQueues[stage].filter((id) => id !== itemId);
  }
  stageWaitResolvers.delete(itemId);
  for (const stage of POST_STAGES) {
    drainStageWaitQueue(stage);
  }
}

// Human: Factory for one upload row — pairs acquire/release for client.ts callbacks.
// Agent: RETURNS acquire + releaseAll bound to sessionId.
export function createPipelineStageGate(itemId: string) {
  return {
    acquire: (stage: PipelinePostStage) => acquirePipelineStage(itemId, stage),
    releaseAll: () => releaseAllPipelineStages(itemId),
  };
}
