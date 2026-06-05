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
use crate::hls::segment_upload::{
    collect_segment_sizes, plan_segment_upload, put_hls_segment_with_retry,
    verify_hls_segments_in_storage, DynamicUploadLimiter,
    SegmentUploadOutcome,
};
use crate::files::file_delete::purge_file_storage;
use crate::storage::Storage;

// Human: Throttle conversion_progress writes during parallel HLS segment PUTs.
// Agent: UPDATES files row every N segments instead of after each PUT.
const HLS_SEGMENT_PROGRESS_STEP: usize = 3;

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

// Human: Inputs for parallel HLS segment upload after ffmpeg packaging.
// Agent: PASSED to upload_hls_segments; storage_key used for post-upload verification list.
struct SegmentUploadRequest<'a> {
    pool: &'a PgPool,
    storage: Arc<dyn Storage>,
    file_id: &'a str,
    storage_key: &'a str,
    prefix: &'a str,
    segments_dir: &'a Path,
    completed_steps: usize,
    total_steps: usize,
}

// Human: Upload all fMP4 media segments (.m4s) with dynamic byte-weighted parallelism.
// Agent: PLANS from segment sizes; LIMITS in-flight bytes; SHRINKS budget on storage pressure.
async fn upload_hls_segments(
    request: SegmentUploadRequest<'_>,
) -> Result<SegmentUploadOutcome, String> {
    let SegmentUploadRequest {
        pool,
        storage,
        file_id,
        storage_key,
        prefix,
        segments_dir,
        completed_steps,
        total_steps,
    } = request;

    let segments = collect_segment_sizes(segments_dir, HLS_SEGMENT_EXTENSION)
        .await
        .map_err(|error| format!("read HLS segments directory: {error}"))?;

    let expected = segments.len();
    if expected == 0 {
        return Err("no HLS segments were produced".to_string());
    }

    let sizes: Vec<u64> = segments.iter().map(|(_, _, size)| *size).collect();
    let plan = plan_segment_upload(&sizes);
    tracing::info!(
        %file_id,
        segments = plan.segment_count,
        parallel_hint = plan.parallel_hint,
        max_segment_mb = plan.max_segment_bytes / (1024 * 1024),
        p95_segment_mb = plan.p95_segment_bytes / (1024 * 1024),
        total_permits = plan.total_permits,
        max_in_flight_mb = crate::hls::segment_upload::HLS_UPLOAD_MAX_IN_FLIGHT_BYTES / (1024 * 1024),
        "HLS segment upload plan"
    );

    let limiter = Arc::new(DynamicUploadLimiter::from_plan(&plan));
    let parallel_gate = Arc::new(tokio::sync::Semaphore::new(plan.parallel_hint));
    let completed = Arc::new(AtomicUsize::new(completed_steps));
    let stored_bytes = Arc::new(AtomicU64::new(0));
    let uploaded_count = Arc::new(AtomicUsize::new(0));
    let failed_count = Arc::new(AtomicUsize::new(0));
    let mut tasks = JoinSet::new();

    for (name, path, size_bytes) in segments {
        let parallel_permit = match parallel_gate.clone().acquire_owned().await {
            Ok(permit) => permit,
            Err(error) => {
                tracing::error!(%file_id, %error, "failed to acquire parallel upload slot");
                break;
            }
        };

        let storage = storage.clone();
        let prefix = prefix.to_string();
        let file_id = file_id.to_string();
        let pool = pool.clone();
        let completed = completed.clone();
        let stored_bytes = stored_bytes.clone();
        let uploaded_count = uploaded_count.clone();
        let failed_count = failed_count.clone();
        let limiter = limiter.clone();

        tasks.spawn(async move {
            let _parallel_permit = parallel_permit;
            if is_encode_cancelled(&pool, &file_id).await {
                return;
            }
            let byte_permit = match limiter.acquire_for_segment(size_bytes).await {
                Ok(permit) => permit,
                Err(error) => {
                    tracing::error!(%file_id, segment = %name, %error, "failed to acquire byte upload budget");
                    failed_count.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            };
            let _byte_permit = byte_permit;
            let object_key = format!("{prefix}segments/{name}");
            match put_hls_segment_with_retry(
                storage.as_ref(),
                &object_key,
                &path,
                limiter.as_ref(),
            )
            .await
            {
                Ok(len) => {
                    stored_bytes.fetch_add(len, Ordering::Relaxed);
                    uploaded_count.fetch_add(1, Ordering::Relaxed);
                    let step = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    if step == 1
                        || step.is_multiple_of(HLS_SEGMENT_PROGRESS_STEP)
                        || step == total_steps
                    {
                        let upload_pct = 50 + ((step as f64 / total_steps as f64) * 50.0) as i32;
                        set_progress(&pool, &file_id, upload_pct.min(99)).await;
                    }
                }
                Err(error) => {
                    failed_count.fetch_add(1, Ordering::Relaxed);
                    tracing::error!(%file_id, segment = %name, %error, "failed to upload segment");
                }
            }
        });
    }

    while tasks.join_next().await.is_some() {
        if is_encode_cancelled(pool, file_id).await {
            break;
        }
    }

    let uploaded = uploaded_count.load(Ordering::Relaxed);
    let failed = failed_count.load(Ordering::Relaxed);
    let bytes = stored_bytes.load(Ordering::Relaxed);
    let outcome = SegmentUploadOutcome {
        expected,
        uploaded,
        failed,
        bytes,
    };

    verify_hls_segments_in_storage(storage.as_ref(), storage_key, outcome).await
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

                    let (playlist_data, key_data, init_data) = match tokio::try_join!(
                        tokio::fs::read(&output.playlist_path),
                        tokio::fs::read(&output.key_path),
                        tokio::fs::read(&output.init_path),
                    ) {
                        Ok(parts) => parts,
                        Err(e) => {
                            let msg = format!("read HLS manifest artifacts: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_work_dir(&work_dir).await;
                            return Err(msg);
                        }
                    };
                    stored_bytes += (playlist_data.len() + key_data.len() + init_data.len()) as u64;

                    let playlist_key = format!("{prefix}stream.m3u8");
                    let key_object_key = format!("{prefix}key.bin");
                    let init_object_key = format!("{prefix}{HLS_INIT_FILENAME}");
                    let storage_for_manifest = storage.clone();

                    let manifest_upload = tokio::try_join!(
                        storage_for_manifest.put(
                            &playlist_key,
                            "application/vnd.apple.mpegurl",
                            playlist_data,
                        ),
                        storage_for_manifest.put(
                            &key_object_key,
                            "application/octet-stream",
                            key_data,
                        ),
                        storage_for_manifest.put(&init_object_key, "video/mp4", init_data),
                    );

                    if let Err(e) = manifest_upload {
                        let msg = format!("upload HLS manifest artifacts: {e}");
                        mark_failed(&pool, &file_id, &msg).await;
                        discard_hls_output(&hls_output_dir).await;
                        return Err(msg);
                    }
                    current_step += 3;

                    let segment_outcome = match upload_hls_segments(SegmentUploadRequest {
                        pool: &pool,
                        storage: storage.clone(),
                        file_id: &file_id,
                        storage_key: &storage_key,
                        prefix: &prefix,
                        segments_dir: &output.segments_dir,
                        completed_steps: current_step,
                        total_steps,
                    })
                    .await
                    {
                        Ok(outcome) => outcome,
                        Err(msg) => {
                            tracing::error!(
                                %file_id,
                                segments = output.segment_count,
                                error = %msg,
                                "HLS segment upload incomplete"
                            );
                            mark_failed(&pool, &file_id, &msg).await;
                            purge_file_storage(
                                storage.clone(),
                                &storage_key,
                                Some(output.segment_count as i32),
                            )
                            .await;
                            discard_hls_output(&hls_output_dir).await;
                            return Err(msg);
                        }
                    };
                    stored_bytes += segment_outcome.bytes;

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
                        uploaded_segments = segment_outcome.uploaded,
                        "video HLS ingest complete"
                    );
                    cleanup_work_dir(&work_dir).await;
                    Ok(())
                }
                Err(e) => {
                    let msg = format!("ffmpeg transcode: {e}");
                    mark_failed(&pool, &file_id, &msg).await;
                    discard_hls_output(&hls_output_dir).await;
                    Err(msg)
                }
            }
    }
}

// Human: Resolve the per-upload scratch directory used for source video + ffmpeg output.
// Agent: PREFERS tmp_video parent when it is a dedicated ownly_upload_* dir under temp root.
fn job_work_dir(tmp_video: &Path, file_id: &str) -> PathBuf {
    if let Some(parent) = tmp_video.parent() {
        if is_deletable_work_dir(parent) {
            return parent.to_path_buf();
        }
    }
    std::env::temp_dir().join(format!("ownly_hls_{file_id}"))
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

// Human: Drop partial ffmpeg output while keeping the upload source for background job retries.
// Agent: REMOVES hls_out only; PRESERVES tmp_video under work_dir for attempt 2+.
async fn discard_hls_output(hls_output_dir: &Path) {
    let _ = tokio::fs::remove_dir_all(hls_output_dir).await;
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
        let dir = std::env::temp_dir().join("ownly_upload_test-file-id");
        assert!(is_deletable_work_dir(&dir));
    }

}
