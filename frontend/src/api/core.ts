// Human: Core HTTP client — auth header injection, error envelope parsing, and shared helpers.
// Agent: EXPORTS apiFetch, ApiError, getErrorMessage; READ by domain API modules and client barrel.

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

function shouldIgnoreUnauthorizedLogout(path: string, method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  if (path === "/auth/login" || path === "/auth/register") return true;
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

// Human: Authenticated fetch to `/api/v1` with JSON error envelope parsing.
// Agent: READS JWT from localStorage; THROWS ApiError on non-2xx; RETURNS parsed JSON body.
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
      token &&
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

export { API_BASE };
