// Human: Client-side marker that a cookie session may exist — HttpOnly JWT is not readable from JS.
// Agent: SET on login/setup setAuth; CLEAR on logout and failed session restore; READ for CSRF bootstrap.

const SESSION_HINT_KEY = "ownly_session_hint";

/** Human: True when this browser recently signed in or restored a session successfully. */
export function hasSessionHint(): boolean {
  try {
    if (localStorage.getItem(SESSION_HINT_KEY) === "1") return true;
    // Human: Migrate tab-scoped hints written before localStorage persistence shipped.
    // Agent: READS legacy sessionStorage key once; WRITES localStorage; CLEARS sessionStorage.
    const legacy = sessionStorage.getItem(SESSION_HINT_KEY);
    if (legacy === "1") {
      localStorage.setItem(SESSION_HINT_KEY, "1");
      sessionStorage.removeItem(SESSION_HINT_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Human: Record that the browser likely holds an HttpOnly session cookie after auth success. */
export function setSessionHint(): void {
  try {
    localStorage.setItem(SESSION_HINT_KEY, "1");
  } catch {
    // Private mode or disabled storage — ignore; /me probe still runs when setAuth is called.
  }
}

/** Human: Drop the hint when signing out or when the server rejects the session. */
export function clearSessionHint(): void {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // ignore
  }
}
