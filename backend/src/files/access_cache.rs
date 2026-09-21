// Human: Short-lived in-process cache for ContentRead on a file — HLS segments and video posters
//        otherwise re-run the full grant resolver on every request.
// Agent: TTL 30s per (user_id, file_id); INVALIDATED by TTL; USED by ensure_file_access.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const FILE_READ_CACHE_TTL: Duration = Duration::from_secs(30);
const FILE_READ_CACHE_MAX: usize = 4096;

#[derive(Clone, PartialEq, Eq, Hash)]
struct FileReadKey {
    user_id: String,
    file_id: String,
}

struct CacheEntry {
    expires_at: Instant,
}

static FILE_READ_CACHE: Mutex<Option<HashMap<FileReadKey, CacheEntry>>> = Mutex::new(None);

fn cache_map() -> std::sync::MutexGuard<'static, Option<HashMap<FileReadKey, CacheEntry>>> {
    FILE_READ_CACHE.lock().expect("file read cache lock")
}

// Human: True when this user recently passed ContentRead on the file.
// Agent: READS global Mutex map; RETURNS false on miss or expiry.
pub fn get_cached_file_read(user_id: &str, file_id: &str) -> bool {
    let guard = cache_map();
    let Some(map) = guard.as_ref() else {
        return false;
    };
    let Some(entry) = map.get(&FileReadKey {
        user_id: user_id.to_string(),
        file_id: file_id.to_string(),
    }) else {
        return false;
    };
    Instant::now() < entry.expires_at
}

// Human: Remember a successful ContentRead check until TTL expires.
// Agent: WRITES global Mutex map; EVICTS expired entries when over FILE_READ_CACHE_MAX.
pub fn set_cached_file_read(user_id: &str, file_id: &str) {
    let mut guard = cache_map();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    let Some(map) = guard.as_mut() else {
        return;
    };
    if map.len() >= FILE_READ_CACHE_MAX {
        let now = Instant::now();
        map.retain(|_, entry| now < entry.expires_at);
        if map.len() >= FILE_READ_CACHE_MAX {
            map.clear();
        }
    }
    map.insert(
        FileReadKey {
            user_id: user_id.to_string(),
            file_id: file_id.to_string(),
        },
        CacheEntry {
            expires_at: Instant::now() + FILE_READ_CACHE_TTL,
        },
    );
}

// Human: Drop cached reads for one user after ACL changes.
// Agent: RETAINS keys whose user_id does not match.
pub fn invalidate_file_reads_for_user(user_id: &str) {
    let mut guard = cache_map();
    if let Some(map) = guard.as_mut() {
        map.retain(|key, _| key.user_id != user_id);
    }
}

// Human: Clear every cached file read — tests and rare admin maintenance.
// Agent: RESETS global map to empty HashMap.
pub fn invalidate_all_file_reads() {
    let mut guard = cache_map();
    *guard = Some(HashMap::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_roundtrip_and_invalidate() {
        invalidate_all_file_reads();
        assert!(!get_cached_file_read("user-1", "file-1"));
        set_cached_file_read("user-1", "file-1");
        assert!(get_cached_file_read("user-1", "file-1"));
        assert!(!get_cached_file_read("user-1", "file-2"));
        assert!(!get_cached_file_read("user-2", "file-1"));
        invalidate_file_reads_for_user("user-1");
        assert!(!get_cached_file_read("user-1", "file-1"));
    }
}
