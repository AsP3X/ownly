// Human: Background video thumbnail job — score multiple poster frames and upload sidecars.
// Agent: MUTATES files.video_thumbnail_*; READS spooled tmp_video or Nebular source; CALLS thumbnail extraction.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::StreamExt;
use sqlx::PgPool;
use tempfile::{NamedTempFile, TempDir};

use crate::files::zip_job::is_hls_stored_video;
use crate::hls::export::export_cache_is_valid;
use crate::hls::export_job::{materialize_hls_mp4_for_ffmpeg, run_hls_export_job, EXPORT_OBJECT_KEY};
use crate::storage::Storage;

use super::thumbnail::{build_and_upload_manifest, extract_thumbnail_options};
use super::thumbnail_manifest_storage_key;

#[derive(Clone)]
pub struct VideoThumbnailJob {
    pub file_id: String,
    pub storage_key: String,
    /// Human: Upload spool path when still on disk; None triggers download from Nebular.
    pub tmp_video: Option<PathBuf>,
}

pub async fn mark_processing(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET video_thumbnail_status = 'processing', video_thumbnail_error = NULL, \
         video_thumbnail_progress = 0 WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

pub async fn mark_failed(pool: &PgPool, file_id: &str, message: &str) {
    let _ = sqlx::query(
        "UPDATE files SET video_thumbnail_status = 'failed', video_thumbnail_error = $1, \
         video_thumbnail_ready = false, video_thumbnail_progress = 0 WHERE id = $2",
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
        "UPDATE files SET video_thumbnail_status = 'cancelled', video_thumbnail_error = NULL, \
         video_thumbnail_progress = 0 WHERE id = $1 AND NOT video_thumbnail_ready",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

// Human: Mirror upload-tray percent on the file row while thumbnails generate.
// Agent: WRITES files.video_thumbnail_progress; READ by jobs executor + drive polling.
async fn set_thumbnail_progress(pool: &PgPool, file_id: &str, progress: i32) {
    let pct = progress.clamp(0, 100);
    let _ = sqlx::query("UPDATE files SET video_thumbnail_progress = $1 WHERE id = $2")
        .bind(pct)
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

    set_thumbnail_progress(&pool, &job.file_id, 5).await;

    // Human: Prefer upload spool when present; HLS-ready videos use export.mp4 or a local playlist.
    // Agent: READS tmp_video OR HLS bundle OR raw storage_key; WRITES temp input for ffmpeg.
    let local_copy = resolve_video_source(
        &pool,
        storage.clone(),
        &job.file_id,
        &job.storage_key,
        job.tmp_video.as_deref(),
    )
    .await?;

    if is_thumbnail_cancelled(&pool, &job.file_id).await {
        return Ok(());
    }

    set_thumbnail_progress(&pool, &job.file_id, 58).await;
    let options = extract_thumbnail_options(local_copy.input_path()).await?;
    set_thumbnail_progress(&pool, &job.file_id, 88).await;
    set_thumbnail_progress(&pool, &job.file_id, 92).await;
    let manifest = build_and_upload_manifest(storage, &job.storage_key, options).await?;
    let manifest_key = thumbnail_manifest_storage_key(&job.storage_key);

    sqlx::query(
        "UPDATE files SET video_thumbnail_ready = true, video_thumbnail_status = 'ready', \
         video_thumbnail_error = NULL, video_thumbnail_progress = 100, \
         video_thumbnail_manifest_key = $1, video_thumbnail_selected_index = $2 WHERE id = $3",
    )
    .bind(&manifest_key)
    .bind(manifest.selected_index as i32)
    .bind(&job.file_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("files thumbnail ready update failed: {e}"))?;

    Ok(())
}

// Human: Worker-owned ffmpeg input — upload spool copy or remuxed scratch MP4.
enum LocalVideoSource {
    File(NamedTempFile),
    Remuxed {
        _work_dir: TempDir,
        mp4: PathBuf,
    },
}

impl LocalVideoSource {
    fn input_path(&self) -> &Path {
        match self {
            Self::File(file) => file.path(),
            Self::Remuxed { mp4, .. } => mp4.as_path(),
        }
    }
}

type ThumbnailSourceRow = (
    Option<String>,
    bool,
    Option<i32>,
    bool,
    Option<i64>,
);

// Human: Pick upload spool, cached export MP4, local HLS playlist, or the raw storage object.
// Agent: READS files row; HLS-ready rows never have a standalone blob at storage_key.
async fn resolve_video_source(
    pool: &PgPool,
    storage: Arc<dyn Storage>,
    file_id: &str,
    storage_key: &str,
    tmp_video: Option<&Path>,
) -> Result<LocalVideoSource, String> {
    if let Some(path) = tmp_video {
        if path.exists() {
            set_thumbnail_progress(pool, file_id, 38).await;
            let file = copy_video_to_temp(path).await.map(LocalVideoSource::File)?;
            set_thumbnail_progress(pool, file_id, 52).await;
            return Ok(file);
        }
    }

    let row: Option<ThumbnailSourceRow> = sqlx::query_as(
        "SELECT mime_type, hls_ready, segment_count, download_export_ready, \
         download_export_size_bytes FROM files WHERE id = $1",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("files row load failed: {e}"))?;

    let Some((mime_type, hls_ready, segment_count, export_ready, export_size)) = row else {
        return Err("file row not found for thumbnail source".into());
    };

    if is_hls_stored_video(&mime_type, hls_ready) {
        return resolve_hls_video_source(
            pool,
            storage,
            file_id,
            storage_key,
            segment_count.unwrap_or(0),
            export_ready,
            export_size,
        )
        .await;
    }

    set_thumbnail_progress(pool, file_id, 12).await;
    let file = download_source_to_temp(storage, storage_key).await?;
    set_thumbnail_progress(pool, file_id, 35).await;
    Ok(LocalVideoSource::File(file))
}

// Human: HLS vault videos keep segments + sidecars — not the upload spool path at storage_key.
// Agent: PREFERS cached export.mp4; ELSE remuxes segments locally; LAST runs full export job.
async fn resolve_hls_video_source(
    pool: &PgPool,
    storage: Arc<dyn Storage>,
    file_id: &str,
    storage_key: &str,
    segment_count: i32,
    export_ready: bool,
    export_size: Option<i64>,
) -> Result<LocalVideoSource, String> {
    if export_cache_is_valid(export_ready, export_size) {
        let export_key = format!("{storage_key}/{EXPORT_OBJECT_KEY}");
        set_thumbnail_progress(pool, file_id, 12).await;
        let file = download_source_to_temp(storage, &export_key).await?;
        set_thumbnail_progress(pool, file_id, 35).await;
        return Ok(LocalVideoSource::File(file));
    }

    set_thumbnail_progress(pool, file_id, 38).await;
    if let Ok((work_dir, mp4)) =
        materialize_hls_mp4_for_ffmpeg(storage.clone(), storage_key, segment_count).await
    {
        set_thumbnail_progress(pool, file_id, 52).await;
        return Ok(LocalVideoSource::Remuxed {
            _work_dir: work_dir,
            mp4,
        });
    }

    set_thumbnail_progress(pool, file_id, 18).await;
    run_hls_export_job(
        pool.clone(),
        storage.clone(),
        file_id.to_string(),
        storage_key.to_string(),
        segment_count,
    )
    .await;

    let refreshed: Option<(bool, Option<i64>)> =
        sqlx::query_as("SELECT download_export_ready, download_export_size_bytes FROM files WHERE id = $1")
            .bind(file_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("files export row load failed: {e}"))?;

    let Some((export_ready, export_size)) = refreshed else {
        return Err("file row not found after export".into());
    };
    if !export_cache_is_valid(export_ready, export_size) {
        return Err("video export is not ready for thumbnail regeneration".into());
    }

    let export_key = format!("{storage_key}/{EXPORT_OBJECT_KEY}");
    set_thumbnail_progress(pool, file_id, 22).await;
    let file = download_source_to_temp(storage, &export_key).await?;
    set_thumbnail_progress(pool, file_id, 35).await;
    Ok(LocalVideoSource::File(file))
}

// Human: Stream the stored video object from Nebular into a temp file for ffmpeg analysis.
// Agent: READS storage.get_stream; WRITES NamedTempFile; RETURNS handle for the duration of the job.
async fn download_source_to_temp(
    storage: Arc<dyn Storage>,
    storage_key: &str,
) -> Result<NamedTempFile, String> {
    let (mut stream, _, _) = storage
        .get_stream(storage_key)
        .await
        .map_err(|e| format!("storage download failed: {e}"))?;

    let temp = NamedTempFile::new().map_err(|e| format!("temp file create failed: {e}"))?;
    let path = temp.path().to_path_buf();
    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|e| format!("temp file open failed: {e}"))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("storage stream read failed: {e}"))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("temp file write failed: {e}"))?;
    }

    file.sync_all()
        .await
        .map_err(|e| format!("temp file flush failed: {e}"))?;

    Ok(temp)
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
