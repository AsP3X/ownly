// Human: Background worker that builds grid JPEG sidecars for uploaded images.
// Agent: READS upload spool or storage blob; PUTS grid-thumbnail.jpg; UPDATES files.image_thumbnail_ready.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::StreamExt;
use sqlx::PgPool;

use crate::storage::Storage;

use super::{grid_thumbnail_storage_key, thumbnail::generate_grid_thumbnail_jpeg};

#[derive(Debug, Clone)]
pub struct ImageThumbnailJob {
    pub file_id: String,
    pub storage_key: String,
    /// Human: When set, decode from the upload spool instead of downloading from Nebular.
    pub tmp_source: Option<PathBuf>,
}

// Human: Mark the file row as processing before download/decode begins.
// Agent: WRITES image_thumbnail_status processing; CLEARS prior error text.
pub async fn mark_processing(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET image_thumbnail_status = 'processing', image_thumbnail_error = NULL \
         WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

// Human: Record terminal failure on the files row for UI fallback behavior.
// Agent: WRITES image_thumbnail_status failed + error message.
pub async fn mark_failed(pool: &PgPool, file_id: &str, message: &str) {
    let _ = sqlx::query(
        "UPDATE files SET image_thumbnail_ready = false, image_thumbnail_status = 'failed', \
         image_thumbnail_error = $2 WHERE id = $1",
    )
    .bind(file_id)
    .bind(message)
    .execute(pool)
    .await;
}

// Human: Guard against deleting the OS temp root during upload spool cleanup.
fn is_deletable_upload_work_dir(path: &Path) -> bool {
    let temp_root = std::env::temp_dir();
    path.starts_with(&temp_root) && path != temp_root.as_path()
}

// Human: Remove the per-upload scratch directory after thumbnail ingest finishes or fails.
async fn cleanup_upload_work_dir(tmp_source: &Path) {
    let Some(work_dir) = tmp_source.parent() else {
        return;
    };
    if is_deletable_upload_work_dir(work_dir) {
        let _ = tokio::fs::remove_dir_all(work_dir).await;
    }
}

// Human: Read the full original object into memory for image crate decode.
// Agent: CALLS storage.get_stream; COLLECTS chunks into Vec<u8>; FALLBACK when spool missing.
async fn download_source_bytes(storage: &dyn Storage, storage_key: &str) -> Result<Vec<u8>, String> {
    let (mut stream, _, _) = storage
        .get_stream(storage_key)
        .await
        .map_err(|e| format!("source download failed: {e}"))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("source stream read failed: {e}"))?;
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

// Human: Load raster bytes from upload spool when present, otherwise from object storage.
async fn load_source_bytes(
    storage: &dyn Storage,
    storage_key: &str,
    tmp_source: Option<PathBuf>,
) -> Result<Vec<u8>, String> {
    if let Some(path) = tmp_source {
        if tokio::fs::metadata(&path).await.is_ok() {
            return tokio::fs::read(&path)
                .await
                .map_err(|e| format!("read upload spool failed: {e}"));
        }
    }
    download_source_bytes(storage, storage_key).await
}

// Human: Worker entry — decode original, generate JPEG, upload sidecar, mark ready.
// Agent: CALLED from jobs executor; RETURNS Err string on storage/decode failures; CLEANUP spool dir.
pub async fn run_image_thumbnail_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    job: ImageThumbnailJob,
) -> Result<(), String> {
    mark_processing(&pool, &job.file_id).await;

    let source_bytes =
        load_source_bytes(storage.as_ref(), &job.storage_key, job.tmp_source.clone()).await?;
    let jpeg = generate_grid_thumbnail_jpeg(&source_bytes)?;
    let thumb_key = grid_thumbnail_storage_key(&job.storage_key);

    let result = storage
        .put(&thumb_key, "image/jpeg", jpeg)
        .await
        .map_err(|e| format!("grid thumbnail upload failed: {e}"));

    if let Some(ref tmp) = job.tmp_source {
        cleanup_upload_work_dir(tmp).await;
    }

    result?;

    sqlx::query(
        "UPDATE files SET image_thumbnail_ready = true, image_thumbnail_status = 'ready', \
         image_thumbnail_error = NULL WHERE id = $1",
    )
    .bind(&job.file_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("files image thumbnail ready update failed: {e}"))?;

    Ok(())
}
