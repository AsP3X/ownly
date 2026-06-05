// Human: Session-scoped cache for setup completion — avoids blocking the shell on repeat visits.
// Agent: READS/WRITES sessionStorage key ownly_setup_complete; INVALIDATED only when setup POST succeeds.

const SETUP_STATUS_CACHE_KEY = "ownly_setup_complete";

/** Human: Last known setup_complete from GET /setup/status — null when uncached. */
export function readSetupStatusCache(): boolean | null {
  try {
    const value = sessionStorage.getItem(SETUP_STATUS_CACHE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  } catch {
    return null;
  }
}

/** Human: Persist setup status after a successful probe so SetupGuard can render immediately. */
export function writeSetupStatusCache(setupComplete: boolean): void {
  try {
    sessionStorage.setItem(SETUP_STATUS_CACHE_KEY, setupComplete ? "true" : "false");
  } catch {
    // Human: Private mode or disabled storage — ignore; network probe still runs.
  }
}
