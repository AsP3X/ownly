// Human: Simple per-key rolling window rate limiter for auth and upload endpoints.
// Agent: READS key; INCREMENTS counter in window; RETURNS AppError::rate_limited with Retry-After when over cap.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error::AppError;

pub struct PerKeyRateLimiter {
    max: usize,
    window: Duration,
    hits: Mutex<HashMap<String, Vec<Instant>>>,
}

impl PerKeyRateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Mutex::new(HashMap::new()),
        }
    }
}

// Human: Record one request for the key and reject when the rolling window is full.
// Agent: MUTATES hits map; RETURNS AppError::rate_limited when len >= max after prune.
pub fn enforce(limiter: &PerKeyRateLimiter, key: &str) -> Result<(), AppError> {
    let now = Instant::now();
    let mut guard = limiter
        .hits
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("rate limiter lock poisoned")))?;
    let entries = guard.entry(key.to_string()).or_default();
    entries.retain(|t| now.duration_since(*t) < limiter.window);
    if entries.len() >= limiter.max {
        let Some(oldest) = entries.iter().min() else {
            return Err(AppError::Internal(anyhow::anyhow!(
                "rate limit entries empty at cap"
            )));
        };
        let retry_after_secs = limiter
            .window
            .saturating_sub(now.duration_since(*oldest))
            .as_secs()
            .max(1);
        return Err(AppError::rate_limited(retry_after_secs));
    }
    entries.push(now);
    Ok(())
}

// Human: Stable rate-limit key when forwarding headers must not be trusted (SEC-006).
// Agent: RETURNS single bucket for direct API access so X-Forwarded-For rotation cannot bypass caps.
const DIRECT_CONNECTION_KEY: &str = "direct-connection";

// Human: Whether the process trusts reverse-proxy forwarding headers (mirrors Config / TRUST_PROXY_HEADERS).
// Agent: READ by audit logging when AppState is unavailable; KEEPS audit IP aligned with rate limits.
pub fn trust_proxy_from_env() -> bool {
    matches!(
        std::env::var("TRUST_PROXY_HEADERS")
            .ok()
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
        Some("1") | Some("true") | Some("yes")
    )
}

// Human: Best-effort client IP from reverse-proxy headers for per-IP auth throttling.
// Agent: READS x-forwarded-for or x-real-ip only when trust_forwarded; ELSE fixed direct key.
pub fn client_ip_from_headers(headers: &axum::http::HeaderMap, trust_forwarded: bool) -> String {
    if !trust_forwarded {
        return DIRECT_CONNECTION_KEY.to_string();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("unknown")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    // Human: When the rolling window is full, enforce must report seconds until the oldest hit expires.
    // Agent: FILLS limiter to cap; ASSERTS retry_after_secs is within the configured window.
    #[test]
    fn direct_connection_key_ignores_spoofed_forwarded_headers() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.99".parse().unwrap());
        assert_eq!(
            client_ip_from_headers(&headers, false),
            DIRECT_CONNECTION_KEY
        );
        assert_eq!(
            client_ip_from_headers(&headers, true),
            "203.0.113.99"
        );
    }

    #[test]
    fn enforce_returns_retry_after_when_at_cap() {
        let limiter = PerKeyRateLimiter::new(2, Duration::from_secs(60));
        enforce(&limiter, "user-a").expect("first request allowed");
        enforce(&limiter, "user-a").expect("second request allowed");
        let err = enforce(&limiter, "user-a").expect_err("third request must be throttled");
        match err {
            AppError::RateLimited { retry_after_secs } => {
                assert!(retry_after_secs >= 1);
                assert!(retry_after_secs <= 60);
            }
            other => panic!("expected rate limited, got {other:?}"),
        }
    }
}
