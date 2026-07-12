// Human: Persist whether the video player should loop the current clip after it ends.
// Agent: READS/WRITES localStorage; DEFAULT false when unset.

const VIDEO_LOOP_STORAGE_KEY = "ownly:video-loop";

// Human: Load saved loop preference — off unless the user previously enabled it.
// Agent: READS localStorage; RETURNS boolean.
export function readVideoLoopPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(VIDEO_LOOP_STORAGE_KEY) === "true";
}

// Human: Remember loop toggle across preview sessions.
// Agent: WRITES "true" | "false" to localStorage.
export function writeVideoLoopPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VIDEO_LOOP_STORAGE_KEY, enabled ? "true" : "false");
}
