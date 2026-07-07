// Human: Session-scoped CSRF token mirror for mutations when ownly_csrf is not yet readable from document.cookie.
// Agent: SET from auth JSON csrf_token + after refresh; READ by apiFetch before X-CSRF-Token; CLEAR on logout.

const CSRF_HINT_KEY = "ownly_csrf_hint";

/** Human: Persist CSRF token from login/refresh JSON until the Path=/ cookie is visible to JS. */
export function setCsrfHint(token: string): void {
  try {
    if (token.length > 0) {
      sessionStorage.setItem(CSRF_HINT_KEY, token);
    }
  } catch {
    // Private mode — apiFetch may still bootstrap via POST /auth/refresh.
  }
}

/** Human: Read the last known CSRF token for double-submit header attachment. */
export function readCsrfHint(): string | null {
  try {
    const value = sessionStorage.getItem(CSRF_HINT_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Human: Drop stored CSRF on sign-out so the next visitor does not reuse a stale header value. */
export function clearCsrfHint(): void {
  try {
    sessionStorage.removeItem(CSRF_HINT_KEY);
  } catch {
    // ignore
  }
}

/** Human: Align sessionStorage with document.cookie after auth cookie rotation. */
export function syncCsrfHintFromCookie(readCookie: () => string | null): void {
  const fromCookie = readCookie();
  if (fromCookie) {
    setCsrfHint(fromCookie);
  }
}
