// Human: HttpOnly session cookie for JWT transport — keeps tokens out of browser JS storage (SEC-024).
// Agent: SET on login/register/setup/refresh; READ in auth_middleware + refresh; CLEAR on logout.

use axum::http::{header, HeaderMap, HeaderValue};
use std::time::Duration;

use crate::AppState;

pub const SESSION_COOKIE_NAME: &str = "ownly_session";
const SESSION_COOKIE_PATH: &str = "/api/v1";

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

fn session_max_age_secs(state: &AppState) -> i64 {
    (state.jwt_access_ttl_hours as i64).saturating_mul(3600).max(3600)
}

// Human: Build Set-Cookie for a freshly issued access JWT.
// Agent: HttpOnly + SameSite=Lax; Secure in production or when X-Forwarded-Proto is https.
pub fn session_set_cookie(
    state: &AppState,
    headers: &HeaderMap,
    token: &str,
) -> Result<HeaderValue, header::InvalidHeaderValue> {
    let secure = cookie_secure(state, headers);
    let max_age = session_max_age_secs(state);
    let mut value = format!(
        "{SESSION_COOKIE_NAME}={token}; Path={SESSION_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age={max_age}"
    );
    if secure {
        value.push_str("; Secure");
    }
    HeaderValue::from_str(&value)
}

// Human: Expire the session cookie on logout or forced client sign-out.
// Agent: Max-Age=0; MATCHES Path/flags used when setting the cookie.
pub fn session_clear_cookie(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<HeaderValue, header::InvalidHeaderValue> {
    let secure = cookie_secure(state, headers);
    let mut value = format!(
        "{SESSION_COOKIE_NAME}=; Path={SESSION_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0"
    );
    if secure {
        value.push_str("; Secure");
    }
    HeaderValue::from_str(&value)
}

// Human: Read the access JWT from the HttpOnly session cookie when present.
// Agent: PARSES Cookie header; RETURNS raw JWT string for decode_token*.
pub fn session_token_from_headers(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{SESSION_COOKIE_NAME}=");
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix(prefix.as_str()) {
            if value.is_empty() {
                return None;
            }
            return Some(value.to_string());
        }
    }
    None
}

// Human: Prefer cookie transport, fall back to Authorization: Bearer for API clients and tests.
// Agent: USED by auth_middleware and refresh handler.
pub fn bearer_or_session_token(headers: &HeaderMap) -> Option<String> {
    if let Some(token) = session_token_from_headers(headers) {
        return Some(token);
    }
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string)
}

// Human: Cookie Max-Age Duration for CSRF cookies issued alongside the session.
// Agent: READS AppState.jwt_access_ttl_hours; USED by csrf_set_cookie.
pub fn session_cookie_ttl(state: &AppState) -> Duration {
    Duration::from_secs(session_max_age_secs(state).max(0) as u64)
}
