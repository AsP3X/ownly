// Human: Core HTTP client — auth header injection, error envelope parsing, and shared helpers.
// Agent: EXPORTS apiFetch, ApiError, getErrorMessage; READ by domain API modules and client barrel.

import { getJwtExp } from "@/lib/jwt";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";
// Human: Bootstrap secret for first-run setup POST routes — must match backend SETUP_TOKEN.
// Agent: READ from VITE_SETUP_TOKEN; SENT as X-Setup-Token on setup mutations only.
const SETUP_TOKEN = import.meta.env.VITE_SETUP_TOKEN ?? "";

export function setupMutationHeaders(): HeadersInit | undefined {
  if (!SETUP_TOKEN) return undefined;
  return { "X-Setup-Token": SETUP_TOKEN };
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

function getToken(): string | null {
  return localStorage.getItem("ownly_token");
}

// Human: Read JWT for raw fetch/XHR paths that bypass apiFetch (uploads, blob downloads).
// Agent: READS localStorage ownly_token; USED by client upload and preview helpers.
export function getAuthToken(): string | null {
  return getToken();
}

// Human: Global hook so a 401 from any API call clears the client session (revoked JWT, etc.).
// Agent: SET by AuthProvider; READ by apiFetch on unauthorized responses.
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

// Human: Notify React auth state when apiFetch silently rotates the stored JWT.
// Agent: SET by AuthProvider; CALLED after successful POST /auth/refresh.
type TokenRefreshListener = (token: string) => void;
let tokenRefreshListener: TokenRefreshListener | null = null;

export function setTokenRefreshListener(listener: TokenRefreshListener | null) {
  tokenRefreshListener = listener;
}

// Human: Proactive refresh should start this many seconds before JWT exp (backend TTL is 24h).
// Agent: USED by AuthContext schedule; MUST stay below JWT_ACCESS_TTL_HOURS on the API.
const JWT_REFRESH_LEEWAY_SECS = 2 * 3600;

let refreshInFlight: Promise<string | null> | null = null;

function persistRefreshedToken(token: string) {
  localStorage.setItem("ownly_token", token);
  tokenRefreshListener?.(token);
}

// Human: Exchange the current access JWT for a new 24h token without re-entering credentials.
// Agent: POST /auth/refresh; DEDUPES concurrent callers; WRITES ownly_token on success.
export async function tryRefreshAuthToken(): Promise<string | null> {
  const current = getToken();
  if (!current) return null;

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${current}` },
      });
      const text = await res.text();
      if (!res.ok) return null;
      const data = text ? (JSON.parse(text) as { token?: string }) : null;
      const next = data?.token;
      if (!next) return null;
      persistRefreshedToken(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// Human: True when the stored JWT is inside the proactive refresh window.
// Agent: READS getJwtExp; RETURNS true when now >= exp - JWT_REFRESH_LEEWAY_SECS.
export function shouldProactivelyRefreshToken(token: string): boolean {
  const exp = getJwtExp(token);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return now >= exp - JWT_REFRESH_LEEWAY_SECS;
}

function shouldIgnoreUnauthorizedLogout(path: string, method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  if (path === "/auth/login" || path === "/auth/register" || path === "/auth/refresh") return true;
  if (path.startsWith("/setup") && m !== "GET") return true;
  return false;
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
async function parseApiResponse(res: Response, path: string, init: RequestInit, hadToken: boolean) {
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
      hadToken &&
      !shouldIgnoreUnauthorizedLogout(path, init.method)
    ) {
      unauthorizedHandler?.();
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
// Agent: READS JWT from localStorage; RETRIES once after POST /auth/refresh on 401; THROWS ApiError on failure.
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (
    res.status === 401 &&
    token &&
    !shouldIgnoreUnauthorizedLogout(path, init.method)
  ) {
    const refreshed = await tryRefreshAuthToken();
    if (refreshed) {
      const retryHeaders = new Headers(init.headers);
      if (!retryHeaders.has("Content-Type") && !(init.body instanceof FormData)) {
        retryHeaders.set("Content-Type", "application/json");
      }
      retryHeaders.set("Authorization", `Bearer ${refreshed}`);
      const retryRes = await fetch(`${API_BASE}${path}`, { ...init, headers: retryHeaders });
      return parseApiResponse(retryRes, path, init, true);
    }
    unauthorizedHandler?.();
  }

  return parseApiResponse(res, path, init, Boolean(token));
}

export { API_BASE };
