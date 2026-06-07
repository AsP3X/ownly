// Human: Restart processing jobs that sat in the queue too long or lost their background worker row.
// Agent: READS stale background_jobs + files ingest columns; WRITES refreshed payloads; CALLS enqueue_job.

use std::path::{Path, PathBuf};

use sqlx::PgPool;

use crate::error::AppError;

use super::model::{
    AudioWaveformPayload, BackgroundJob, HlsEncodePayload, ImageThumbnailPayload, JobKind,
    VideoThumbnailPayload,
};
use super::store::enqueue_job;

/// Human: Run queued-job restart plus orphaned ingest re-enqueue in one periodic sweep.
// Agent: CALLS recover_stale_queued_jobs then recover_orphaned_ingest_jobs; RETURNS (queued, orphans).
pub async fn recover_stuck_processing_jobs(
    pool: &PgPool,
    stale_minutes: i64,
) -> Result<(u64, u64), AppError> {
    let queued = recover_stale_queued_jobs(pool, stale_minutes).await?;
    let orphans = recover_orphaned_ingest_jobs(pool, stale_minutes).await?;
    Ok((queued, orphans))
}

/// Human: Restart queued jobs that waited longer than the stale threshold without being claimed.
// Agent: READS stale queued rows; REFRESHES ingest payloads; BUMPS created_at to queue front; RESETS progress.
pub async fn recover_stale_queued_jobs(pool: &PgPool, stale_minutes: i64) -> Result<u64, AppError> {
    let stale_minutes = stale_minutes.clamp(1, i64::from(i32::MAX)) as i32;
    let rows = sqlx::query_as::<_, BackgroundJob>(
        "SELECT id, user_id, kind, status, progress, error, payload, resource_type, resource_id, label, \
         locked_by, locked_at, attempts, max_attempts, created_at, updated_at, completed_at \
         FROM background_jobs \
         WHERE status = 'queued' \
           AND created_at < now() - ($1::int * INTERVAL '1 minute')",
    )
    .bind(stale_minutes)
    .fetch_all(pool)
    .await?;

    let mut restarted = 0u64;
    for job in rows {
        let refreshed_payload = refresh_queued_job_payload(&job);
        let result = sqlx::query(
            "UPDATE background_jobs SET \
                progress = 0, \
                updated_at = now(), \
                created_at = ( \
                    SELECT COALESCE(MIN(b.created_at), now()) - INTERVAL '1 second' \
                    FROM background_jobs b WHERE b.status = 'queued' \
                ), \
                payload = $2, \
                error = COALESCE(error, 'restarted after prolonged queue wait') \
             WHERE id = $1 AND status = 'queued'",
        )
        .bind(&job.id)
        .bind(refreshed_payload)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            restarted += 1;
            tracing::warn!(
                job_id = %job.id,
                kind = %job.kind,
                stale_minutes,
                "restarted background job that waited too long in queue"
            );
        }
    }

    Ok(restarted)
}

/// Human: Re-enqueue ingest work when the files row is still processing but no worker owns the job.
// Agent: READS files without active background_jobs; CALLS enqueue_job; SKIPS video HLS when spool is gone.
async fn recover_orphaned_ingest_jobs(pool: &PgPool, stale_minutes: i64) -> Result<u64, AppError> {
    let stale_minutes = stale_minutes.clamp(1, i64::from(i32::MAX)) as i32;
    let mut restarted = 0u64;

    restarted += recover_orphaned_hls_encodes(pool, stale_minutes).await?;
    restarted += recover_orphaned_audio_waveforms(pool, stale_minutes).await?;
    restarted += recover_orphaned_image_thumbnails(pool, stale_minutes).await?;
    restarted += recover_orphaned_video_thumbnails(pool, stale_minutes).await?;

    Ok(restarted)
}

// Human: Shared guard — skip files that already have a queued/running job or a recent failure.
// Agent: NOT EXISTS active job; NOT EXISTS failed job updated within stale window.
const INGEST_ORPHAN_GUARD: &str = "
    AND NOT EXISTS (
        SELECT 1 FROM background_jobs j
        WHERE j.kind = $2 AND j.resource_type = 'file' AND j.resource_id = f.id
          AND j.status IN ('queued', 'running')
    )
    AND NOT EXISTS (
        SELECT 1 FROM background_jobs j
        WHERE j.kind = $2 AND j.resource_type = 'file' AND j.resource_id = f.id
          AND j.status = 'failed'
          AND j.updated_at > now() - ($1::int * INTERVAL '1 minute')
    )
";

async fn recover_orphaned_hls_encodes(pool: &PgPool, stale_minutes: i32) -> Result<u64, AppError> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(&format!(
        "SELECT f.id, f.user_id, f.name \
         FROM files f \
         WHERE f.mime_type LIKE 'video/%' \
           AND NOT f.hls_ready \
           AND f.deleted_at IS NULL \
           AND COALESCE(f.hls_encode_status, 'queued') IN ('queued', 'processing') \
           AND f.created_at < now() - ($1::int * INTERVAL '1 minute') \
           {INGEST_ORPHAN_GUARD}"
    ))
    .bind(stale_minutes)
    .bind(JobKind::HlsEncode.as_str())
    .fetch_all(pool)
    .await?;

    let mut restarted = 0u64;
    for (file_id, user_id, name) in rows {
        let storage_key = format!("users/{user_id}/files/{file_id}");
        let spool_path = upload_spool_source_path(&file_id);
        if tokio::fs::metadata(&spool_path).await.is_err() {
            let message = "upload source is no longer available; re-upload the video to finish processing";
            sqlx::query(
                "UPDATE files SET hls_encode_status = 'failed', hls_encode_error = $1, conversion_progress = 0 \
                 WHERE id = $2 AND NOT hls_ready",
            )
            .bind(message)
            .bind(&file_id)
            .execute(pool)
            .await?;
            tracing::warn!(
                file_id = %file_id,
                "skipped orphaned HLS re-enqueue because upload spool is missing"
            );
            continue;
        }

        sqlx::query(
            "UPDATE files SET hls_encode_status = 'queued', hls_encode_error = NULL, conversion_progress = 0 \
             WHERE id = $1 AND NOT hls_ready",
        )
        .bind(&file_id)
        .execute(pool)
        .await?;

        let payload = HlsEncodePayload {
            file_id: file_id.clone(),
            storage_key,
            tmp_video: spool_path.to_string_lossy().to_string(),
            duration_seconds: 0,
        };

        enqueue_job(
            pool,
            &user_id,
            JobKind::HlsEncode,
            &name,
            Some("file"),
            Some(&file_id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("hls_encode payload: {e}")))?,
        )
        .await?;

        restarted += 1;
        tracing::warn!(
            file_id = %file_id,
            kind = JobKind::HlsEncode.as_str(),
            "re-enqueued orphaned video HLS ingest job"
        );
    }

    Ok(restarted)
}

async fn recover_orphaned_audio_waveforms(pool: &PgPool, stale_minutes: i32) -> Result<u64, AppError> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(&format!(
        "SELECT f.id, f.user_id, f.name, f.storage_key \
         FROM files f \
         WHERE f.mime_type LIKE 'audio/%' \
           AND NOT f.audio_waveform_ready \
           AND f.deleted_at IS NULL \
           AND COALESCE(f.audio_encode_status, 'queued') IN ('queued', 'processing') \
           AND f.created_at < now() - ($1::int * INTERVAL '1 minute') \
           {INGEST_ORPHAN_GUARD}"
    ))
    .bind(stale_minutes)
    .bind(JobKind::AudioWaveform.as_str())
    .fetch_all(pool)
    .await?;

    let mut restarted = 0u64;
    for (file_id, user_id, name, storage_key) in rows {
        sqlx::query(
            "UPDATE files SET audio_encode_status = 'queued', audio_encode_error = NULL, conversion_progress = 0 \
             WHERE id = $1 AND NOT audio_waveform_ready",
        )
        .bind(&file_id)
        .execute(pool)
        .await?;

        let payload = AudioWaveformPayload {
            file_id: file_id.clone(),
            storage_key,
            tmp_audio: None,
        };

        enqueue_job(
            pool,
            &user_id,
            JobKind::AudioWaveform,
            &name,
            Some("file"),
            Some(&file_id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("audio_waveform payload: {e}")))?,
        )
        .await?;

        restarted += 1;
        tracing::warn!(
            file_id = %file_id,
            kind = JobKind::AudioWaveform.as_str(),
            "re-enqueued orphaned audio waveform job"
        );
    }

    Ok(restarted)
}

async fn recover_orphaned_image_thumbnails(pool: &PgPool, stale_minutes: i32) -> Result<u64, AppError> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(&format!(
        "SELECT f.id, f.user_id, f.name, f.storage_key \
         FROM files f \
         WHERE f.mime_type LIKE 'image/%' \
           AND NOT f.image_thumbnail_ready \
           AND f.deleted_at IS NULL \
           AND COALESCE(f.image_thumbnail_status, 'queued') IN ('queued', 'processing') \
           AND f.created_at < now() - ($1::int * INTERVAL '1 minute') \
           {INGEST_ORPHAN_GUARD}"
    ))
    .bind(stale_minutes)
    .bind(JobKind::ImageThumbnail.as_str())
    .fetch_all(pool)
    .await?;

    let mut restarted = 0u64;
    for (file_id, user_id, name, storage_key) in rows {
        sqlx::query(
            "UPDATE files SET image_thumbnail_status = 'queued', image_thumbnail_error = NULL \
             WHERE id = $1 AND NOT image_thumbnail_ready",
        )
        .bind(&file_id)
        .execute(pool)
        .await?;

        let payload = ImageThumbnailPayload {
            file_id: file_id.clone(),
            storage_key,
            tmp_source: None,
        };

        enqueue_job(
            pool,
            &user_id,
            JobKind::ImageThumbnail,
            &name,
            Some("file"),
            Some(&file_id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("image_thumbnail payload: {e}")))?,
        )
        .await?;

        restarted += 1;
        tracing::warn!(
            file_id = %file_id,
            kind = JobKind::ImageThumbnail.as_str(),
            "re-enqueued orphaned image thumbnail job"
        );
    }

    Ok(restarted)
}

async fn recover_orphaned_video_thumbnails(pool: &PgPool, stale_minutes: i32) -> Result<u64, AppError> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(&format!(
        "SELECT f.id, f.user_id, f.name, f.storage_key \
         FROM files f \
         WHERE f.mime_type LIKE 'video/%' \
           AND NOT f.video_thumbnail_ready \
           AND f.deleted_at IS NULL \
           AND COALESCE(f.video_thumbnail_status, 'queued') IN ('queued', 'processing') \
           AND f.created_at < now() - ($1::int * INTERVAL '1 minute') \
           {INGEST_ORPHAN_GUARD}"
    ))
    .bind(stale_minutes)
    .bind(JobKind::VideoThumbnail.as_str())
    .fetch_all(pool)
    .await?;

    let mut restarted = 0u64;
    for (file_id, user_id, name, storage_key) in rows {
        sqlx::query(
            "UPDATE files SET video_thumbnail_status = 'queued', video_thumbnail_error = NULL, \
             video_thumbnail_progress = 0 WHERE id = $1 AND NOT video_thumbnail_ready",
        )
        .bind(&file_id)
        .execute(pool)
        .await?;

        let payload = VideoThumbnailPayload {
            file_id: file_id.clone(),
            storage_key,
            tmp_video: None,
        };

        enqueue_job(
            pool,
            &user_id,
            JobKind::VideoThumbnail,
            &name,
            Some("file"),
            Some(&file_id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("video_thumbnail payload: {e}")))?,
        )
        .await?;

        restarted += 1;
        tracing::warn!(
            file_id = %file_id,
            kind = JobKind::VideoThumbnail.as_str(),
            "re-enqueued orphaned video thumbnail job"
        );
    }

    Ok(restarted)
}

/// Human: Refresh ingest payloads before restarting a job that waited in queued too long.
// Agent: STRIPS stale upload spool paths; REWRITES HLS tmp_video when canonical spool still exists.
pub fn refresh_queued_job_payload(job: &BackgroundJob) -> serde_json::Value {
    let kind = match JobKind::parse(&job.kind) {
        Some(kind) => kind,
        None => return job.payload.clone(),
    };

    match kind {
        JobKind::HlsEncode => refresh_hls_encode_payload(&job.payload),
        JobKind::AudioWaveform => refresh_optional_spool_payload::<AudioWaveformPayload>(
            &job.payload,
            |payload| payload.tmp_audio = None,
        ),
        JobKind::ImageThumbnail => refresh_optional_spool_payload::<ImageThumbnailPayload>(
            &job.payload,
            |payload| payload.tmp_source = None,
        ),
        JobKind::VideoThumbnail => refresh_optional_spool_payload::<VideoThumbnailPayload>(
            &job.payload,
            |payload| payload.tmp_video = None,
        ),
        JobKind::HlsExport | JobKind::ZipBulk | JobKind::ZipFolder => job.payload.clone(),
    }
}

fn refresh_hls_encode_payload(payload: &serde_json::Value) -> serde_json::Value {
    let Ok(mut parsed) = serde_json::from_value::<HlsEncodePayload>(payload.clone()) else {
        return payload.clone();
    };

    let canonical = upload_spool_source_path(&parsed.file_id);
    if tokio_fs_exists(&canonical) {
        parsed.tmp_video = canonical.to_string_lossy().to_string();
        return serde_json::to_value(parsed).unwrap_or_else(|_| payload.clone());
    }

    if tokio_fs_exists(Path::new(&parsed.tmp_video)) {
        return payload.clone();
    }

    serde_json::to_value(parsed).unwrap_or_else(|_| payload.clone())
}

fn refresh_optional_spool_payload<T>(
    payload: &serde_json::Value,
    clear_spool: impl FnOnce(&mut T),
) -> serde_json::Value
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let Ok(mut parsed) = serde_json::from_value::<T>(payload.clone()) else {
        return payload.clone();
    };
    clear_spool(&mut parsed);
    serde_json::to_value(parsed).unwrap_or_else(|_| payload.clone())
}

/// Human: Canonical upload spool path for a file id (`ownly_upload_<id>/source` under OS temp).
// Agent: READ by HLS restart paths; MATCHES files.handlers upload work_dir layout.
pub fn upload_spool_source_path(file_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join(format!("ownly_upload_{file_id}"))
        .join("source")
}

fn tokio_fs_exists(path: &Path) -> bool {
    std::fs::metadata(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::model::JobStatus;

    #[test]
    fn upload_spool_path_matches_upload_handler_layout() {
        let path = upload_spool_source_path("abc-123");
        assert!(path.to_string_lossy().contains("ownly_upload_abc-123"));
        assert_eq!(path.file_name().and_then(|n| n.to_str()), Some("source"));
    }

    #[test]
    fn refresh_audio_payload_strips_tmp_spool() {
        let payload = serde_json::json!({
            "file_id": "f1",
            "storage_key": "users/u/files/f1",
            "tmp_audio": "/tmp/ownly_upload_f1/source"
        });
        let job = BackgroundJob {
            id: "j1".into(),
            user_id: "u".into(),
            kind: JobKind::AudioWaveform.as_str().into(),
            status: JobStatus::Queued.as_str().into(),
            progress: 0,
            error: None,
            payload: payload.clone(),
            resource_type: Some("file".into()),
            resource_id: Some("f1".into()),
            label: "song.mp3".into(),
            locked_by: None,
            locked_at: None,
            attempts: 0,
            max_attempts: 3,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            completed_at: None,
        };

        let refreshed = refresh_queued_job_payload(&job);
        let parsed: AudioWaveformPayload = serde_json::from_value(refreshed).expect("payload");
        assert!(parsed.tmp_audio.is_none());
    }
}
