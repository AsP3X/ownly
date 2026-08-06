// Human: Track editor drafts that would be lost if the app navigated away right now.
// Agent: MODULE-level registry — an expiring session reads it before it unmounts the drive.

/** Human: A draft the user has not saved, and the bytes needed to rescue it. */
export type UnsavedWorkItem = {
  id: string;
  name: string;
  /** Human: Produces the current draft on demand, so nothing is copied until it is needed. */
  getSnapshot: () => Blob;
};

const registry = new Map<string, UnsavedWorkItem>();

/**
 * Human: Declare that this editor holds unsaved changes.
 * Agent: CALL again on every change to refresh the snapshot closure; RETURNS an unregister fn.
 */
export function registerUnsavedWork(item: UnsavedWorkItem): () => void {
  registry.set(item.id, item);
  return () => {
    // Human: Only clear the entry we set — a remount may already have replaced it.
    if (registry.get(item.id) === item) registry.delete(item.id);
  };
}

export function clearUnsavedWork(id: string) {
  registry.delete(id);
}

export function hasUnsavedWork(): boolean {
  return registry.size > 0;
}

export function listUnsavedWork(): UnsavedWorkItem[] {
  return [...registry.values()];
}
