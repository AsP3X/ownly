// Human: Continue-watching positions per video file id (local only).
// Agent: READS/WRITES localStorage map; PRUNES stale entries; SKIPS near-start/near-end.

export const VIDEO_RESUME_STORAGE_KEY = "ownly:video-resume";

/** Human: Do not offer resume when less than this many seconds in. */
export const VIDEO_RESUME_MIN_SECONDS = 10;
/** Human: Clear resume when within this many seconds of the end. */
export const VIDEO_RESUME_END_MARGIN_SECONDS = 15;
/** Human: Cap stored entries so localStorage stays small. */
const MAX_RESUME_ENTRIES = 80;

type ResumeMap = Record<string, number>;

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable in private mode or some test runners.
  }
}

// Human: Parse the resume map, dropping non-numeric / invalid positions.
// Agent: RETURNS Record fileId → seconds; EMPTY object on corrupt storage.
function readResumeMap(): ResumeMap {
  const raw = readStorageValue(VIDEO_RESUME_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ResumeMap = {};
    for (const [fileId, seconds] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof fileId === "string" &&
        fileId.length > 0 &&
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds > 0
      ) {
        out[fileId] = seconds;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeResumeMap(map: ResumeMap): void {
  writeStorageValue(VIDEO_RESUME_STORAGE_KEY, JSON.stringify(map));
}

// Human: Decide whether a stored position is worth resuming for this duration.
// Agent: RETURNS true when between min start and end-margin of duration.
export function isMeaningfulResumePosition(
  seconds: number,
  durationSeconds: number,
): boolean {
  if (!Number.isFinite(seconds) || !Number.isFinite(durationSeconds)) return false;
  if (durationSeconds <= VIDEO_RESUME_MIN_SECONDS + VIDEO_RESUME_END_MARGIN_SECONDS) {
    return false;
  }
  if (seconds < VIDEO_RESUME_MIN_SECONDS) return false;
  if (seconds > durationSeconds - VIDEO_RESUME_END_MARGIN_SECONDS) return false;
  return true;
}

// Human: Load continue-watching time for a file, if any.
// Agent: READS map; RETURNS seconds or null when missing/invalid.
export function readVideoResumePosition(fileId: string): number | null {
  if (!fileId) return null;
  const seconds = readResumeMap()[fileId];
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return seconds;
}

// Human: Persist playhead for continue watching; clear when near start/end.
// Agent: WRITES map entry or DELETES when position is not meaningful.
export function writeVideoResumePosition(
  fileId: string,
  seconds: number,
  durationSeconds: number,
): void {
  if (!fileId) return;
  const map = readResumeMap();

  if (!isMeaningfulResumePosition(seconds, durationSeconds)) {
    if (fileId in map) {
      delete map[fileId];
      writeResumeMap(map);
    }
    return;
  }

  map[fileId] = Math.floor(seconds);

  const keys = Object.keys(map);
  if (keys.length > MAX_RESUME_ENTRIES) {
    // Human: Drop oldest arbitrary keys when over cap (map order is insertion in modern JS).
    // Agent: DELETES first excess keys until under MAX_RESUME_ENTRIES.
    const excess = keys.length - MAX_RESUME_ENTRIES;
    for (let i = 0; i < excess; i++) {
      delete map[keys[i]!];
    }
  }

  writeResumeMap(map);
}

// Human: Forget resume after the user finishes the clip (or clears history).
// Agent: DELETES fileId from map when present.
export function clearVideoResumePosition(fileId: string): void {
  if (!fileId) return;
  const map = readResumeMap();
  if (!(fileId in map)) return;
  delete map[fileId];
  writeResumeMap(map);
}
