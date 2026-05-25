// Human: Simple per-key rolling window rate limiter for auth and upload endpoints.
// Agent: READS key; INCREMENTS counter in window; RETURNS Err RateLimited when over cap.

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
// Agent: MUTATES hits map; RETURNS AppError::RateLimited when len >= max after prune.
pub fn enforce(limiter: &PerKeyRateLimiter, key: &str) -> Result<(), AppError> {
    let now = Instant::now();
    let mut guard = limiter.hits.lock().expect("rate limiter lock");
    let entries = guard.entry(key.to_string()).or_default();
    entries.retain(|t| now.duration_since(*t) < limiter.window);
    if entries.len() >= limiter.max {
        return Err(AppError::RateLimited);
    }
    entries.push(now);
    Ok(())
}

// Human: Best-effort client IP from reverse-proxy headers for per-IP auth throttling.
// Agent: READS x-forwarded-for or x-real-ip; RETURNS first IP or "unknown".
pub fn client_ip_from_headers(headers: &axum::http::HeaderMap) -> String {
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
