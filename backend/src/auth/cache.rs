// Human: Short-lived in-process cache for auth middleware results — collapses 4–5 DB round trips
//        per request to 0 for the vast majority of authenticated traffic.
// Agent: TTL 30s per user; STORES (enabled, role, is_admin, session_epoch, revoked_sids);
//        INVALIDATED by session revocation, epoch bumps, and admin group membership changes.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const AUTH_CACHE_TTL: Duration = Duration::from_secs(30);

/// Human: Pre-computed auth state for one user — everything the middleware needs after JWT decode.
#[derive(Clone)]
pub struct CachedAuth {
    pub enabled: bool,
    pub role: String,
    pub is_admin: bool,
    pub session_epoch: u64,
    pub revoked_sids: Vec<String>,
    pub min_valid_iat: Option<i64>,
}

#[derive(Clone)]
struct CacheEntry {
    auth: CachedAuth,
    expires_at: Instant,
}

static AUTH_CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

fn cache_map() -> std::sync::MutexGuard<'static, Option<HashMap<String, CacheEntry>>> {
    AUTH_CACHE.lock().expect("auth cache lock")
}

/// Human: Return cached auth state when still fresh.
/// Agent: READS global Mutex map keyed by user_id; RETURNS None on miss or expiry.
pub fn get_cached_auth(user_id: &str) -> Option<CachedAuth> {
    let guard = cache_map();
    let map = guard.as_ref()?;
    let entry = map.get(user_id)?;
    if Instant::now() >= entry.expires_at {
        return None;
    }
    Some(entry.auth.clone())
}

/// Human: Store auth state for a user until TTL expires.
/// Agent: WRITES global Mutex map; OVERWRITES prior entry for the same user_id.
pub fn set_cached_auth(user_id: &str, auth: CachedAuth) {
    let mut guard = cache_map();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    if let Some(map) = guard.as_mut() {
        map.insert(
            user_id.to_string(),
            CacheEntry {
                auth,
                expires_at: Instant::now() + AUTH_CACHE_TTL,
            },
        );
    }
}

/// Human: Drop cached auth for one user after session revocation, epoch bump, or role change.
/// Agent: REMOVES user_id entry; NO-OP when cache empty.
pub fn invalidate_auth(user_id: &str) {
    let mut guard = cache_map();
    if let Some(map) = guard.as_mut() {
        map.remove(user_id);
    }
}

/// Human: Clear every cached auth entry — used in tests or rare admin maintenance.
/// Agent: RESETS global map to empty HashMap.
pub fn invalidate_all_auth() {
    let mut guard = cache_map();
    *guard = Some(HashMap::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_roundtrip_and_invalidation() {
        invalidate_all_auth();
        let auth = CachedAuth {
            enabled: true,
            role: "admin".into(),
            is_admin: true,
            session_epoch: 1,
            revoked_sids: vec![],
            min_valid_iat: None,
        };
        set_cached_auth("user-1", auth.clone());
        let cached = get_cached_auth("user-1");
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().role, "admin");
        invalidate_auth("user-1");
        assert!(get_cached_auth("user-1").is_none());
    }
}
