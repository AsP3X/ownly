// Human: Background worker that builds grid JPEG sidecars for uploaded images.
// Agent: READS source blob from storage; PUTS grid-thumbnail.jpg; UPDATES files.image_thumbnail_ready.

use std::sync::Arc;

use futures_util::StreamExt;
use sqlx::PgPool;

use crate::storage::Storage;

use super::{grid_thumbnail_storage_key, thumbnail::generate_grid_thumbnail_jpeg};

#[derive(Debug, Clone)]
pub struct ImageThumbnailJob {
    pub file_id: String,
    pub storage_key: String,
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

// Human: Worker entry — download original, generate JPEG, upload sidecar, mark ready.
// Agent: CALLED from jobs executor; RETURNS Err string on storage/decode failures.
pub async fn run_image_thumbnail_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    job: ImageThumbnailJob,
) -> Result<(), String> {
    mark_processing(&pool, &job.file_id).await;

    let source_bytes = download_source_bytes(storage.as_ref(), &job.storage_key).await?;
    let jpeg = generate_grid_thumbnail_jpeg(&source_bytes)?;
    let thumb_key = grid_thumbnail_storage_key(&job.storage_key);

    storage
        .put(&thumb_key, "image/jpeg", jpeg)
        .await
        .map_err(|e| format!("grid thumbnail upload failed: {e}"))?;

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

// Human: Read the full original object into memory for image crate decode.
// Agent: CALLS storage.get_stream; COLLECTS chunks into Vec<u8>.
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
