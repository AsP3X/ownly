// Human: Parse browser folder picks (webkitRelativePath) and create matching drive folders before upload.
// Agent: READS File.webkitRelativePath; CALLS createFolder + listFolders; RETURNS relativeDir → folder id map.

import { ApiError, createFolder, listFolders } from "@/api/client";

/** Human: Non-standard File field populated when the user picks a directory in Chromium browsers. */
type FileWithRelativePath = File & { webkitRelativePath?: string };

export type FolderUploadEntry = {
  file: File;
  /** Path inside the selected root folder, e.g. "docs" or "docs/images" (empty at root). */
  relativeDir: string;
};

export type ParsedFolderUpload = {
  rootFolderName: string;
  entries: FolderUploadEntry[];
};

/** Human: Read the directory-relative path the browser attaches to folder-picked files. */
export function getFileRelativePath(file: File): string {
  return (file as FileWithRelativePath).webkitRelativePath?.trim() ?? "";
}

/** Human: True when every file came from a directory picker with the same root segment. */
export function isFolderUploadSelection(files: File[]): boolean {
  return parseFolderUploadSelection(files) !== null;
}

/** Human: Extract the root folder name and per-file directory paths from a folder selection. */
export function parseFolderUploadSelection(files: File[]): ParsedFolderUpload | null {
  const withPath = files.filter((file) => getFileRelativePath(file).length > 0);
  if (withPath.length === 0) return null;

  const rootFolderName = getFileRelativePath(withPath[0]!).split("/")[0];
  if (!rootFolderName) return null;

  for (const file of withPath) {
    const parts = getFileRelativePath(file).split("/");
    if (parts[0] !== rootFolderName) return null;
  }

  const entries: FolderUploadEntry[] = withPath.map((file) => {
    const parts = getFileRelativePath(file).split("/");
    const relativeDir = parts.length > 2 ? parts.slice(1, -1).join("/") : "";
    return { file, relativeDir };
  });

  return { rootFolderName, entries };
}

/** Human: Collect every intermediate subdirectory path so parents are created before children. */
function collectSubfolderPaths(entries: FolderUploadEntry[]): string[] {
  const paths = new Set<string>();
  for (const { relativeDir } of entries) {
    if (!relativeDir) continue;
    const segments = relativeDir.split("/");
    for (let depth = 1; depth <= segments.length; depth += 1) {
      paths.add(segments.slice(0, depth).join("/"));
    }
  }
  return Array.from(paths).sort(
    (left, right) => left.split("/").length - right.split("/").length,
  );
}

/** Human: Create a folder or reuse an existing sibling with the same name under the parent. */
async function getOrCreateFolder(name: string, parentId: string | null): Promise<string> {
  try {
    const { folder } = await createFolder({ name, parent_id: parentId });
    return folder.id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const { folders } = await listFolders({
        parent_id: parentId ?? undefined,
        limit: 500,
      });
      const existing = folders.find((entry) => entry.name === name);
      if (existing) return existing.id;
    }
    throw error;
  }
}

/** Human: Mirror the selected local folder tree under parentFolderId and return folder ids by relative path. */
export async function ensureFolderUploadStructure(
  parsed: ParsedFolderUpload,
  parentFolderId: string | null,
): Promise<Map<string, string>> {
  const folderIdByRelativeDir = new Map<string, string>();

  const rootId = await getOrCreateFolder(parsed.rootFolderName, parentFolderId);
  folderIdByRelativeDir.set("", rootId);

  for (const relativePath of collectSubfolderPaths(parsed.entries)) {
    const segments = relativePath.split("/");
    const folderName = segments[segments.length - 1]!;
    const parentRelativeDir = segments.slice(0, -1).join("/");
    const parentFolderIdForChild = folderIdByRelativeDir.get(parentRelativeDir);
    if (!parentFolderIdForChild) {
      throw new Error(`Could not resolve parent folder for "${relativePath}".`);
    }
    const folderId = await getOrCreateFolder(folderName, parentFolderIdForChild);
    folderIdByRelativeDir.set(relativePath, folderId);
  }

  return folderIdByRelativeDir;
}

/** Human: Display path for a pending row — show nested path inside the picked folder when available. */
export function folderUploadDisplayPath(file: File, rootFolderName: string | null): string {
  const relativePath = getFileRelativePath(file);
  if (!relativePath || !rootFolderName) return file.name;
  const prefix = `${rootFolderName}/`;
  if (relativePath.startsWith(prefix)) {
    return relativePath.slice(prefix.length);
  }
  return file.name;
}
