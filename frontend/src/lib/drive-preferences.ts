// Human: Client-side drive preferences until the API tracks recent access and favourites.
// Agent: READS/WRITES localStorage keys for recent file opens and starred favourites.

const RECENT_KEY = "ownly_recent_files";
const FAVOURITES_KEY = "ownly_favourite_files";
const MAX_RECENT = 50;

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

function readFavouriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFavouriteIds(ids: string[]) {
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify(ids));
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

// Human: Return favourite file ids in user-star order.
// Agent: READS ownly_favourite_files from localStorage.
export function getFavouriteFileIds(): string[] {
  return readFavouriteIds();
}

// Human: Toggle starred state for a file and return whether it is now favourited.
// Agent: WRITES ownly_favourite_files; RETURNS new favourited boolean.
export function toggleFavouriteFile(fileId: string): boolean {
  const ids = readFavouriteIds();
  const exists = ids.includes(fileId);
  const next = exists ? ids.filter((id) => id !== fileId) : [...ids, fileId];
  writeFavouriteIds(next);
  return !exists;
}

// Human: Drop stale preference rows when a file is deleted from the library.
// Agent: REMOVES fileId from recent + favourites localStorage keys.
export function removeFilePreferences(fileId: string) {
  writeRecent(readRecent().filter((entry) => entry.fileId !== fileId));
  writeFavouriteIds(readFavouriteIds().filter((id) => id !== fileId));
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

// Human: Resolve favourite file rows from the current library listing.
// Agent: READS favourite ids; FILTERS files array preserving star order.
export function pickFavouriteFiles<T extends { id: string }>(files: T[]): T[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  return readFavouriteIds()
    .map((id) => byId.get(id))
    .filter((file): file is T => file !== undefined);
}
