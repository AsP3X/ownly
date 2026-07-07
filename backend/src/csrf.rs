// Human: Double-submit CSRF protection for cookie-authenticated browser sessions.
// Agent: SETS ownly_csrf cookie on login; VALIDATES X-CSRF-Token on mutating requests when session cookie present.

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use rand::RngCore;
use std::sync::Arc;

use crate::{auth::session_cookie, error::AppError, AppState};

pub const CSRF_COOKIE_NAME: &str = "ownly_csrf";
pub const CSRF_HEADER_NAME: &str = "x-csrf-token";
// Human: Path must be `/` so document.cookie on the SPA shell (`/`) can read the token for X-CSRF-Token.
// Agent: Session cookie stays scoped to /api/v1; CSRF double-submit requires JS visibility at site root.
const CSRF_COOKIE_PATH: &str = "/";
// Human: Legacy deployments scoped CSRF to /api/v1 — cleared on every auth cookie rotation.
// Agent: PREVENTS duplicate ownly_csrf values confusing double-submit validation after Path migration.
const CSRF_LEGACY_COOKIE_PATH: &str = "/api/v1";

// Human: Mint a fresh CSRF token for double-submit cookie validation.
// Agent: RETURNS 64-char hex from 32 random bytes; SET alongside session cookie on auth success.
pub fn generate_csrf_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn cookie_secure(state: &AppState, headers: &HeaderMap) -> bool {
    if state.environment.eq_ignore_ascii_case("production") {
        return true;
    }
    if state.trust_proxy_headers {
        if let Some(proto) = headers
            .get("x-forwarded-proto")
            .and_then(|value| value.to_str().ok())
        {
            return proto.eq_ignore_ascii_case("https");
        }
    }
    false
}

// Human: Build Set-Cookie for the readable CSRF double-submit token.
// Agent: NOT HttpOnly — JS reads value and sends X-CSRF-Token header on mutations.
pub fn csrf_set_cookie(
    state: &AppState,
    headers: &HeaderMap,
    token: &str,
) -> Result<header::HeaderValue, header::InvalidHeaderValue> {
    let secure = cookie_secure(state, headers);
    let max_age = session_cookie::session_cookie_ttl().as_secs().max(1);
    let mut value = format!(
        "{CSRF_COOKIE_NAME}={token}; Path={CSRF_COOKIE_PATH}; SameSite=Lax; Max-Age={max_age}"
    );
    if secure {
        value.push_str("; Secure");
    }
    header::HeaderValue::from_str(&value)
}

// Human: Expire the CSRF cookie on logout alongside the session cookie.
// Agent: Max-Age=0; MATCHES Path/flags used when setting the cookie.
pub fn csrf_clear_cookie(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<header::HeaderValue, header::InvalidHeaderValue> {
    let secure = cookie_secure(state, headers);
    let mut value = format!(
        "{CSRF_COOKIE_NAME}=; Path={CSRF_COOKIE_PATH}; SameSite=Lax; Max-Age=0"
    );
    if secure {
        value.push_str("; Secure");
    }
    header::HeaderValue::from_str(&value)
}

// Human: Expire pre-Path-migration CSRF cookies still scoped to /api/v1 in the browser jar.
// Agent: APPENDED on login/refresh/logout Set-Cookie; AVOIDS cookie/header token mismatches.
pub fn csrf_clear_legacy_path_cookie(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<header::HeaderValue, header::InvalidHeaderValue> {
    let secure = cookie_secure(state, headers);
    let mut value = format!(
        "{CSRF_COOKIE_NAME}=; Path={CSRF_LEGACY_COOKIE_PATH}; SameSite=Lax; Max-Age=0"
    );
    if secure {
        value.push_str("; Secure");
    }
    header::HeaderValue::from_str(&value)
}

// Human: Parse the CSRF double-submit cookie from the incoming Cookie header.
// Agent: READS ownly_csrf= value; RETURNS None when absent or empty.
pub fn csrf_token_from_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{CSRF_COOKIE_NAME}=");
    let mut last: Option<String> = None;
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix(prefix.as_str()) {
            if !value.is_empty() {
                last = Some(value.to_string());
            }
        }
    }
    last
}

fn csrf_token_from_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(CSRF_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn is_csrf_exempt_path(path: &str) -> bool {
    path.starts_with("/api/v1/auth/login")
        || path.starts_with("/api/v1/auth/register")
        || path.starts_with("/api/v1/auth/logout")
        || path.starts_with("/api/v1/setup")
        || path.starts_with("/api/v1/s/")
        || path.starts_with("/api/v1/health")
}

// Human: Reject mutating requests when session cookie is present but CSRF header mismatches.
// Agent: SKIPS GET/HEAD/OPTIONS; SKIPS Bearer-only clients without session cookie; SKIPS exempt public routes.
pub async fn csrf_middleware(
    State(state): State<Arc<AppState>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let method = request.method().clone();
    if matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(request).await;
    }

    let path = request.uri().path().to_string();
    if is_csrf_exempt_path(&path) {
        return next.run(request).await;
    }

    let headers = request.headers();
    let has_session = session_cookie::session_token_from_headers(headers).is_some();
    if !has_session {
        return next.run(request).await;
    }

    let cookie_token = csrf_token_from_cookie(headers);
    let header_token = csrf_token_from_header(headers);
    let valid = match (&cookie_token, &header_token) {
        (Some(cookie), Some(header)) => {
            cookie.len() == header.len()
                && subtle::ConstantTimeEq::ct_eq(cookie.as_bytes(), header.as_bytes()).into()
        }
        _ => false,
    };

    if !valid {
        let err = AppError::Forbidden("CSRF validation failed".into());
        let _ = state;
        return (StatusCode::FORBIDDEN, err.into_response()).into_response();
    }

    next.run(request).await
}
