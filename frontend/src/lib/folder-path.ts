// Human: Shared wording for "where does this live" — drive root label and breadcrumb trails.
// Agent: USED by the command palette result rows and by move/undo toasts.

import type { FolderPathSegment } from "@/api/client";

/** Human: What the drive root is called wherever a folder trail is displayed. */
export const ROOT_FOLDER_LABEL = "My Cloud";

// Human: Render a root-first folder trail as a single readable location line.
// Agent: RETURNS ROOT_FOLDER_LABEL for an empty trail; JOINS segment names with a slash.
export function formatFolderPathLabel(segments: FolderPathSegment[] | undefined): string {
  if (!segments || segments.length === 0) {
    return ROOT_FOLDER_LABEL;
  }
  return [ROOT_FOLDER_LABEL, ...segments.map((segment) => segment.name)].join(" / ");
}
