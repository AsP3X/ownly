// Human: Incremental drive file-list updates — insert or patch rows without reloading the folder.
// Agent: READS upload FileItem + view context; WRITES merged arrays; SKIPS setState when unchanged.

import type { FileItem } from "@/api/client";
import type { DriveNavId } from "@/components/drive/DriveSidebar";
import { fileMatchesTypeFilter, type FileTypeFilter } from "@/lib/utils-app";

export type ExplorerFileListContext = {
  activeNav: DriveNavId;
  currentFolderId: string | null;
  searchQuery: string;
  typeFilter: FileTypeFilter;
};

export type ExplorerFileRowMergeResult = {
  files: FileItem[];
  changed: boolean;
  fileCountDelta: number;
};

// Human: Fields that affect explorer grid tiles, badges, and thumbnails.
// Agent: COMPARES two FileItem rows; RETURNS true when tile render output would match.
export function explorerFileRowRenderEqual(a: FileItem, b: FileItem): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.mime_type === b.mime_type &&
    a.size_bytes === b.size_bytes &&
    a.folder_id === b.folder_id &&
    a.hls_ready === b.hls_ready &&
    a.hls_encode_status === b.hls_encode_status &&
    a.conversion_progress === b.conversion_progress &&
    a.audio_waveform_ready === b.audio_waveform_ready &&
    a.audio_encode_status === b.audio_encode_status &&
    a.video_thumbnail_ready === b.video_thumbnail_ready &&
    a.video_thumbnail_status === b.video_thumbnail_status &&
    a.video_thumbnail_selected_index === b.video_thumbnail_selected_index &&
    a.image_thumbnail_ready === b.image_thumbnail_ready &&
    a.image_thumbnail_status === b.image_thumbnail_status &&
    a.share_public === b.share_public
  );
}

// Human: Decide whether an uploaded file should appear in the current drive listing state.
// Agent: CHECKS nav, folder, search, and type filter; FALSE for recycle/shared tabs.
export function shouldReflectUploadInFileList(
  file: FileItem,
  context: ExplorerFileListContext,
): boolean {
  if (context.activeNav === "recycle-bin" || context.activeNav === "shared-files") {
    return false;
  }

  if (!fileMatchesTypeFilter(file.mime_type, context.typeFilter)) {
    return false;
  }

  if (context.activeNav === "home") {
    const query = context.searchQuery.trim().toLowerCase();
    if (!query) return true;
    return file.name.toLowerCase().includes(query);
  }

  if (context.activeNav !== "my-files") {
    return false;
  }

  const fileFolderId = file.folder_id ?? null;
  if (fileFolderId !== context.currentFolderId) {
    return false;
  }

  const query = context.searchQuery.trim().toLowerCase();
  if (query && !file.name.toLowerCase().includes(query)) {
    return false;
  }

  return true;
}

// Human: Insert a new upload at the front or replace an existing row in the files array.
// Agent: RETURNS unchanged prev when row data is identical; INCREMENTS fileCountDelta only on insert.
export function mergeExplorerFileRow(
  prev: FileItem[],
  file: FileItem,
): ExplorerFileRowMergeResult {
  const index = prev.findIndex((row) => row.id === file.id);
  if (index >= 0) {
    const current = prev[index];
    if (explorerFileRowRenderEqual(current, file)) {
      return { files: prev, changed: false, fileCountDelta: 0 };
    }
    const files = [...prev];
    files[index] = file;
    return { files, changed: true, fileCountDelta: 0 };
  }

  return {
    files: [file, ...prev],
    changed: true,
    fileCountDelta: 1,
  };
}

// Human: Apply batched GET /files/:id poll results without replacing unrelated rows.
// Agent: MAPS prev by id; PRESERVES object identity when explorerFileRowRenderEqual.
export function patchExplorerFileRows(
  prev: FileItem[],
  updates: FileItem[],
): FileItem[] {
  if (updates.length === 0) return prev;

  const byId = new Map(updates.map((file) => [file.id, file]));
  let changed = false;
  const next = prev.map((file) => {
    const updated = byId.get(file.id);
    if (!updated || explorerFileRowRenderEqual(file, updated)) {
      return file;
    }
    changed = true;
    return updated;
  });
  return changed ? next : prev;
}
