// Human: Shared HTML5 drag-and-drop identifiers for the My Cloud explorer grid and breadcrumbs.
// Agent: SET on dragstart; READ on drop handlers; SUPPORTS file and folder move payloads.

import type { DragEvent } from "react";

export const FILE_DRAG_MIME = "application/x-ownly-file-id";
export const FOLDER_DRAG_MIME = "application/x-ownly-folder-id";

export type ExplorerDragKind = "file" | "folder";

export type ExplorerDragPayload = {
  kind: ExplorerDragKind;
  id: string;
};

// Human: Resolve which explorer item is being dragged from DataTransfer or an in-flight ref fallback.
// Agent: TRUSTS activeDrag first; READS custom MIME types; FALLS BACK to text/plain when the browser strips MIME.
export function readExplorerDragPayload(
  event: DragEvent,
  activeDrag: ExplorerDragPayload | null,
): ExplorerDragPayload | null {
  if (activeDrag) {
    return activeDrag;
  }
  const folderId = event.dataTransfer.getData(FOLDER_DRAG_MIME);
  if (folderId) {
    return { kind: "folder", id: folderId };
  }
  const fileId = event.dataTransfer.getData(FILE_DRAG_MIME);
  if (fileId) {
    return { kind: "file", id: fileId };
  }
  const plain = event.dataTransfer.getData("text/plain");
  if (plain) {
    const types = event.dataTransfer.types;
    if (types.includes(FOLDER_DRAG_MIME)) {
      return { kind: "folder", id: plain };
    }
    if (types.includes(FILE_DRAG_MIME)) {
      return { kind: "file", id: plain };
    }
    return { kind: "file", id: plain };
  }
  return null;
}

// Human: Breadcrumb drop targets encode root as the literal token `root` (parent_id null on the API).
// Agent: PARSES data-breadcrumb-drop; RETURNS null for drive root; RETURNS folder id string otherwise.
export function parseBreadcrumbDropTarget(raw: string | undefined | null): string | null {
  if (!raw || raw === "root") {
    return null;
  }
  return raw;
}
