// Human: Wording and undo bookkeeping for drive mutations that need to be reversible.
// Agent: PURE helpers; DrivePage owns the API calls and feeds the results back into toasts.

import type { FileItem, FolderItem } from "@/api/client";

/** Human: How long a toast carrying an Undo button stays on screen. */
export const UNDOABLE_TOAST_MS = 10000;

/**
 * Human: One item as it stood before a move, so the Undo action can put it back.
 * Agent: parentId null means the drive root; captured BEFORE the PATCH so it survives the refresh.
 */
export type MoveOrigin = {
  kind: "file" | "folder";
  id: string;
  name: string;
  parentId: string | null;
};

// Human: Snapshot the current location of everything a move is about to touch.
// Agent: SKIPS items already sitting in the destination — those produce no API call and no undo entry.
export function captureMoveOrigins(
  files: FileItem[],
  folders: FolderItem[],
  destinationId: string | null,
): MoveOrigin[] {
  const origins: MoveOrigin[] = [];
  for (const file of files) {
    const parentId = file.folder_id ?? null;
    if (parentId === destinationId) continue;
    origins.push({ kind: "file", id: file.id, name: file.name, parentId });
  }
  for (const folder of folders) {
    const parentId = folder.parent_id ?? null;
    if (parentId === destinationId || folder.id === destinationId) continue;
    origins.push({ kind: "folder", id: folder.id, name: folder.name, parentId });
  }
  return origins;
}

// Human: "1 item" / "4 items" — shared by every batch summary line below.
export function formatItemCount(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

// Human: Name one item in quotes, or fall back to a plain count for a batch.
// Agent: RETURNS the single name so toasts stay specific; an unresolved name degrades to the count.
function describeSubject(names: Array<string | undefined>): string {
  const [first] = names;
  return names.length === 1 && first ? `“${first}”` : formatItemCount(names.length);
}

// Human: Confirmation line for a completed move — "Moved “report.pdf” to Invoices".
export function describeMoveSummary(moved: MoveOrigin[], destinationLabel: string): string {
  return `Moved ${describeSubject(moved.map((item) => item.name))} to ${destinationLabel}`;
}

// Human: Confirmation line after the Undo action put moved items back where they were.
export function describeMoveUndoneSummary(restored: MoveOrigin[]): string {
  return `${describeSubject(restored.map((item) => item.name))} moved back`;
}

// Human: Confirmation line for a soft delete, which stays reversible from the recycle bin.
// Agent: ACCEPTS gaps in names — the count still comes from the array length.
export function describeRecycleSummary(names: Array<string | undefined>): string {
  return `${describeSubject(names)} moved to the recycle bin`;
}

// Human: Confirmation line after restoring recycled items through the Undo action.
export function describeRestoreSummary(count: number): string {
  return count === 1 ? "Restored from the recycle bin" : `Restored ${formatItemCount(count)}`;
}

// Human: Error line when some of a move batch did not go through.
// Agent: RETURNS "" when nothing failed so callers can skip the error toast entirely.
export function describeMoveFailure(failedCount: number, reason: string): string {
  if (failedCount === 0) return "";
  return `${formatItemCount(failedCount)} could not be moved: ${reason}`;
}
