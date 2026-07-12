// Human: Core HTTP client — cookie session transport, error envelope parsing, and shared helpers.
// Agent: EXPORTS apiFetch, ApiError, getErrorMessage; READ by domain API modules and client barrel.

import { clearCsrfHint, readCsrfHint, setCsrfHint, syncCsrfHintFromCookie } from "@/lib/csrf-hint";
import { getSetupToken } from "@/lib/setup-token";
import { hasSessionHint } from "@/lib/session-hint";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

/** Human: Same-origin API calls must include HttpOnly session cookies (SEC-024). */
export const API_FETCH_CREDENTIALS: RequestCredentials = "same-origin";

const CSRF_COOKIE_NAME = "ownly_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";

// Human: Read the double-submit CSRF cookie set alongside the HttpOnly session cookie.
// Agent: Cookie Path is `/` (not /api/v1) so document.cookie on the SPA shell can read it.
export function readCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${CSRF_COOKIE_NAME}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

// Human: Resolve CSRF for mutations — prefer readable cookie, fall back to auth JSON sessionStorage hint.
// Agent: READS ownly_csrf cookie then ownly_csrf_hint; USED before attaching X-CSRF-Token.
function readCsrfToken(): string | null {
  return readCsrfTokenFromCookie() ?? readCsrfHint();
}

/** Human: Persist CSRF from login/setup/refresh JSON and sync when the Path=/ cookie becomes readable. */
export function captureAuthCsrfToken(csrfToken?: string | null): void {
  if (csrfToken) {
    setCsrfHint(csrfToken);
    return;
  }
  syncCsrfHintFromCookie(readCsrfTokenFromCookie);
}

export { clearCsrfHint };

export function setupMutationHeaders(): HeadersInit | undefined {
  const setupToken = getSetupToken();
  if (!setupToken) return undefined;
  return { "X-Setup-Token": setupToken };
}

// Human: Attach CSRF header for cookie-authenticated mutations (double-submit pattern).
// Agent: READS cookie or sessionStorage hint; BOOTSTRAPS via /auth/refresh when session exists without CSRF.
async function csrfMutationHeaders(method: string | undefined): Promise<HeadersInit | undefined> {
  const normalized = (method ?? "GET").toUpperCase();
  if (normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS") {
    return undefined;
  }
  const token = await ensureCsrfTokenForMutation();
  if (!token) return undefined;
  return { [CSRF_HEADER_NAME]: token };
}

let csrfBootstrapInFlight: Promise<boolean> | null = null;

// Human: Legacy Path=/api/v1 CSRF cookies are invisible to document.cookie — rotate via refresh when needed.
// Agent: POST /auth/refresh (CSRF-exempt); WRITES csrf hint from JSON + cookie after success.
async function ensureCsrfTokenForMutation(): Promise<string | null> {
  const existing = readCsrfToken();
  if (existing) return existing;
  if (!mayHaveSessionCookie()) return null;
  if (!csrfBootstrapInFlight) {
    csrfBootstrapInFlight = tryRefreshAuthToken().finally(() => {
      csrfBootstrapInFlight = null;
    });
  }
  await csrfBootstrapInFlight;
  syncCsrfHintFromCookie(readCsrfTokenFromCookie);
  return readCsrfToken();
}

// Human: Resolve CSRF before XMLHttpRequest or other non-apiFetch mutation transports.
// Agent: EXPORTED for multipart upload XHR; CALLS refresh bootstrap when hint/cookie missing.
export async function ensureCsrfToken(): Promise<string | null> {
  return ensureCsrfTokenForMutation();
}

// Human: Raw fetch for authenticated mutations outside apiFetch (resumable upload parts, etc.).
// Agent: SENDS credentials + X-CSRF-Token; RETRIES once after refresh on CSRF 403.
export async function mutationFetch(
  url: string,
  init: RequestInit = {},
  csrfRetried = false,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const csrfHeaders = await csrfMutationHeaders(init.method);
  if (csrfHeaders) {
    for (const [key, value] of Object.entries(csrfHeaders)) {
      headers.set(key, value as string);
    }
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: init.credentials ?? API_FETCH_CREDENTIALS,
  });

  if (
    res.status === 403 &&
    !csrfRetried &&
    init.credentials !== "omit" &&
    mayHaveSessionCookie()
  ) {
    const preview = await res.clone().text();
    if (/csrf validation failed/i.test(preview)) {
      const refreshed = await tryRefreshAuthToken();
      if (refreshed) {
        return mutationFetch(url, init, true);
      }
    }
  }

  return res;
}

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, unknown>;
  /** Seconds from Retry-After when the server throttled the request (429). */
  retryAfterSeconds?: number;

  constructor(
    message: string,
    code: string,
    status: number,
    fields?: Record<string, unknown>,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Human: JWT lives in an HttpOnly cookie — JS must not read or persist access tokens.
// Agent: RETURNS null; legacy callers should rely on credentials: include instead.
export function getAuthToken(): string | null {
  return null;
}

// Human: Global hook so a 401 from any API call clears the client session (revoked JWT, etc.).
// Agent: SET by AuthProvider; READ by apiFetch on unauthorized responses.
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

// Human: Notify React auth state when apiFetch silently rotates the HttpOnly session cookie.
// Agent: SET by AuthProvider; CALLED after successful POST /auth/refresh.
type SessionRefreshListener = () => void;
let sessionRefreshListener: SessionRefreshListener | null = null;

export function setSessionRefreshListener(listener: SessionRefreshListener | null) {
  sessionRefreshListener = listener;
}

/** @deprecated Use setSessionRefreshListener — JWT is no longer exposed to JS. */
export function setTokenRefreshListener(listener: ((token: string) => void) | null) {
  setSessionRefreshListener(listener ? () => listener("cookie") : null);
}

// Human: Proactive refresh should start this many seconds before JWT exp (backend TTL is 24h).
// Agent: USED by AuthContext schedule; MUST stay below JWT_ACCESS_TTL_HOURS on the API.
const JWT_REFRESH_LEEWAY_SECS = 2 * 3600;

let refreshInFlight: Promise<boolean> | null = null;

// Human: Prevent recursive logout when many parallel 401s fire the unauthorized handler at once.
// Agent: SET during dispatchUnauthorized; RESET on microtask after logout clears client state.
let unauthorizedDispatchInFlight = false;

function dispatchUnauthorized() {
  if (unauthorizedDispatchInFlight || !unauthorizedHandler) return;
  unauthorizedDispatchInFlight = true;
  try {
    unauthorizedHandler();
  } finally {
    queueMicrotask(() => {
      unauthorizedDispatchInFlight = false;
    });
  }
}

function notifySessionRefreshed() {
  sessionRefreshListener?.();
}

// Human: Exchange the current access JWT for a new 24h token without re-entering credentials.
// Agent: POST /auth/refresh with cookies; DEDUPES concurrent callers; UPDATES HttpOnly cookie on success.
export async function tryRefreshAuthToken(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: API_FETCH_CREDENTIALS,
      });
      if (!res.ok) return false;
      const text = await res.text();
      if (text) {
        try {
          const data = JSON.parse(text) as { csrf_token?: string };
          captureAuthCsrfToken(data.csrf_token);
        } catch {
          syncCsrfHintFromCookie(readCsrfTokenFromCookie);
        }
      } else {
        syncCsrfHintFromCookie(readCsrfTokenFromCookie);
      }
      notifySessionRefreshed();
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// Human: True when proactive refresh should run before cookie expiry.
// Agent: READS optional exp hint from login/setup responses; RETURNS false when unknown.
export function shouldProactivelyRefreshToken(expHint?: number | null): boolean {
  if (!expHint) return false;
  const now = Math.floor(Date.now() / 1000);
  return now >= expHint - JWT_REFRESH_LEEWAY_SECS;
}

function mayHaveSessionCookie(): boolean {
  return hasSessionHint() || readCsrfToken() !== null;
}

function shouldIgnoreUnauthorizedLogout(path: string, method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  if (
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/refresh" ||
    path === "/auth/logout"
  ) {
    return true;
  }
  if (path.startsWith("/setup") && m !== "GET") return true;
  return false;
}

// Human: Clear server session cookies without triggering apiFetch 401 retry/logout loops.
// Agent: POST /auth/logout via raw fetch; IGNORES response status; NO unauthorizedHandler side effects.
export async function postLogoutBestEffort(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: API_FETCH_CREDENTIALS,
    });
  } catch {
    // ignore network errors during client-side sign-out
  }
}

// Human: Parse Retry-After from throttled API responses so upload backoff can align with the server window.
// Agent: READS header string; RETURNS integer seconds or undefined when missing/invalid.
export function parseRetryAfterSeconds(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const parsed = Number.parseInt(headerValue.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Human: User-facing text for storage placement failures from the upload API.
// Agent: MAPS backend aggregate-capacity errors; USED by getErrorMessage and upload tray.
export function normalizeStorageErrorMessage(message: string): string {
  if (/aggregate capacity|sufficient capacity/i.test(message)) {
    return "Not enough storage space is available for this upload. Free space or add storage nodes, then try again.";
  }
  return message;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return normalizeStorageErrorMessage(err.message);
  }
  if (err instanceof Error) return normalizeStorageErrorMessage(err.message);
  return "Something went wrong";
}

// Human: Parse API JSON bodies and map failures to ApiError for callers.
// Agent: READS Response text; THROWS ApiError on non-2xx.
async function parseApiResponse(
  res: Response,
  path: string,
  init: RequestInit,
  hadSession: boolean,
) {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const body = data as {
      error?: { code?: string; message?: string; fields?: Record<string, unknown> } | string;
    };
    const errorObject = typeof body?.error === "object" ? body.error : undefined;
    const message =
      typeof body?.error === "string"
        ? body.error
        : errorObject?.message ?? res.statusText;
    const code = errorObject?.code ?? "request_failed";
    if (
      res.status === 401 &&
      hadSession &&
      mayHaveSessionCookie() &&
      !shouldIgnoreUnauthorizedLogout(path, init.method)
    ) {
      dispatchUnauthorized();
    }
    throw new ApiError(
      message,
      code,
      res.status,
      errorObject?.fields,
      parseRetryAfterSeconds(res.headers.get("Retry-After")),
    );
  }

  return data;
}

// Human: Authenticated fetch to `/api/v1` with JSON error envelope parsing.
// Agent: SENDS HttpOnly session cookie + CSRF header; RETRIES after refresh on 401/403 CSRF failures.
export async function apiFetch(path: string, init: RequestInit = {}) {
  const hadSession = init.credentials !== "omit";
  return executeApiFetch(path, init, hadSession, false);
}

async function executeApiFetch(
  path: string,
  init: RequestInit,
  hadSession: boolean,
  csrfRetried: boolean,
) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const csrfHeaders = await csrfMutationHeaders(init.method);
  if (csrfHeaders) {
    for (const [key, value] of Object.entries(csrfHeaders)) {
      headers.set(key, value as string);
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: init.credentials ?? API_FETCH_CREDENTIALS,
  });

  if (
    res.status === 401 &&
    hadSession &&
    !shouldIgnoreUnauthorizedLogout(path, init.method)
  ) {
    if (mayHaveSessionCookie()) {
      const refreshed = await tryRefreshAuthToken();
      if (refreshed) {
        return executeApiFetch(path, init, true, csrfRetried);
      }
      dispatchUnauthorized();
    }
  }

  if (
    res.status === 403 &&
    hadSession &&
    !csrfRetried &&
    !shouldIgnoreUnauthorizedLogout(path, init.method) &&
    mayHaveSessionCookie()
  ) {
    const preview = await res.clone().text();
    if (/csrf validation failed/i.test(preview)) {
      const refreshed = await tryRefreshAuthToken();
      if (refreshed) {
        return executeApiFetch(path, init, true, true);
      }
    }
  }

  return parseApiResponse(res, path, init, hadSession);
}

export { API_BASE };
