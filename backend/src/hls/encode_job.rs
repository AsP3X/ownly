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
    let hls_tmp_dir = tmp_video
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::temp_dir().join(format!("mediavault_hls_{file_id}")));

    mark_processing(&pool, &file_id).await;
    set_progress(&pool, &file_id, 5).await;

    let hls_output_dir = hls_tmp_dir
        .parent()
        .unwrap_or(&hls_tmp_dir)
        .join(format!("mediavault_hls_out_{file_id}"));

    let key_result = key_store.create_key_for_file(&file_id).await;
    let (key_id, key) = match key_result {
        Ok(pair) => pair,
        Err(e) => {
            let msg = format!("create encryption key: {e}");
            mark_failed(&pool, &file_id, &msg).await;
            cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
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
                            cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
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
                        cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
                        return Err(msg);
                    }
                    current_step += 1;

                    let key_data = match tokio::fs::read(&output.key_path).await {
                        Ok(data) => data,
                        Err(e) => {
                            let msg = format!("read hls key: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
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
                        cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
                        return Err(msg);
                    }
                    current_step += 1;

                    let mut segment_entries = match tokio::fs::read_dir(&output.segments_dir).await {
                        Ok(entries) => entries,
                        Err(e) => {
                            let msg = format!("read segments dir: {e}");
                            mark_failed(&pool, &file_id, &msg).await;
                            cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
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
                        cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
                        return Err(msg);
                    }

                    tracing::info!(
                        %file_id,
                        segments = output.segment_count,
                        stored_bytes,
                        "video HLS ingest complete"
                    );
                    cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
                    Ok(())
                }
                Err(e) => {
                    let msg = format!("ffmpeg transcode: {e}");
                    mark_failed(&pool, &file_id, &msg).await;
                    cleanup_dirs(&hls_tmp_dir, &hls_output_dir, &tmp_video).await;
                    Err(msg)
                }
            }
    }
}

async fn cleanup_dirs(hls_tmp_dir: &Path, hls_output_dir: &Path, tmp_video: &Path) {
    let _ = tokio::fs::remove_file(tmp_video).await;
    let _ = tokio::fs::remove_dir_all(hls_tmp_dir).await;
    let _ = tokio::fs::remove_dir_all(hls_output_dir).await;
}
