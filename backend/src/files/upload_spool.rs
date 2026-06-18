// Human: Temp spool helpers shared by single-shot and resumable upload finalize paths.
// Agent: WRITES disk under ownly_upload_*; CALLS put_with_retry for non-video Nebular PUT.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::AppError;

// Human: Guard against deleting the OS temp root when removing upload scratch directories.
// Agent: REQUIRES path under std::env::temp_dir and not equal to temp root.
pub fn is_deletable_upload_work_dir(path: &Path) -> bool {
    let temp_root = std::env::temp_dir();
    path.starts_with(&temp_root) && path != temp_root.as_path()
}

// Human: Stable temp directory for one upload session or single-shot multipart spool.
// Agent: RETURNS temp_dir/ownly_upload_{id}; resumable uploads use pre-assigned file_id as id.
pub fn upload_work_dir(upload_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ownly_upload_{upload_id}"))
}

// Human: Remove an ownly_upload_* directory after bytes are persisted or the session aborts.
// Agent: SKIPS when path is outside temp_dir; IGNORES remove errors.
pub async fn cleanup_upload_work_dir(work_dir: &Path) {
    if is_deletable_upload_work_dir(work_dir) {
        let _ = tokio::fs::remove_dir_all(work_dir).await;
    }
}

// Human: Read a spooled upload file and PUT it to object storage with transient-error retries.
// Agent: CALLS put_with_retry; RE-READS spool each attempt; ERRORS on disk read or Nebular failure.
pub async fn storage_put_spooled_file(
    storage: &Arc<dyn crate::storage::Storage>,
    storage_key: &str,
    mime: &str,
    tmp_path: &Path,
) -> Result<(), AppError> {
    let path = tmp_path.to_path_buf();
    let mime = mime.to_string();
    let key = storage_key.to_string();
    crate::storage::put_with_retry(storage.as_ref(), &key, &mime, || {
        let path = path.clone();
        async move {
            tokio::fs::read(&path)
                .await
                .map_err(|error| anyhow::anyhow!("read upload spool: {error}"))
        }
    })
    .await
    .map_err(|error| AppError::Storage(error.to_string()))
}

// Human: Guess whether an upload should use the video HLS spool path before reading bytes.
// Agent: READS filename extension only; IGNORES spoofed Content-Type so HTML cannot hijack HLS ingest.
pub fn upload_is_video(filename: &str, _content_type: &str) -> bool {
    mime_guess::from_path(filename)
        .first_or_octet_stream()
        .type_()
        .as_str()
        == "video"
}
