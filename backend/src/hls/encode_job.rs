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

/// Human: Original upload bytes retained beside HLS for clean reprocess (not a second-gen remux).
// Agent: OBJECT key under `{storage_key}/source.master`; NO LONGER written on first ingest.
pub const SOURCE_MASTER_OBJECT: &str = "source.master";

// Human: First ingest used to PUT a full-size source.master next to HLS — a hidden second copy.
// Agent: FALSE so new uploads keep only the HLS package; existing masters still load for reprocess.
pub fn persist_source_master_after_ingest() -> bool {
    false
}

/// Human: Cached download remux built on first download of an HLS-stored video.
// Agent: OBJECT key under `{storage_key}/export.mp4`. Private copies of this literal also live in
//        files/{file_delete,handlers,zip_job}.rs — prefer this one for new call sites.
pub const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

/// Human: User-visible error when the upload spool was removed before HLS could start.
// Agent: WRITTEN to files.hls_encode_error; MATCHED by is_permanent_encode_failure for job finalization.
pub const HLS_SOURCE_UNAVAILABLE: &str =
    "upload source is no longer available; re-upload the video to finish processing";

// Human: Nebular key for the retained original video master used by reprocess.
// Agent: FORMAT `{storage_key}/source.master`.
pub fn source_master_storage_key(storage_key: &str) -> String {
    format!("{storage_key}/{SOURCE_MASTER_OBJECT}")
}

// Human: True when an HLS encode failure should not be retried (missing upload spool).
// Agent: READ by jobs executor; CALLS fail_job_permanent instead of fail_job.
pub fn is_permanent_encode_failure(message: &str) -> bool {
    message == HLS_SOURCE_UNAVAILABLE
}

#[derive(Clone)]
pub struct HlsEncodeJob {
    pub file_id: String,
    pub storage_key: String,
    /// Human: Upload spool when still on disk; None remuxes existing HLS for reprocess.
    pub tmp_video: Option<PathBuf>,
    pub duration_seconds: i32,
}

// Human: Local ffmpeg input — upload spool, retained master, or remuxed HLS held for the job lifetime.
// Agent: Materialized/Master TempDir must outlive ffmpeg; dropped after cleanup_work_dir.
enum EncodeVideoSource {
    /// Human: Fresh upload spool — should be persisted as source.master after success.
    Spool(PathBuf),
    /// Human: Retained original from object storage (best reprocess quality).
    Master {
        _temp: tempfile::NamedTempFile,
        path: PathBuf,
    },
    /// Human: Last-resort remux of encrypted HLS segments (second generation).
    Materialized {
        _work_dir: tempfile::TempDir,
        path: PathBuf,
    },
}

impl EncodeVideoSource {
    fn path(&self) -> &Path {
        match self {
            Self::Spool(path) => path.as_path(),
            Self::Master { path, .. } => path.as_path(),
            Self::Materialized { path, .. } => path.as_path(),
        }
    }

    fn is_spool(&self) -> bool {
        matches!(self, Self::Spool(_))
    }
}

pub async fn mark_processing(pool: &PgPool, file_id: &str) {
    // Human: Reprocess (prior segments) uses reprocessing status so the grid can say "Rebuilding stream".
    // Agent: READS segment_count; WRITES reprocessing when segments already exist, else processing.
    let prior: Option<(Option<i32>,)> =
        sqlx::query_as("SELECT segment_count FROM files WHERE id = $1")
            .bind(file_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);
    let status = if prior.and_then(|(c,)| c).unwrap_or(0) > 0 {
        "reprocessing"
    } else {
        "processing"
    };
    let _ = sqlx::query(
        "UPDATE files SET hls_encode_status = $1, hls_encode_error = NULL WHERE id = $2",
    )
    .bind(status)
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

// Human: Persist intrinsic video dimensions so the player can pick shells before stream metadata loads.
// Agent: READS ffprobe width/height; WRITES files.video_width/video_height when probe succeeds.
async fn resolve_video_dimensions(pool: &PgPool, file_id: &str, tmp_video: &Path) {
    let Some(dimensions) = crate::hls::probe::probe_video_dimensions(tmp_video).await else {
        return;
    };
    let _ = sqlx::query(
        "UPDATE files SET video_width = $1, video_height = $2 WHERE id = $3",
    )
    .bind(dimensions.width)
    .bind(dimensions.height)
    .bind(file_id)
    .execute(pool)
    .await;
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
    // Human: Prefer upload spool; fall back to remuxing stored HLS when reprocessing ready videos.
    // Agent: READS spool path or materialize_hls_mp4_for_ffmpeg; HOLDS Materialized TempDir for job.
    let prior_segment_count = load_prior_segment_count(&pool, &file_id).await;
    // Human: Reprocess has no spool — source download can take a while before ffmpeg; show early %.
    // Agent: tmp_video=None means remux/master path; SET conversion_progress=1 so grid/tray leave 0%.
    if job.tmp_video.is_none() {
        set_progress(&pool, &file_id, 1).await;
    }
    let source = match resolve_encode_video_source(
        &pool,
        storage.clone(),
        &key_store,
        &file_id,
        &storage_key,
        job.tmp_video.as_deref(),
        prior_segment_count,
    )
    .await
    {
        Ok(source) => source,
        Err(msg) => {
            // Human: Rebuild without a usable input must not leave the video unplayable when media still exists.
            // Agent: RESTORE only if segment 0 is still in storage; ELSE mark_failed with re-upload guidance.
            if prior_segment_count.unwrap_or(0) > 0 {
                let detail = format!("Stream rebuild failed — previous package restored. ({msg})");
                let _ = restore_package_after_failed_reprocess(
                    &pool,
                    storage.as_ref(),
                    &file_id,
                    &storage_key,
                    &detail,
                )
                .await;
            } else {
                mark_failed(&pool, &file_id, &msg).await;
            }
            return Err(msg);
        }
    };
    let tmp_video = source.path().to_path_buf();
    // Human: Keep all scratch files under a per-file work dir — never treat OS temp root as cleanup target.
    // Agent: Spool uses upload parent; remuxed reprocess uses ownly_hls_* so we never rmdir the source TempDir mid-job.
    let work_dir = match &source {
        EncodeVideoSource::Spool(path) => job_work_dir(path, &file_id),
        EncodeVideoSource::Master { .. } | EncodeVideoSource::Materialized { .. } => {
            std::env::temp_dir().join(format!("ownly_hls_{file_id}"))
        }
    };
    let hls_output_dir = work_dir.join("hls_out");
    let is_reprocess_job = prior_segment_count.unwrap_or(0) > 0;

    if is_encode_cancelled(&pool, &file_id).await {
        // Human: Never purge an existing rebuild package on cancel before encode writes over it.
        // Agent: preserve_package=true for reprocess; first-time cancel may purge partials.
        cleanup_cancelled_encode(
            storage.clone(),
            &storage_key,
            None,
            &work_dir,
            is_reprocess_job,
        )
        .await;
        if is_reprocess_job {
            let _ = restore_package_after_failed_reprocess(
                &pool,
                storage.as_ref(),
                &file_id,
                &storage_key,
                "Stream rebuild cancelled — previous package restored.",
            )
            .await;
        }
        return Ok(());
    }

    mark_processing(&pool, &file_id).await;
    set_progress(&pool, &file_id, 5).await;
    let encode_started = std::time::Instant::now();

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
    resolve_video_dimensions(&pool, &file_id, &tmp_video).await;

    let codec_probe = probe::probe_codecs(&tmp_video).await;
    let encode_mode_label = format!("{:?}", codec_probe.encode_mode);
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
        encode_mode = %encode_mode_label,
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

                    let (playlist_data, _key_data, init_data) = match tokio::try_join!(
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
                    stored_bytes += (playlist_data.len() + init_data.len()) as u64;

                    let playlist_key = format!("{prefix}stream.m3u8");
                    let init_object_key = format!("{prefix}{HLS_INIT_FILENAME}");
                    let storage_for_manifest = storage.clone();

                    let manifest_upload = tokio::try_join!(
                        storage_for_manifest.put(
                            &playlist_key,
                            "application/vnd.apple.mpegurl",
                            playlist_data,
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
                            // Human: In-place reprocess overwrites segment keys — any successful PUT can mix packages.
                            // Agent: NEVER restore hls_ready after partial reprocess upload; mark_failed instead.
                            // Agent: First-time ingest may purge partials; reprocess must not full-purge leftovers.
                            if is_reprocess_job {
                                let detail = format!(
                                    "Stream rebuild partially overwrote the package and was stopped — \
                                     re-upload the original or rebuild again from a retained source. ({msg})"
                                );
                                mark_failed(&pool, &file_id, &detail).await;
                            } else {
                                mark_failed(&pool, &file_id, &msg).await;
                                purge_file_storage(
                                    storage.clone(),
                                    &storage_key,
                                    Some(output.segment_count as i32),
                                )
                                .await;
                            }
                            discard_hls_output(&hls_output_dir).await;
                            return Err(msg);
                        }
                    };
                    stored_bytes += segment_outcome.bytes;

                    set_progress(&pool, &file_id, 100).await;

                    if is_encode_cancelled(&pool, &file_id).await {
                        // Human: Cancel after segment PUTs may leave mixed keys — never mark ready.
                        // Agent: preserve_package for reprocess (no full purge); mark_failed when reprocess.
                        cleanup_cancelled_encode(
                            storage.clone(),
                            &storage_key,
                            Some(output.segment_count as i32),
                            &work_dir,
                            is_reprocess_job,
                        )
                        .await;
                        if is_reprocess_job {
                            mark_failed(
                                &pool,
                                &file_id,
                                "Stream rebuild cancelled after partial upload — \
                                 re-upload the original or rebuild again from a retained source.",
                            )
                            .await;
                        }
                        return Ok(());
                    }

                    // Human: Drop leftover higher-index segments when reprocess produces fewer chunks.
                    // Agent: DELETES segments from new_count..old_count after successful upload.
                    if let Some(old_count) = prior_segment_count {
                        purge_stale_hls_segments(
                            storage.as_ref(),
                            &storage_key,
                            old_count,
                            output.segment_count as i32,
                        )
                        .await;
                    }
                    // Human: Cached download export was built from the previous segment tree — drop
                    // the stale blob and force a rebuild on the next download.
                    // Agent: DELETES export.mp4 + CLEARS download_export_*.
                    invalidate_download_export(&storage, &pool, &file_id, &storage_key).await;

                    // Human: Do not upload a second full-size original — HLS is the stored package.
                    // Agent: KEEP existing source.master on reprocess; NEVER PUT a new one on first ingest.
                    let has_source_master = load_source_master_flag(&pool, &file_id).await;
                    if persist_source_master_after_ingest() && source.is_spool() && !has_source_master
                    {
                        if let Err(error) =
                            persist_source_master(storage.as_ref(), &storage_key, &tmp_video).await
                        {
                            tracing::warn!(
                                %file_id,
                                %error,
                                "failed to retain HLS source master; reprocess will remux segments"
                            );
                        }
                    }

                    let encode_ms = encode_started.elapsed().as_millis() as i64;
                    // Human: Mark successful user rebuilds so "rebuild all" skips healthy packages next time.
                    // Agent: SET hls_stream_rebuilt when this job re-encoded an existing package (prior segments).
                    let completed_user_rebuild = prior_segment_count.unwrap_or(0) > 0;
                    // Human: Authoritative duration is the sum of ffmpeg EXTINF, not the pre-encode probe.
                    // Agent: AVOIDS inflated seek bars when remux/probe duration exceeds real media length.
                    let playlist_duration_secs =
                        playlist_duration_seconds_from_path(&output.playlist_path).await;

                    if let Err(e) = sqlx::query(
                        "UPDATE files SET hls_ready = true, hls_key_id = $1, segment_count = $2, \
                         hls_encode_status = 'ready', hls_encode_error = NULL, \
                         hls_encode_mode = $3, hls_last_encode_ms = $4, hls_source_master = $5, \
                         hls_stream_rebuilt = CASE WHEN $7 THEN true ELSE hls_stream_rebuilt END, \
                         duration_seconds = COALESCE($8, duration_seconds) \
                         WHERE id = $6",
                    )
                    .bind(key_id.to_string())
                    .bind(output.segment_count as i32)
                    .bind(&encode_mode_label)
                    .bind(encode_ms)
                    .bind(has_source_master)
                    .bind(&file_id)
                    .bind(completed_user_rebuild)
                    .bind(playlist_duration_secs)
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
                        encode_mode = %encode_mode_label,
                        encode_ms,
                        has_source_master,
                        "video HLS ingest complete"
                    );
                    // Keep Master/Materialized temp alive until after ffmpeg/upload via `source`.
                    drop(source);
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

// Human: Prefer upload spool, then retained master, cached export, then remux stored HLS.
// Agent: READS spool → source.master → export.mp4 → materialize_hls_mp4_for_ffmpeg; NO mark_failed here.
async fn resolve_encode_video_source(
    pool: &PgPool,
    storage: Arc<dyn Storage>,
    key_store: &KeyStore,
    file_id: &str,
    storage_key: &str,
    tmp_video: Option<&Path>,
    prior_segment_count: Option<i32>,
) -> Result<EncodeVideoSource, String> {
    use crate::jobs::recovery::upload_spool_source_path;

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = tmp_video {
        if !path.as_os_str().is_empty() {
            candidates.push(path.to_path_buf());
        }
    }
    let canonical = upload_spool_source_path(file_id);
    if !candidates.iter().any(|p| p == &canonical) {
        candidates.push(canonical);
    }
    for candidate in candidates {
        if let Ok(meta) = tokio::fs::metadata(&candidate).await {
            if meta.is_file() && meta.len() > 0 {
                return Ok(EncodeVideoSource::Spool(candidate));
            }
        }
    }

    // Human: Original upload retained after first encode — best quality reprocess input.
    // Agent: DOWNLOADS source.master when present; AVOIDS second-gen HLS remux when possible.
    match download_source_master_to_temp(storage.as_ref(), storage_key).await {
        Ok(temp) => {
            let path = temp.path().to_path_buf();
            tracing::info!(%file_id, "HLS encode source loaded from retained master");
            return Ok(EncodeVideoSource::Master { _temp: temp, path });
        }
        Err(error) => {
            tracing::debug!(%file_id, %error, "no source master for re-encode; trying export/HLS remux");
        }
    }

    // Human: Cached download MP4 is a full-file source when spool/master are gone.
    // Agent: GET export.mp4 when download_export_ready; USED for reprocess without source.master.
    if let Ok(temp) = download_export_mp4_to_temp(pool, storage.as_ref(), file_id, storage_key).await
    {
        let path = temp.path().to_path_buf();
        tracing::info!(%file_id, "HLS encode source loaded from cached export.mp4");
        return Ok(EncodeVideoSource::Master { _temp: temp, path });
    }

    let segment_count = prior_segment_count.unwrap_or(0);
    if segment_count > 0 {
        match crate::hls::export_job::materialize_hls_mp4_for_ffmpeg(
            storage,
            key_store,
            file_id,
            storage_key,
            segment_count,
        )
        .await
        {
            Ok((work_dir, mp4)) => {
                tracing::info!(
                    %file_id,
                    segment_count,
                    "HLS encode source remuxed from stored segments (fallback reprocess path)"
                );
                return Ok(EncodeVideoSource::Materialized {
                    _work_dir: work_dir,
                    path: mp4,
                });
            }
            Err(error) => {
                tracing::warn!(
                    %file_id,
                    %error,
                    "failed to materialize HLS source for re-encode"
                );
                return Err(format!(
                    "could not rebuild from stored stream package: {error}"
                ));
            }
        }
    }

    // Human: Caller decides mark_failed vs restore package — do not mutate file status here.
    // Agent: RETURNS constant when spool/master/export/segments all unavailable.
    Err(HLS_SOURCE_UNAVAILABLE.to_string())
}

// Human: Download cached export.mp4 when a prior download remux exists.
// Agent: READS download_export_ready + size; GET `{storage_key}/export.mp4`.
async fn download_export_mp4_to_temp(
    pool: &PgPool,
    storage: &dyn Storage,
    file_id: &str,
    storage_key: &str,
) -> Result<tempfile::NamedTempFile, String> {
    let row: Option<(bool, Option<i64>)> = sqlx::query_as(
        "SELECT COALESCE(download_export_ready, false), download_export_size_bytes \
         FROM files WHERE id = $1",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("export flags load: {e}"))?;

    let (ready, size) = row.unwrap_or((false, None));
    if !crate::hls::export::export_cache_is_valid(ready, size) {
        return Err("cached export not ready".into());
    }

    let key = format!("{storage_key}/{}", crate::hls::export_job::EXPORT_OBJECT_KEY);
    download_storage_object_to_temp(storage, &key).await
}

// Human: Stream any storage object into a NamedTempFile for ffmpeg input.
// Agent: GET key; WRITES temp path; ERR when empty/missing.
async fn download_storage_object_to_temp(
    storage: &dyn Storage,
    key: &str,
) -> Result<tempfile::NamedTempFile, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let (mut stream, _, _) = storage
        .get_stream(key)
        .await
        .map_err(|e| format!("storage download {key}: {e}"))?;

    let temp = tempfile::NamedTempFile::new().map_err(|e| format!("temp file create: {e}"))?;
    let path = temp.path().to_path_buf();
    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|e| format!("temp file open: {e}"))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("storage stream {key}: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("storage write {key}: {e}"))?;
    }
    file.sync_all()
        .await
        .map_err(|e| format!("storage flush {key}: {e}"))?;

    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("storage meta {key}: {e}"))?;
    if meta.len() == 0 {
        return Err(format!("storage object empty: {key}"));
    }
    Ok(temp)
}

// Human: True when storage still holds the first media segment (package is playable).
// Agent: EXISTS 0000.m4s OR 0000.ts under `{storage_key}/segments/`.
async fn storage_has_hls_media(storage: &dyn Storage, storage_key: &str) -> bool {
    let m4s = format!("{storage_key}/segments/0000.{HLS_SEGMENT_EXTENSION}");
    let ts = format!("{storage_key}/segments/0000.ts");
    storage.exists(&m4s).await.unwrap_or(false) || storage.exists(&ts).await.unwrap_or(false)
}

// Human: After a failed rebuild, put the prior HLS package back online only when media still exists.
// Agent: EXISTS first segment; WRITES hls_ready=true; ELSE mark_failed with re-upload guidance.
async fn restore_package_after_failed_reprocess(
    pool: &PgPool,
    storage: &dyn Storage,
    file_id: &str,
    storage_key: &str,
    message: &str,
) -> bool {
    if !storage_has_hls_media(storage, storage_key).await {
        let missing = "Stream package is missing from storage — re-upload the video.";
        mark_failed(pool, file_id, missing).await;
        tracing::error!(
            %file_id,
            storage_key,
            prior_error = %message,
            "cannot restore HLS package — first segment missing from object storage"
        );
        return false;
    }

    let result = sqlx::query(
        "UPDATE files SET hls_ready = true, hls_encode_status = 'ready', \
         hls_encode_error = $1, conversion_progress = 100 \
         WHERE id = $2 AND COALESCE(segment_count, 0) > 0 \
           AND hls_encode_status IN ('reprocessing', 'processing', 'queued', 'failed', 'cancelled')",
    )
    .bind(message)
    .bind(file_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::warn!(
                %file_id,
                error = %message,
                "restored prior HLS package after rebuild failure"
            );
            true
        }
        Ok(_) => false,
        Err(error) => {
            tracing::error!(%file_id, %error, "failed to restore HLS package after rebuild failure");
            false
        }
    }
}

// Human: Stream retained original video from Nebular into a temp file for ffmpeg.
// Agent: GET `{storage_key}/source.master`; RETURNS NamedTempFile; ERR when missing.
async fn download_source_master_to_temp(
    storage: &dyn Storage,
    storage_key: &str,
) -> Result<tempfile::NamedTempFile, String> {
    let key = source_master_storage_key(storage_key);
    download_storage_object_to_temp(storage, &key).await
}

// Human: Upload the upload-spool original next to the HLS package for later reprocess.
// Agent: PUT source.master as video/mp4 application/octet-stream; READS local spool path.
async fn persist_source_master(
    storage: &dyn Storage,
    storage_key: &str,
    local_path: &Path,
) -> Result<(), String> {
    let bytes = tokio::fs::read(local_path)
        .await
        .map_err(|e| format!("read spool for source master: {e}"))?;
    if bytes.is_empty() {
        return Err("spool file is empty".into());
    }
    let key = source_master_storage_key(storage_key);
    storage
        .put(&key, "application/octet-stream", bytes)
        .await
        .map_err(|e| format!("upload source master: {e}"))?;
    Ok(())
}

async fn load_source_master_flag(pool: &PgPool, file_id: &str) -> bool {
    let row: Option<(bool,)> =
        sqlx::query_as("SELECT COALESCE(hls_source_master, false) FROM files WHERE id = $1")
            .bind(file_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);
    row.map(|(flag,)| flag).unwrap_or(false)
}

async fn load_prior_segment_count(pool: &PgPool, file_id: &str) -> Option<i32> {
    let row: Option<(Option<i32>,)> =
        sqlx::query_as("SELECT segment_count FROM files WHERE id = $1")
            .bind(file_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);
    row.and_then(|(count,)| count.filter(|n| *n > 0))
}

// Human: Sum #EXTINF durations from the local ffmpeg playlist after packaging.
// Agent: READS stream.m3u8; RETURNS rounded seconds for files.duration_seconds; None when unreadable.
async fn playlist_duration_seconds_from_path(playlist_path: &Path) -> Option<i32> {
    let content = tokio::fs::read_to_string(playlist_path).await.ok()?;
    let (_files, durations) = crate::hls::playlist::parse_segment_manifest(&content).ok()?;
    if durations.is_empty() {
        return None;
    }
    let total = durations.iter().sum::<f64>();
    if !total.is_finite() || total <= 0.0 {
        return None;
    }
    Some(total.round().clamp(1.0, i32::MAX as f64) as i32)
}

// Human: Remove segment objects past the new package length after a successful reprocess.
// Agent: DELETES .m4s and legacy .ts aliases for indexes [new_count, old_count).
async fn purge_stale_hls_segments(
    storage: &dyn Storage,
    storage_key: &str,
    old_count: i32,
    new_count: i32,
) {
    if new_count >= old_count {
        return;
    }
    for i in new_count..old_count {
        let m4s = format!("{storage_key}/segments/{i:04}.{HLS_SEGMENT_EXTENSION}");
        let ts = format!("{storage_key}/segments/{i:04}.ts");
        let _ = storage.delete(&m4s).await;
        let _ = storage.delete(&ts).await;
    }
}

// Human: Drop the cached export.mp4 after HLS segments change — both the row flags AND the blob.
// Agent: DELETES {storage_key}/export.mp4 then WRITES download_export_ready=false.
//
// Human: This used to clear the columns only. The stale blob then sat on the node forever: the
// next download rebuilt and overwrote it, but a file that was never downloaded again kept a
// full-size orphan, and nulling download_export_size_bytes made it invisible to accounting too.
// Delete first — if the DB write fails afterwards the next download simply rebuilds, whereas
// clearing the flag first would strand the object with nothing left pointing at it.
async fn invalidate_download_export(
    storage: &Arc<dyn Storage>,
    pool: &PgPool,
    file_id: &str,
    storage_key: &str,
) {
    let export_key = format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}");
    if let Err(error) = storage.delete(&export_key).await {
        // Human: Not fatal — the reclaim sweeper will find it — but it must be visible.
        tracing::warn!(%file_id, %export_key, %error, "failed to delete stale download export");
    }

    let _ = sqlx::query(
        "UPDATE files SET download_export_ready = false, download_export_status = NULL, \
         download_export_error = NULL, download_export_progress = 0, \
         download_export_size_bytes = NULL, download_export_created_at = NULL WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

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

// Human: Cancel cleanup — purge storage only for first-time ingest partials, never for reprocess packages.
// Agent: WHEN preserve_package, only removes work_dir; ELSE purges HLS objects then work_dir.
async fn cleanup_cancelled_encode(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    work_dir: &Path,
    preserve_package: bool,
) {
    if !preserve_package {
        purge_file_storage(storage, storage_key, segment_count).await;
    }
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

    #[test]
    fn source_master_key_sits_beside_hls_package() {
        assert_eq!(
            source_master_storage_key("users/u1/files/f1"),
            "users/u1/files/f1/source.master"
        );
    }

    #[test]
    fn first_ingest_does_not_store_a_second_full_copy() {
        // Human: source.master doubled every video on disk and was invisible in the drive.
        // Reprocess remuxes HLS when the original is not retained.
        assert!(!persist_source_master_after_ingest());
    }

    #[tokio::test]
    async fn dropping_source_master_leaves_the_hls_package() {
        use crate::storage::{memory::MemoryStorage, Storage};
        use std::sync::Arc;

        let storage = Arc::new(MemoryStorage::new()) as Arc<dyn Storage>;
        let base = "users/u1/files/f1";
        storage
            .put(&format!("{base}/stream.m3u8"), "application/vnd.apple.mpegurl", vec![1])
            .await
            .unwrap();
        storage
            .put(&format!("{base}/init.mp4"), "video/mp4", vec![2])
            .await
            .unwrap();
        storage
            .put(&format!("{base}/segments/0000.m4s"), "video/mp4", vec![3])
            .await
            .unwrap();
        storage
            .put(&source_master_storage_key(base), "application/octet-stream", vec![9; 32])
            .await
            .unwrap();

        storage
            .delete(&source_master_storage_key(base))
            .await
            .unwrap();

        assert!(
            !storage
                .exists(&source_master_storage_key(base))
                .await
                .unwrap()
        );
        assert!(storage.exists(&format!("{base}/stream.m3u8")).await.unwrap());
        assert!(storage.exists(&format!("{base}/init.mp4")).await.unwrap());
        assert!(
            storage
                .exists(&format!("{base}/segments/0000.m4s"))
                .await
                .unwrap()
        );
    }
}
