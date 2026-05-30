// Human: Expand folder checkboxes into descendant file rows for bulk download/save on public shares.
// Agent: READS flat allFiles + allFolders from /all-files; WALKS parent_id tree under selected folders.

import type { FileItem, FolderItem } from "@/api/client";

// Human: Collect folder ids in the subtree rooted at rootId (inclusive).
// Agent: BFS over allFolders parent links; RETURNS Set of folder ids.
function folderSubtreeIds(allFolders: FolderItem[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of allFolders) {
    const parent = folder.parent_id ?? "";
    const list = childrenByParent.get(parent) ?? [];
    list.push(folder.id);
    childrenByParent.set(parent, list);
  }

  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

// Human: Map selected row ids (files + folders) to concrete FileItem rows for API bulk actions.
// Agent: INCLUDES direct file selections; EXPANDS folder selections to all files in subtree.
export function expandShareSelectionToFiles(
  selectedIds: Set<string>,
  allFiles: FileItem[],
  allFolders: FolderItem[],
): FileItem[] {
  const fileById = new Map(allFiles.map((file) => [file.id, file]));
  const chosen = new Map<string, FileItem>();

  for (const id of selectedIds) {
    const file = fileById.get(id);
    if (file) {
      chosen.set(file.id, file);
      continue;
    }

    const folderIds = folderSubtreeIds(allFolders, id);
    for (const candidate of allFiles) {
      if (candidate.folder_id && folderIds.has(candidate.folder_id)) {
        chosen.set(candidate.id, candidate);
      }
    }
  }

  return [...chosen.values()];
}
