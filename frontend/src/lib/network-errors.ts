// Human: Tell a dropped connection apart from a server error, and say so in plain words.
// Agent: PURE; api/core getErrorMessage calls this so every caller gets the same wording.

/** Human: What the user sees instead of the browser's own "Failed to fetch". */
export const NETWORK_ERROR_MESSAGE =
  "Can't reach the server. Check your connection, then try again.";

/**
 * Human: Every browser words a failed fetch differently — Chrome "Failed to fetch",
 * Safari "Load failed", Firefox "NetworkError when attempting to fetch resource".
 * Agent: MATCHED case-insensitively as substrings; add new spellings here, not at call sites.
 */
const NETWORK_ERROR_PATTERNS = [
  "failed to fetch",
  "load failed",
  "networkerror",
  "network request failed",
  "network connection was lost",
  "connection refused",
  "err_internet_disconnected",
  "err_network_changed",
  "err_connection",
  "err_name_not_resolved",
];

/**
 * Human: True when this error means "the request never reached a server".
 * Agent: CALLERS must rule out real HTTP responses first — a 500 carrying these words is not
 *        a connectivity problem. A cancelled request is not one either.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return false;

  const normalized = message.toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}
