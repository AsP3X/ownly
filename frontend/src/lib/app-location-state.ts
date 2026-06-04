// Human: Serialize drive and admin UI state into URL search params so reload restores the same view.
// Agent: READS/WRITES view, folder, q, type, section query keys; VALIDATES against known nav ids.

import type { AdminNavId } from "@/components/admin/AdminSidebar";
import type { DriveNavId } from "@/components/drive/DriveSidebar";
import type { FileTypeFilter } from "@/lib/utils-app";

export const DRIVE_VIEW_PARAM = "view";
export const DRIVE_FOLDER_PARAM = "folder";
export const DRIVE_QUERY_PARAM = "q";
export const DRIVE_TYPE_PARAM = "type";
export const ADMIN_SECTION_PARAM = "section";

const DRIVE_VIEWS: readonly DriveNavId[] = [
  "home",
  "my-files",
  "shared-files",
  "recycle-bin",
];

const ADMIN_SECTIONS: readonly AdminNavId[] = [
  "overview",
  "users-security",
  "security-policies",
  "storage-nodes",
  "audit-logs",
  "system-settings",
];

const FILE_TYPE_FILTERS: readonly FileTypeFilter[] = [
  "all",
  "documents",
  "spreadsheets",
  "presentations",
  "images",
  "video",
  "audio",
];

/** Human: Parse `view` query value into a drive nav id when it is recognized. */
export function parseDriveViewParam(raw: string | null): DriveNavId | null {
  if (!raw) return null;
  return (DRIVE_VIEWS as readonly string[]).includes(raw) ? (raw as DriveNavId) : null;
}

/** Human: Parse comma-separated folder ids from the `folder` query param. */
export function parseDriveFolderParam(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Human: Parse `type` filter query value when it matches a known drive filter id. */
export function parseDriveTypeParam(raw: string | null): FileTypeFilter | null {
  if (!raw) return null;
  return (FILE_TYPE_FILTERS as readonly string[]).includes(raw)
    ? (raw as FileTypeFilter)
    : null;
}

/** Human: Parse admin `section` query into a sidebar nav id when valid. */
export function parseAdminSectionParam(raw: string | null): AdminNavId | null {
  if (!raw) return null;
  return (ADMIN_SECTIONS as readonly string[]).includes(raw) ? (raw as AdminNavId) : null;
}

type DriveUrlState = {
  view: DriveNavId;
  folderIds: string[];
  query: string;
  typeFilter: FileTypeFilter;
};

/** Human: Build search params for the current drive shell state (omits defaults). */
export function buildDriveSearchParams(state: DriveUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view !== "home") {
    params.set(DRIVE_VIEW_PARAM, state.view);
  }
  if (state.folderIds.length > 0 && state.view === "my-files") {
    params.set(DRIVE_FOLDER_PARAM, state.folderIds.join(","));
  }
  const trimmedQuery = state.query.trim();
  if (trimmedQuery) {
    params.set(DRIVE_QUERY_PARAM, trimmedQuery);
  }
  if (state.typeFilter !== "all") {
    params.set(DRIVE_TYPE_PARAM, state.typeFilter);
  }
  return params;
}

/** Human: Return true when two drive URL snapshots describe the same location. */
export function driveUrlStateEquals(a: DriveUrlState, b: DriveUrlState): boolean {
  return (
    a.view === b.view &&
    a.typeFilter === b.typeFilter &&
    a.query === b.query &&
    a.folderIds.join(",") === b.folderIds.join(",")
  );
}

/** Human: Build search params for the active admin console section (omits overview default). */
export function buildAdminSearchParams(section: AdminNavId): URLSearchParams {
  const params = new URLSearchParams();
  if (section !== "overview") {
    params.set(ADMIN_SECTION_PARAM, section);
  }
  return params;
}
