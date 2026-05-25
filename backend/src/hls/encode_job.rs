// Human: Background video HLS transcode + upload pipeline after a video file is stored.
// Agent: SPAWNS tokio task; MUTATES files.hls_* + conversion_progress; READS storage; CALLS HlsEncoder + KeyStore.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use sqlx::PgPool;

use crate::hls::key_store::KeyStore;
use crate::storage::Storage;

#[derive(Clone)]
pub struct HlsEncodeJob {
    pub file_id: String,
    pub storage_key: String,
    pub tmp_video: PathBuf,
    pub duration_seconds: i32,
}

pub async fn mark_processing(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET hls_encode_status = 'processing', hls_encode_error = NULL WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

pub async fn mark_failed(pool: &PgPool, file_id: &str, message: &str) {
    let _ = sqlx::query(
        "UPDATE files SET hls_encode_status = 'failed', hls_encode_error = $1, conversion_progress = 0 WHERE id = $2",
    )
    .bind(message)
    .bind(file_id)
    .execute(pool)
    .await;
}

// Human: Mark a video row as user-cancelled so drive UI and upload polling can stop cleanly.
// Agent: WRITES hls_encode_status=cancelled; CLEARS progress/error; NO-OP when already ready.
pub async fn mark_cancelled(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET hls_encode_status = 'cancelled', hls_encode_error = NULL, conversion_progress = 0 \
         WHERE id = $1 AND NOT hls_ready",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

// Human: True when ingest was cancelled while a worker is still winding down.
// Agent: READS files.hls_encode_status; USED before mark_processing and before marking ready.
async fn is_encode_cancelled(pool: &PgPool, file_id: &str) -> bool {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT hls_encode_status FROM files WHERE id = $1")
            .bind(file_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    row.is_some_and(|(status,)| status.as_deref() == Some("cancelled"))
}

async fn set_progress(pool: &PgPool, file_id: &str, progress: i32) {
    let _ = sqlx::query("UPDATE files SET conversion_progress = $1 WHERE id = $2")
        .bind(progress)
        .bind(file_id)
        .execute(pool)
        .await;
}

pub fn spawn_hls_encode_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    key_store: KeyStore,
    job: HlsEncodeJob,
) {
    tokio::spawn(async move {
        if let Err(e) = run_hls_encode_job(pool, storage, key_store, job).await {
            tracing::error!(error = %e, "background HLS encode failed");
        }
    });
}

pub async fn run_hls_encode_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    key_store: KeyStore,
    job: HlsEncodeJob,
) -> Result<(), String> {
    use crate::hls::encoder::HlsEncoder;
    use crate::hls::probe;

    let file_id = job.file_id.clone();
    let storage_key = job.storage_key.clone();
    let tmp_video = job.tmp_video.clone();
    // Human: Keep all scratch files under a per-file work dir — never treat OS temp root as cleanup target.
    // Agent: READS tmp_video parent when safe; WRITES hls_out under work_dir; cleanup removes work_dir only.
    let work_dir = job_work_dir(&tmp_video, &file_id);
    let hls_output_dir = work_dir.join("hls_out");

    if is_encode_cancelled(&pool, &file_id).await {
        cleanup_work_dir(&work_dir).await;
        return Ok(());
    }

    mark_processing(&pool, &file_id).await;
    set_progress(&pool, &file_id, 5).await;

    let key_result = key_store.create_key_for_file(&file_id).await;
    let (key_id, key) = match key_result {
        Ok(pair) => pair,
        Err(e) => {
            let msg = format!("create encryption key: {e}");
            mark_failed(&pool, &file_id, &msg).await;
            cleanup_work_dir(&work_dir).await;
            return Err(msg);
        }
    };

    let codec_probe = probe::probe_codecs(&tmp_video).await;
    tracing::info!(
        %file_id,
        can_remux_copy = codec_probe.can_remux_copy,
        "HLS ingest codec probe"
    );

    let (progress_tx, mut progress_rx) = tokio::sync::watch::channel(0i32);
    let pool_for_progress = pool.clone();
    let file_id_for_progress = file_id.clone();
    let progress_handle = tokio::spawn(async move {
        loop {
            let pct = *progress_rx.borrow_and_update();
            let scaled = 5 + (pct as f64 * 0.45) as i32;
            set_progress(&pool_for_progress, &file_id_for_progress, scaled).await;
            if progress_rx.changed().await.is_err() {
                break;
            }
        }
    });

    {
            let result = HlsEncoder::transcode(
                &tmp_video,
                &hls_output_dir,
                &key,
                job.duration_seconds,
                codec_probe,
                Some(progress_tx),
            )
            .await;

            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            drop(progress_handle);

            match result {
                Ok(output) => {
                    set_progress(&pool, &file_id, 50).await;
                    let prefix = format!("{storage_key}/");
                    let total_steps = 2 + output.segment_count;
                    let mut current_step = 0usize;
                    let mut stored_bytes: u64 = 0;

                    let playlist_data = match tokio::fs::read(&output.playlist_path).await {
                        Ok(data) => data,
                        Err(e) => {
                            let msg = format!("read playlist: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_work_dir(&work_dir).await;
                            return Err(msg);
                        }
                    };
                    stored_bytes += playlist_data.len() as u64;
                    if let Err(e) = storage
                        .put(
                            &format!("{prefix}stream.m3u8"),
                            "application/vnd.apple.mpegurl",
                            playlist_data,
                        )
                        .await
                    {
                        let msg = format!("upload playlist: {e}");
                        mark_failed(&pool, &file_id, &msg).await;
                        cleanup_work_dir(&work_dir).await;
                        return Err(msg);
                    }
                    current_step += 1;

                    let key_data = match tokio::fs::read(&output.key_path).await {
                        Ok(data) => data,
                        Err(e) => {
                            let msg = format!("read hls key: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_work_dir(&work_dir).await;
                            return Err(msg);
                        }
                    };
                    stored_bytes += key_data.len() as u64;
                    if let Err(e) = storage
                        .put(
                            &format!("{prefix}key.bin"),
                            "application/octet-stream",
                            key_data,
                        )
                        .await
                    {
                        let msg = format!("upload hls key: {e}");
                        mark_failed(&pool, &file_id, &msg).await;
                        cleanup_work_dir(&work_dir).await;
                        return Err(msg);
                    }
                    current_step += 1;

                    let mut segment_entries = match tokio::fs::read_dir(&output.segments_dir).await {
                        Ok(entries) => entries,
                        Err(e) => {
                            let msg = format!("read segments dir: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_work_dir(&work_dir).await;
                            return Err(msg);
                        }
                    };
                    while let Ok(Some(entry)) = segment_entries.next_entry().await {
                        let path = entry.path();
                        if path.extension().and_then(|e| e.to_str()) != Some("ts") {
                            continue;
                        }
                        let name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        let data = match tokio::fs::read(&path).await {
                            Ok(d) => d,
                            Err(e) => {
                                tracing::error!(%file_id, segment = %name, error = %e, "failed to read segment");
                                continue;
                            }
                        };
                        stored_bytes += data.len() as u64;
                        if let Err(e) = storage
                            .put(
                                &format!("{prefix}segments/{name}"),
                                "video/mp2t",
                                data,
                            )
                            .await
                        {
                            tracing::error!(%file_id, segment = %name, error = %e, "failed to upload segment");
                        }
                        current_step += 1;
                        let upload_pct =
                            50 + ((current_step as f64 / total_steps as f64) * 50.0) as i32;
                        set_progress(&pool, &file_id, upload_pct.min(99)).await;
                    }

                    set_progress(&pool, &file_id, 100).await;

                    if is_encode_cancelled(&pool, &file_id).await {
                        cleanup_work_dir(&work_dir).await;
                        return Ok(());
                    }

                    if let Err(e) = sqlx::query(
                        "UPDATE files SET hls_ready = true, hls_key_id = $1, segment_count = $2, \
                         hls_encode_status = 'ready', hls_encode_error = NULL, size_bytes = $3 WHERE id = $4",
                    )
                    .bind(key_id.to_string())
                    .bind(output.segment_count as i32)
                    .bind(stored_bytes as i64)
                    .bind(&file_id)
                    .execute(&pool)
                    .await
                    {
                        let msg = format!("update hls status: {e}");
                        mark_failed(&pool, &file_id, &msg).await;
                        cleanup_work_dir(&work_dir).await;
                        return Err(msg);
                    }

                    tracing::info!(
                        %file_id,
                        segments = output.segment_count,
                        stored_bytes,
                        "video HLS ingest complete"
                    );
                    cleanup_work_dir(&work_dir).await;
                    Ok(())
                }
                Err(e) => {
                    let msg = format!("ffmpeg transcode: {e}");
                    mark_failed(&pool, &file_id, &msg).await;
                    cleanup_work_dir(&work_dir).await;
                    Err(msg)
                }
            }
    }
}

// Human: Resolve the per-upload scratch directory used for source video + ffmpeg output.
// Agent: PREFERS tmp_video parent when it is a dedicated mediavault_upload_* dir under temp root.
fn job_work_dir(tmp_video: &Path, file_id: &str) -> PathBuf {
    if let Some(parent) = tmp_video.parent() {
        if is_deletable_work_dir(parent) {
            return parent.to_path_buf();
        }
    }
    std::env::temp_dir().join(format!("mediavault_hls_{file_id}"))
}

// Human: Guard against deleting the OS temp root (e.g. /tmp) during HLS cleanup.
// Agent: TRUE when path is strict child of std::env::temp_dir(); FALSE for temp root itself.
fn is_deletable_work_dir(path: &Path) -> bool {
    let temp_root = std::env::temp_dir();
    path.starts_with(&temp_root) && path != temp_root.as_path()
}

async fn cleanup_work_dir(work_dir: &Path) {
    if is_deletable_work_dir(work_dir) {
        let _ = tokio::fs::remove_dir_all(work_dir).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_root_is_never_deletable_work_dir() {
        assert!(!is_deletable_work_dir(std::env::temp_dir().as_path()));
    }

    #[test]
    fn dedicated_upload_dir_is_deletable() {
        let dir = std::env::temp_dir().join("mediavault_upload_test-file-id");
        assert!(is_deletable_work_dir(&dir));
    }
}
