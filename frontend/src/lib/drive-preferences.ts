// Human: Client-side drive preferences — recent opens and explorer layout choices.
// Agent: READS/WRITES localStorage; favourites moved to the API (see lib/favourites.ts).

const RECENT_KEY = "ownly_recent_files";
const EXPLORER_FILE_SORT_KEY = "ownly_explorer_file_sort";
const EXPLORER_VIEW_MODE_KEY = "ownly_explorer_view_mode";
const MAX_RECENT = 50;

/** Human: Drive explorer file ordering — name or upload date, ascending or descending. */
export type ExplorerFileSort = "name-asc" | "name-desc" | "uploaded-desc" | "uploaded-asc";

export const EXPLORER_FILE_SORT_OPTIONS: { id: ExplorerFileSort; label: string }[] = [
  { id: "name-asc", label: "Name (A–Z)" },
  { id: "name-desc", label: "Name (Z–A)" },
  { id: "uploaded-desc", label: "Recent upload (newest)" },
  { id: "uploaded-asc", label: "Recent upload (oldest)" },
];

/** Human: How the explorer lays out entries — thumbnail grid or detail rows. */
export type ExplorerViewMode = "grid" | "list";

export const EXPLORER_VIEW_MODES = new Set<ExplorerViewMode>(["grid", "list"]);

/**
 * Human: Which sort each list column header drives, and which way it toggles.
 * Agent: MAPS column → the two existing ExplorerFileSort ids so list sorting adds no new
 *        backend semantics. Columns absent from this map are not sortable.
 */
export const EXPLORER_LIST_COLUMN_SORTS: Record<"name" | "uploaded", [ExplorerFileSort, ExplorerFileSort]> = {
  name: ["name-asc", "name-desc"],
  uploaded: ["uploaded-desc", "uploaded-asc"],
};

// Human: Map UI sort ids to GET /files?sort= query values.
// Agent: REPLACES hyphen with underscore for backend parse_file_list_sort().
export function explorerFileSortToApiParam(sort: ExplorerFileSort): string {
  return sort.replace(/-/g, "_");
}

type RecentEntry = {
  fileId: string;
  accessedAt: string;
};

function readRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentEntry[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
}

// Human: Return recent file ids in access order for Home batch loading.
// Agent: READS ownly_recent_files; RETURNS fileId strings only.
export function getRecentFileIds(): string[] {
  return readRecent().map((entry) => entry.fileId);
}

// Human: Record that the user opened or downloaded a file (feeds Home → Recently accessed).
// Agent: WRITES ownly_recent_files; PROMOTES fileId to front; TRIMS to MAX_RECENT.
export function recordFileAccess(fileId: string) {
  const next = readRecent().filter((entry) => entry.fileId !== fileId);
  next.unshift({ fileId, accessedAt: new Date().toISOString() });
  writeRecent(next.slice(0, MAX_RECENT));
}

// Human: Drop stale preference rows when a file is deleted from the library.
// Agent: REMOVES fileId from the recent list; favourites cascade server-side.
export function removeFilePreferences(fileId: string) {
  writeRecent(readRecent().filter((entry) => entry.fileId !== fileId));
}

// Human: Restore the user's last file sort choice for My Cloud explorer.
// Agent: READS ownly_explorer_file_sort; DEFAULTS to name-asc when missing/invalid.
export function readExplorerFileSort(): ExplorerFileSort {
  try {
    const raw = localStorage.getItem(EXPLORER_FILE_SORT_KEY);
    if (EXPLORER_FILE_SORT_OPTIONS.some((option) => option.id === raw)) {
      return raw as ExplorerFileSort;
    }
  } catch {
    // Agent: Ignore private-mode or quota failures; fall back to default sort.
  }
  return "name-asc";
}

// Human: Persist explorer file sort so it survives reloads and folder navigation.
// Agent: WRITES ownly_explorer_file_sort.
export function writeExplorerFileSort(sort: ExplorerFileSort) {
  localStorage.setItem(EXPLORER_FILE_SORT_KEY, sort);
}

// Human: Restore the user's last explorer layout choice (thumbnail grid vs detail rows).
// Agent: READS ownly_explorer_view_mode; DEFAULTS to grid when missing/invalid.
export function readExplorerViewMode(): ExplorerViewMode {
  try {
    const raw = localStorage.getItem(EXPLORER_VIEW_MODE_KEY);
    if (raw !== null && EXPLORER_VIEW_MODES.has(raw as ExplorerViewMode)) {
      return raw as ExplorerViewMode;
    }
  } catch {
    // Agent: Ignore private-mode or quota failures; fall back to the default grid layout.
  }
  return "grid";
}

// Human: Persist explorer layout so it survives reloads and folder navigation.
// Agent: WRITES ownly_explorer_view_mode; SWALLOWS quota/private-mode errors.
export function writeExplorerViewMode(mode: ExplorerViewMode) {
  try {
    localStorage.setItem(EXPLORER_VIEW_MODE_KEY, mode);
  } catch {
    // Agent: Layout choice is best-effort; the in-memory mode still applies for this session.
  }
}

// Human: Order file rows for Home → Recently accessed using stored access timestamps.
// Agent: READS recent list; FALLS BACK to updated_at sort when no access history exists.
export function sortFilesByRecentAccess<T extends { id: string; updated_at: string }>(
  files: T[],
  limit = 12,
): T[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const recent = readRecent();
  const ordered: T[] = [];

  for (const entry of recent) {
    const file = byId.get(entry.fileId);
    if (file) ordered.push(file);
    if (ordered.length >= limit) return ordered;
  }

  if (ordered.length > 0) return ordered;

  return [...files]
    .sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, limit);
}
