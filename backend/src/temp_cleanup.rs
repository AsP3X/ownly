// Human: Background janitor for Ownly scratch files under the OS temp directory.
// Agent: READS std::env::temp_dir; DELETES ownly-prefixed entries idle longer than 2 minutes.
// NOTE: Object-storage MP4 sidecars (`.ownly-gif-preview.mp4`) are never touched here — only API-host scratch dirs.
// NOTE: `ownly_upload_*` dirs stay while video HLS ingest is queued/processing — otherwise ffmpeg loses the spool.

use std::path::Path;
use std::time::{Duration, SystemTime};

use sqlx::PgPool;
use tempfile::TempDir;
use tracing::{debug, info, warn};

/// Human: Scratch files and work dirs are removed after this idle window.
/// Agent: COMPARES latest access/modify activity; USED by sweep and tests.
pub const TEMP_IDLE_MAX_AGE: Duration = Duration::from_secs(2 * 60);

/// Human: How often the janitor scans the temp root between sweeps.
/// Agent: HALF the idle TTL so entries are removed soon after they expire.
const TEMP_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);

/// Human: Prefix for animated-preview transcode scratch directories.
/// Agent: WRITTEN by gif_preview; MATCHED by is_ownly_temp_entry.
pub const GIF_PREVIEW_TEMP_PREFIX: &str = "ownly_gif_preview_";

/// Human: app_settings key — when true, the janitor purges idle ownly_gif_preview_* scratch dirs.
/// Agent: READ by start_temp_janitor; WRITTEN by admin settings PATCH; DEFAULT true when unset.
pub const GIF_PREVIEW_TEMP_AUTO_CLEANUP_KEY: &str = "gif_preview_temp_auto_cleanup";

const OWNLY_TEMP_PREFIXES: &[&str] = &[
    "ownly_upload_",
    "ownly_hls_",
    GIF_PREVIEW_TEMP_PREFIX,
    "mv_export_",
    "mv_folder_zip_",
    "mv_bulk_zip_",
    "mv_public_share_zip_",
];

// Human: Create a tempfile directory tagged for the idle janitor.
// Agent: CALLS tempfile::Builder::prefix; RETURNS TempDir under std::env::temp_dir().
pub fn create_ownly_temp_dir(prefix: &str) -> std::io::Result<TempDir> {
    tempfile::Builder::new().prefix(prefix).tempdir()
}

// Human: True when the entry name belongs to Ownly scratch space.
// Agent: PREFIX match only; DOES NOT inspect file contents.
pub fn is_ownly_temp_entry(name: &str) -> bool {
    OWNLY_TEMP_PREFIXES
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

// Human: True when a temp entry was created for iOS GIF/WebP preview ffmpeg transcode.
// Agent: PREFIX match on GIF_PREVIEW_TEMP_PREFIX; USED by admin cleanup and janitor gating.
pub fn is_gif_preview_temp_entry(name: &str) -> bool {
    name.starts_with(GIF_PREVIEW_TEMP_PREFIX)
}

// Human: Guard against deleting the OS temp root itself.
// Agent: TRUE for strict children of std::env::temp_dir().
pub fn is_deletable_temp_path(path: &Path) -> bool {
    let temp_root = std::env::temp_dir();
    path.starts_with(&temp_root) && path != temp_root.as_path()
}

// Human: Most recent access or modify time for a file or directory tree.
// Agent: RECURSES directories; RETURNS max(accessed, modified) across self and descendants.
pub fn latest_activity(path: &Path) -> std::io::Result<SystemTime> {
    let meta = std::fs::metadata(path)?;
    let mut latest = meta.modified().ok();
    if let Ok(accessed) = meta.accessed() {
        latest = Some(match latest {
            Some(current) if current > accessed => current,
            _ => accessed,
        });
    }

    if meta.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let child_latest = latest_activity(&entry.path())?;
            latest = Some(match latest {
                Some(current) if current > child_latest => current,
                _ => child_latest,
            });
        }
    }

    latest.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("no activity timestamp for {}", path.display()),
        )
    })
}

// Human: True when neither this path nor any descendant was touched recently.
// Agent: READS latest_activity; COMPARES elapsed time to TEMP_IDLE_MAX_AGE.
pub fn is_idle_temp_path(path: &Path, max_idle: Duration) -> bool {
    let Ok(latest) = latest_activity(path) else {
        return false;
    };
    latest
        .elapsed()
        .map(|elapsed| elapsed >= max_idle)
        .unwrap_or(false)
}

// Human: Extract file id from an `ownly_upload_<id>` scratch directory name.
// Agent: USED by janitor to query files.hls_encode_status before deleting upload spools.
pub fn upload_spool_file_id(path: &Path) -> Option<String> {
    let name = path.file_name().and_then(|n| n.to_str())?;
    let file_id = name.strip_prefix("ownly_upload_")?;
    if file_id.is_empty() {
        return None;
    }
    Some(file_id.to_string())
}

// Human: Keep upload spools while video HLS ingest is still queued or processing.
// Agent: READS files row; RETURNS true when NOT hls_ready and status is queued|processing.
pub async fn is_protected_upload_spool(pool: &PgPool, path: &Path) -> bool {
    let Some(file_id) = upload_spool_file_id(path) else {
        return false;
    };
    let row: Option<(bool, String)> = sqlx::query_as(
        "SELECT hls_ready, COALESCE(hls_encode_status, 'queued') \
         FROM files \
         WHERE id = $1 AND deleted_at IS NULL AND mime_type LIKE 'video/%'",
    )
    .bind(&file_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    matches!(
        row,
        Some((false, status)) if status == "queued" || status == "processing"
    )
}

// Human: Remove one Ownly temp entry when idle (or immediately when forced).
// Agent: SKIPS non-ownly paths, active gif transcodes, protected upload spools; CALLS remove_dir_all/remove_file.
async fn remove_temp_entry(
    path: &Path,
    max_idle: Duration,
    force: bool,
    include_gif_preview: bool,
    gif_preview_locks: Option<&crate::files::gif_preview::GifPreviewTranscodeLocks>,
    pool: Option<&PgPool>,
) -> bool {
    if !is_deletable_temp_path(path) {
        return false;
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !is_ownly_temp_entry(name) {
        return false;
    }
    if is_gif_preview_temp_entry(name) && !include_gif_preview {
        return false;
    }
    if is_gif_preview_temp_entry(name) {
        if let Some(locks) = gif_preview_locks {
            if locks.is_scratch_dir_in_use(path).await {
                return false;
            }
        }
    }
    if name.starts_with("ownly_upload_") {
        if let Some(pool) = pool {
            if is_protected_upload_spool(pool, path).await {
                return false;
            }
        }
    }
    if !force && !is_idle_temp_path(path, max_idle) {
        return false;
    }

    let result = if path.is_dir() {
        tokio::fs::remove_dir_all(path).await
    } else {
        tokio::fs::remove_file(path).await
    };

    match result {
        Ok(()) => {
            debug!(path = %path.display(), force, "removed temp entry");
            true
        }
        Err(error) => {
            warn!(path = %path.display(), %error, "failed to remove temp entry");
            false
        }
    }
}

// Human: Scan the OS temp root and delete expired Ownly scratch entries.
// Agent: READS direct children only; SKIPS in-flight gif preview dirs and active upload spools.
pub async fn sweep_idle_temp_files(
    pool: &PgPool,
    max_idle: Duration,
    include_gif_preview: bool,
    gif_preview_locks: Option<&crate::files::gif_preview::GifPreviewTranscodeLocks>,
) -> u32 {
    let temp_root = std::env::temp_dir();
    let mut removed = 0u32;

    let mut read_dir = match tokio::fs::read_dir(&temp_root).await {
        Ok(dir) => dir,
        Err(error) => {
            warn!(temp_root = %temp_root.display(), %error, "temp cleanup read_dir failed");
            return 0;
        }
    };

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        if remove_temp_entry(
            &entry.path(),
            max_idle,
            false,
            include_gif_preview,
            gif_preview_locks,
            Some(pool),
        )
        .await
        {
            removed += 1;
        }
    }

    removed
}

// Human: Admin command — delete idle iOS GIF preview ffmpeg scratch dirs under the OS temp root.
// Agent: FORCE remove ownly_gif_preview_* children except active transcodes; IGNORES object storage.
pub async fn sweep_gif_preview_temp_files(
    gif_preview_locks: Option<&crate::files::gif_preview::GifPreviewTranscodeLocks>,
) -> u32 {
    let temp_root = std::env::temp_dir();
    let mut removed = 0u32;

    let mut read_dir = match tokio::fs::read_dir(&temp_root).await {
        Ok(dir) => dir,
        Err(error) => {
            warn!(temp_root = %temp_root.display(), %error, "gif preview temp cleanup read_dir failed");
            return 0;
        }
    };

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_gif_preview_temp_entry(name) {
            continue;
        }
        if remove_temp_entry(
            &path,
            TEMP_IDLE_MAX_AGE,
            true,
            true,
            gif_preview_locks,
            None,
        )
        .await
        {
            removed += 1;
        }
    }

    removed
}

// Human: Read whether idle gif preview scratch dirs should be purged automatically.
// Agent: READS app_settings gif_preview_temp_auto_cleanup; DEFAULT true when missing.
async fn gif_preview_temp_auto_cleanup_enabled(pool: &sqlx::PgPool) -> bool {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(GIF_PREVIEW_TEMP_AUTO_CLEANUP_KEY)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(value,)| value.eq_ignore_ascii_case("true") || value == "1")
        .unwrap_or(true)
}

// Human: Spawn a periodic task that purges idle Ownly temp scratch files.
// Agent: CALLED from run(); READS gif_preview_temp_auto_cleanup setting each sweep.
pub fn start_temp_janitor(state: std::sync::Arc<crate::AppState>) {
    tokio::spawn(async move {
        loop {
            let include_gif_preview =
                gif_preview_temp_auto_cleanup_enabled(&state.pool).await;

            let removed = sweep_idle_temp_files(
                &state.pool,
                TEMP_IDLE_MAX_AGE,
                include_gif_preview,
                Some(state.gif_preview_transcode_locks.as_ref()),
            )
            .await;
            if removed > 0 {
                info!(removed, include_gif_preview, "idle temp cleanup completed");
            }
            tokio::time::sleep(TEMP_CLEANUP_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::thread;
    use std::time::UNIX_EPOCH;

    #[test]
    fn upload_spool_file_id_parses_uuid_suffix() {
        let path = PathBuf::from("/tmp/ownly_upload_e2c234ed-dc29-415c-8a71-31f913e1ea81");
        assert_eq!(
            upload_spool_file_id(&path).as_deref(),
            Some("e2c234ed-dc29-415c-8a71-31f913e1ea81")
        );
        assert!(upload_spool_file_id(Path::new("/tmp/ownly_hls_abc")).is_none());
    }

    #[test]
    fn ownly_prefixes_are_recognized() {
        assert!(is_ownly_temp_entry("ownly_upload_abc"));
        assert!(is_ownly_temp_entry("ownly_gif_preview_xyz"));
        assert!(is_gif_preview_temp_entry("ownly_gif_preview_xyz"));
        assert!(!is_gif_preview_temp_entry("ownly_upload_abc"));
        assert!(!is_ownly_temp_entry(".tmpRandom"));
        assert!(!is_ownly_temp_entry("other_app_cache"));
    }

    #[test]
    fn temp_root_is_never_deletable() {
        assert!(!is_deletable_temp_path(std::env::temp_dir().as_path()));
    }

    #[test]
    fn idle_detection_uses_latest_tree_activity() {
        let work_dir = create_ownly_temp_dir(GIF_PREVIEW_TEMP_PREFIX).expect("temp dir");
        let path = work_dir.path().to_path_buf();
        let keep_alive = path.clone();
        std::mem::forget(work_dir);

        assert!(!is_idle_temp_path(&path, TEMP_IDLE_MAX_AGE));

        thread::sleep(Duration::from_millis(100));
        assert!(is_idle_temp_path(&path, Duration::from_millis(50)));

        fs::write(path.join("frame.png"), b"x").expect("write frame");
        assert!(!is_idle_temp_path(&path, Duration::from_millis(50)));

        let _ = fs::remove_dir_all(&keep_alive);
    }

    #[test]
    fn latest_activity_falls_back_when_timestamps_missing() {
        let work_dir = create_ownly_temp_dir(GIF_PREVIEW_TEMP_PREFIX).expect("temp dir");
        let path = work_dir.path().join("source.bin");
        fs::write(&path, b"data").expect("write source");
        let latest = latest_activity(&path).expect("latest activity");
        assert!(latest > UNIX_EPOCH);
    }
}
