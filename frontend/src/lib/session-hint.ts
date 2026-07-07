// Human: Client-side marker that a cookie session may exist — HttpOnly JWT is not readable from JS.
// Agent: SET on login/setup setAuth; CLEAR on logout and failed session restore; READ before /me probes.

const SESSION_HINT_KEY = "ownly_session_hint";

/** Human: True when this tab recently signed in or restored a session successfully. */
export function hasSessionHint(): boolean {
  try {
    return sessionStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Human: Record that the browser likely holds an HttpOnly session cookie after auth success. */
export function setSessionHint(): void {
  try {
    sessionStorage.setItem(SESSION_HINT_KEY, "1");
  } catch {
    // Private mode or disabled storage — ignore; /me probe still runs when setAuth is called.
  }
}

/** Human: Drop the hint when signing out or when the server rejects the session. */
export function clearSessionHint(): void {
  try {
    sessionStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // ignore
  }
}
