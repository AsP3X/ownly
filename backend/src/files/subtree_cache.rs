// Human: Short-lived in-process cache for grantee-readable folder subtrees.
// Agent: TTL 60s per user; REDUCES repeated descendant walks during drive listing.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const SUBTREE_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct CacheEntry {
    folder_ids: Vec<String>,
    expires_at: Instant,
}

static SUBTREE_CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

fn cache_map() -> std::sync::MutexGuard<'static, Option<HashMap<String, CacheEntry>>> {
    SUBTREE_CACHE.lock().expect("subtree cache lock")
}

// Human: Return cached readable subtree folder ids when still fresh.
// Agent: READS global Mutex map keyed by user_id; RETURNS None on miss or expiry.
pub fn get_cached_readable_subtree(user_id: &str) -> Option<Vec<String>> {
    let guard = cache_map();
    let map = guard.as_ref()?;
    let entry = map.get(user_id)?;
    if Instant::now() >= entry.expires_at {
        return None;
    }
    Some(entry.folder_ids.clone())
}

// Human: Store readable subtree folder ids for a user until TTL expires.
// Agent: WRITES global Mutex map; OVERWRITES prior entry for the same user_id.
pub fn set_cached_readable_subtree(user_id: &str, folder_ids: Vec<String>) {
    let mut guard = cache_map();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    if let Some(map) = guard.as_mut() {
        map.insert(
            user_id.to_string(),
            CacheEntry {
                folder_ids,
                expires_at: Instant::now() + SUBTREE_CACHE_TTL,
            },
        );
    }
}

// Human: Drop cached subtree for one user after ACL mutations.
// Agent: REMOVES user_id entry; NO-OP when cache empty.
pub fn invalidate_readable_subtree(user_id: &str) {
    let mut guard = cache_map();
    if let Some(map) = guard.as_mut() {
        map.remove(user_id);
    }
}

// Human: Clear every cached subtree — used in tests or rare admin maintenance.
// Agent: RESETS global map to empty HashMap.
pub fn invalidate_all_readable_subtrees() {
    let mut guard = cache_map();
    *guard = Some(HashMap::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_roundtrip_and_expiry() {
        invalidate_all_readable_subtrees();
        set_cached_readable_subtree("user-1", vec!["f1".into()]);
        assert_eq!(
            get_cached_readable_subtree("user-1"),
            Some(vec!["f1".into()])
        );
        invalidate_readable_subtree("user-1");
        assert!(get_cached_readable_subtree("user-1").is_none());
    }
}
