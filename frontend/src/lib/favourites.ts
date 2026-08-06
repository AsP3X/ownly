// Human: Starred files now live on the account, not in one browser's localStorage.
// Agent: OWNS the legacy key so the one-time import has a single home; drive-preferences keeps recents only.

import { addFavouriteFiles, fetchFavouriteFileIds } from "@/api/client";

/** Human: Where builds before 2026-08 kept stars — per browser, invisible to other devices. */
const LEGACY_FAVOURITES_KEY = "ownly_favourite_files";

/** Human: Matches the API's per-request cap, so one import never bounces off it. */
const LEGACY_IMPORT_LIMIT = 500;

function readLegacyFavouriteIds(): string[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_FAVOURITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, LEGACY_IMPORT_LIMIT);
  } catch {
    // Human: Private mode, quota errors, or hand-edited JSON — nothing to import.
    return [];
  }
}

/**
 * Human: Load the account's stars, first handing over anything the old browser-local list still holds.
 * Agent: CLEARS the legacy key only after the server accepted the import, so a failure retries next load.
 */
export async function loadFavouriteFileIds(): Promise<Set<string>> {
  const legacyIds = readLegacyFavouriteIds();
  if (legacyIds.length > 0) {
    try {
      await addFavouriteFiles(legacyIds);
      window.localStorage.removeItem(LEGACY_FAVOURITES_KEY);
    } catch {
      // Human: Keep the local list rather than losing the user's stars to a failed import.
    }
  }

  const { file_ids } = await fetchFavouriteFileIds();
  return new Set(file_ids);
}
