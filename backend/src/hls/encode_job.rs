// Human: Background video HLS transcode + upload pipeline after a video file is stored.
// Agent: SPAWNS tokio task; MUTATES files.hls_* + conversion_progress; READS storage; CALLS HlsEncoder + KeyStore.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use sqlx::PgPool;
use tokio::task::JoinSet;

use crate::hls::hardware::HlsHardwareEncode;
use crate::hls::key_store::KeyStore;
use crate::hls::playlist::{HLS_INIT_FILENAME, HLS_SEGMENT_EXTENSION};
use crate::files::file_delete::purge_file_storage;
use crate::storage::Storage;

// Human: Cap concurrent Nebular PUTs during HLS segment upload — balances throughput vs connection load.
// Agent: USED by upload_hls_segments; TUNABLE constant (8–16 typical).
const HLS_SEGMENT_UPLOAD_CONCURRENCY: usize = 12;

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

// Human: Probe duration in the worker when upload spooled the file without blocking on ffprobe.
// Agent: READS tmp_video via ffprobe when payload duration is 0; WRITES files.duration_seconds.
async fn resolve_duration_seconds(
    pool: &PgPool,
    file_id: &str,
    tmp_video: &Path,
    payload_duration: i32,
) -> i32 {
    if payload_duration > 0 {
        return payload_duration;
    }

    let probed = crate::hls::probe::probe_duration_seconds(tmp_video).await;
    let _ = sqlx::query("UPDATE files SET duration_seconds = $1 WHERE id = $2")
        .bind(probed)
        .bind(file_id)
        .execute(pool)
        .await;
    probed
}

// Human: Upload all fMP4 media segments (.m4s) to object storage with bounded parallelism.
// Agent: READS segments_dir; SPAWNS up to HLS_SEGMENT_UPLOAD_CONCURRENCY puts; RETURNS segment byte sum.
async fn upload_hls_segments(
    pool: &PgPool,
    storage: Arc<dyn Storage>,
    file_id: &str,
    prefix: &str,
    segments_dir: &Path,
    completed_steps: usize,
    total_steps: usize,
) -> u64 {
    let mut segment_paths: Vec<(String, PathBuf)> = Vec::new();
    let mut entries = match tokio::fs::read_dir(segments_dir).await {
        Ok(entries) => entries,
        Err(error) => {
            tracing::error!(%file_id, %error, "failed to read HLS segments directory");
            return 0;
        }
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some(HLS_SEGMENT_EXTENSION) {
            continue;
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        segment_paths.push((name, path));
    }
    segment_paths.sort_by(|left, right| left.0.cmp(&right.0));

    let semaphore = Arc::new(tokio::sync::Semaphore::new(HLS_SEGMENT_UPLOAD_CONCURRENCY));
    let completed = Arc::new(AtomicUsize::new(completed_steps));
    let stored_bytes = Arc::new(AtomicU64::new(0));
    let mut tasks = JoinSet::new();

    for (name, path) in segment_paths {
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(permit) => permit,
            Err(error) => {
                tracing::error!(%file_id, %error, "failed to acquire segment upload permit");
                break;
            }
        };

        let storage = storage.clone();
        let prefix = prefix.to_string();
        let file_id = file_id.to_string();
        let pool = pool.clone();
        let completed = completed.clone();
        let stored_bytes = stored_bytes.clone();

        tasks.spawn(async move {
            let _permit = permit;
            if is_encode_cancelled(&pool, &file_id).await {
                return;
            }
            let data = match tokio::fs::read(&path).await {
                Ok(data) => data,
                Err(error) => {
                    tracing::error!(%file_id, segment = %name, %error, "failed to read segment");
                    return;
                }
            };
            let len = data.len() as u64;
            if let Err(error) = storage
                .put(
                    &format!("{prefix}segments/{name}"),
                    "video/mp4",
                    data,
                )
                .await
            {
                tracing::error!(%file_id, segment = %name, %error, "failed to upload segment");
                return;
            }

            stored_bytes.fetch_add(len, Ordering::Relaxed);
            let step = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let upload_pct = 50 + ((step as f64 / total_steps as f64) * 50.0) as i32;
            set_progress(&pool, &file_id, upload_pct.min(99)).await;
        });
    }

    while tasks.join_next().await.is_some() {
        if is_encode_cancelled(pool, file_id).await {
            break;
        }
    }

    stored_bytes.load(Ordering::Relaxed)
}

pub fn spawn_hls_encode_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    key_store: KeyStore,
    hardware: HlsHardwareEncode,
    job: HlsEncodeJob,
) {
    tokio::spawn(async move {
        if let Err(e) = run_hls_encode_job(pool, storage, key_store, hardware, job).await {
            tracing::error!(error = %e, "background HLS encode failed");
        }
    });
}

pub async fn run_hls_encode_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    key_store: KeyStore,
    hardware: HlsHardwareEncode,
    job: HlsEncodeJob,
) -> Result<(), String> {
    use crate::hls::encoder::{HlsEncodeTiming, HlsEncoder};
    use crate::hls::probe;

    let file_id = job.file_id.clone();
    let storage_key = job.storage_key.clone();
    let tmp_video = job.tmp_video.clone();
    // Human: Keep all scratch files under a per-file work dir — never treat OS temp root as cleanup target.
    // Agent: READS tmp_video parent when safe; WRITES hls_out under work_dir; cleanup removes work_dir only.
    let work_dir = job_work_dir(&tmp_video, &file_id);
    let hls_output_dir = work_dir.join("hls_out");

    if is_encode_cancelled(&pool, &file_id).await {
        cleanup_cancelled_encode(storage, &storage_key, None, &work_dir).await;
        return Ok(());
    }

    mark_processing(&pool, &file_id).await;
    set_progress(&pool, &file_id, 5).await;

    let key_result = key_store.get_or_create_key_for_file(&file_id).await;
    let (key_id, key) = match key_result {
        Ok(pair) => pair,
        Err(e) => {
            let msg = format!("create encryption key: {e}");
            mark_failed(&pool, &file_id, &msg).await;
            cleanup_work_dir(&work_dir).await;
            return Err(msg);
        }
    };

    let duration_seconds =
        resolve_duration_seconds(&pool, &file_id, &tmp_video, job.duration_seconds).await;

    let codec_probe = probe::probe_codecs(&tmp_video).await;
    let source_size_bytes = tokio::fs::metadata(&tmp_video)
        .await
        .map(|meta| meta.len())
        .unwrap_or(0);
    let segment_target_secs = crate::hls::playlist::hls_segment_target_secs(source_size_bytes);
    tracing::info!(
        %file_id,
        video_codec = ?codec_probe.video_codec,
        audio_codec = ?codec_probe.audio_codec,
        avg_frame_rate = ?codec_probe.avg_frame_rate,
        encode_mode = ?codec_probe.encode_mode,
        video_encoder = ?hardware.resolved,
        duration_seconds,
        source_size_bytes,
        segment_target_secs,
        "HLS ingest starting ffmpeg"
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
                HlsEncodeTiming {
                    duration_seconds,
                    segment_target_secs,
                },
                codec_probe,
                &hardware,
                Some(progress_tx),
            )
            .await;

            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            drop(progress_handle);

            match result {
                Ok(output) => {
                    set_progress(&pool, &file_id, 50).await;
                    let prefix = format!("{storage_key}/");
                    let total_steps = 3 + output.segment_count;
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

                    let init_data = match tokio::fs::read(&output.init_path).await {
                        Ok(data) => data,
                        Err(e) => {
                            let msg = format!("read hls init: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_work_dir(&work_dir).await;
                            return Err(msg);
                        }
                    };
                    stored_bytes += init_data.len() as u64;
                    if let Err(e) = storage
                        .put(
                            &format!("{prefix}{HLS_INIT_FILENAME}"),
                            "video/mp4",
                            init_data,
                        )
                        .await
                    {
                        let msg = format!("upload hls init: {e}");
                        mark_failed(&pool, &file_id, &msg).await;
                        cleanup_work_dir(&work_dir).await;
                        return Err(msg);
                    }
                    current_step += 1;

                    let segment_bytes = upload_hls_segments(
                        &pool,
                        storage.clone(),
                        &file_id,
                        &prefix,
                        &output.segments_dir,
                        current_step,
                        total_steps,
                    )
                    .await;
                    stored_bytes += segment_bytes;

                    set_progress(&pool, &file_id, 100).await;

                    if is_encode_cancelled(&pool, &file_id).await {
                        cleanup_cancelled_encode(
                            storage,
                            &storage_key,
                            Some(output.segment_count as i32),
                            &work_dir,
                        )
                        .await;
                        return Ok(());
                    }

                    if let Err(e) = sqlx::query(
                        "UPDATE files SET hls_ready = true, hls_key_id = $1, segment_count = $2, \
                         hls_encode_status = 'ready', hls_encode_error = NULL WHERE id = $3",
                    )
                    .bind(key_id.to_string())
                    .bind(output.segment_count as i32)
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
                    // Human: Keep upload `source` for job retries — only drop partial ffmpeg output.
                    // Agent: AVOIDS remove_dir_all(work_dir) so attempt 2+ still finds tmp_video.
                    let _ = tokio::fs::remove_dir_all(&hls_output_dir).await;
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

async fn cleanup_cancelled_encode(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    work_dir: &Path,
) {
    purge_file_storage(storage, storage_key, segment_count).await;
    cleanup_work_dir(work_dir).await;
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
