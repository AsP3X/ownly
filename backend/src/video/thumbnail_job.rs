// Human: Background video thumbnail job — score multiple poster frames and upload sidecars.
// Agent: MUTATES files.video_thumbnail_*; READS spooled tmp_video; CALLS thumbnail extraction module.

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::PgPool;
use tempfile::NamedTempFile;

use crate::storage::Storage;

use super::thumbnail::{build_and_upload_manifest, extract_thumbnail_options};
use super::thumbnail_manifest_storage_key;

#[derive(Clone)]
pub struct VideoThumbnailJob {
    pub file_id: String,
    pub storage_key: String,
    pub tmp_video: PathBuf,
}

pub async fn mark_processing(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET video_thumbnail_status = 'processing', video_thumbnail_error = NULL \
         WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

pub async fn mark_failed(pool: &PgPool, file_id: &str, message: &str) {
    let _ = sqlx::query(
        "UPDATE files SET video_thumbnail_status = 'failed', video_thumbnail_error = $1, \
         video_thumbnail_ready = false WHERE id = $2",
    )
    .bind(message)
    .bind(file_id)
    .execute(pool)
    .await;
}

// Human: Mark a video row as user-cancelled so drive UI polling can stop cleanly.
// Agent: WRITES video_thumbnail_status=cancelled; NO-OP when thumbnails already ready.
pub async fn mark_cancelled(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET video_thumbnail_status = 'cancelled', video_thumbnail_error = NULL \
         WHERE id = $1 AND NOT video_thumbnail_ready",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

async fn is_thumbnail_cancelled(pool: &PgPool, file_id: &str) -> bool {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT video_thumbnail_status FROM files WHERE id = $1")
            .bind(file_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    row.is_some_and(|(status,)| status.as_deref() == Some("cancelled"))
}

// Human: Run thumbnail extraction for one queued video — main worker entry point.
// Agent: READS tmp_video; PUTS thumbnails/* + manifest.json; UPDATES files.video_thumbnail_ready.
pub async fn run_video_thumbnail_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    job: VideoThumbnailJob,
) -> Result<(), String> {
    if is_thumbnail_cancelled(&pool, &job.file_id).await {
        return Ok(());
    }

    mark_processing(&pool, &job.file_id).await;

    if is_thumbnail_cancelled(&pool, &job.file_id).await {
        return Ok(());
    }

    // Human: Copy the spooled upload before HLS cleanup may remove the shared work dir.
    // Agent: READS tmp_video; WRITES private NamedTempFile; USES copy for ffmpeg input.
    let local_copy = copy_video_to_temp(&job.tmp_video).await?;

    if is_thumbnail_cancelled(&pool, &job.file_id).await {
        return Ok(());
    }

    let options = extract_thumbnail_options(local_copy.path()).await?;
    let manifest = build_and_upload_manifest(storage, &job.storage_key, options).await?;
    let manifest_key = thumbnail_manifest_storage_key(&job.storage_key);

    sqlx::query(
        "UPDATE files SET video_thumbnail_ready = true, video_thumbnail_status = 'ready', \
         video_thumbnail_error = NULL, video_thumbnail_manifest_key = $1, \
         video_thumbnail_selected_index = $2 WHERE id = $3",
    )
    .bind(&manifest_key)
    .bind(manifest.selected_index as i32)
    .bind(&job.file_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("files thumbnail ready update failed: {e}"))?;

    Ok(())
}

// Human: Duplicate the upload spool into a worker-owned temp file for safe parallel HLS ingest.
// Agent: STREAM-COPIES bytes; RETURNS NamedTempFile handle for the duration of the job.
async fn copy_video_to_temp(source: &std::path::Path) -> Result<NamedTempFile, String> {
    let temp = NamedTempFile::new().map_err(|e| format!("temp file create failed: {e}"))?;
    let mut dest = tokio::fs::File::create(temp.path())
        .await
        .map_err(|e| format!("temp file open failed: {e}"))?;
    let mut src = tokio::fs::File::open(source)
        .await
        .map_err(|e| format!("source video open failed: {e}"))?;
    tokio::io::copy(&mut src, &mut dest)
        .await
        .map_err(|e| format!("source video copy failed: {e}"))?;
    dest.sync_all()
        .await
        .map_err(|e| format!("temp file flush failed: {e}"))?;
    Ok(temp)
}
