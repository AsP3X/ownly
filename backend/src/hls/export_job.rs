// Human: Background job that remuxes stored HLS segments into a downloadable MP4.
// Agent: READS storage prefix; WRITES {storage_key}/export.mp4; UPDATES files.download_export_*.

use std::path::Path;
use std::sync::Arc;

use sqlx::PgPool;

use crate::hls::encoder::HlsEncoder;
use crate::hls::playlist::PlaylistGenerator;
use crate::storage::Storage;

const EXPORT_OBJECT_KEY: &str = "export.mp4";

pub async fn mark_export_processing(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET download_export_status = 'processing', download_export_error = NULL, \
         download_export_progress = 0, download_export_ready = false WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

pub async fn mark_export_failed(pool: &PgPool, file_id: &str, message: &str) {
    let _ = sqlx::query(
        "UPDATE files SET download_export_status = 'failed', download_export_error = $1, \
         download_export_progress = 0, download_export_ready = false WHERE id = $2",
    )
    .bind(message)
    .bind(file_id)
    .execute(pool)
    .await;
}

async fn set_export_progress(pool: &PgPool, file_id: &str, progress: i32) {
    let _ = sqlx::query("UPDATE files SET download_export_progress = $1 WHERE id = $2")
        .bind(progress)
        .bind(file_id)
        .execute(pool)
        .await;
}

pub fn spawn_hls_export_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    file_id: String,
    storage_key: String,
    segment_count: i32,
) {
    tokio::spawn(async move {
        run_hls_export_job(pool, storage, file_id, storage_key, segment_count).await;
    });
}

pub async fn run_hls_export_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    file_id: String,
    storage_key: String,
    segment_count: i32,
) {
    mark_export_processing(&pool, &file_id).await;
    set_export_progress(&pool, &file_id, 5).await;

    let work_dir = std::env::temp_dir().join(format!("mv_export_{file_id}"));
    if let Err(e) = prepare_hls_workdir(
        storage.as_ref(),
        &storage_key,
        segment_count,
        &work_dir,
        &pool,
        &file_id,
    )
    .await
    {
        mark_export_failed(&pool, &file_id, &format!("fetch HLS bundle: {e}")).await;
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return;
    }

    set_export_progress(&pool, &file_id, 40).await;

    let output_mp4 = work_dir.join("output.mp4");
    if let Err(e) = HlsEncoder::package_hls_to_mp4(&work_dir, &output_mp4).await {
        mark_export_failed(&pool, &file_id, &format!("ffmpeg export: {e}")).await;
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return;
    }

    set_export_progress(&pool, &file_id, 75).await;

    let mp4_bytes = match tokio::fs::read(&output_mp4).await {
        Ok(b) => b,
        Err(e) => {
            mark_export_failed(&pool, &file_id, &format!("read export mp4: {e}")).await;
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return;
        }
    };

    let export_key = format!("{storage_key}/{EXPORT_OBJECT_KEY}");
    if let Err(e) = storage
        .put(&export_key, "video/mp4", mp4_bytes.clone())
        .await
    {
        mark_export_failed(&pool, &file_id, &format!("upload export: {e}")).await;
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return;
    }

    set_export_progress(&pool, &file_id, 100).await;

    let _ = sqlx::query(
        "UPDATE files SET download_export_ready = true, download_export_status = 'ready', \
         download_export_error = NULL, download_export_size_bytes = $1 WHERE id = $2",
    )
    .bind(mp4_bytes.len() as i64)
    .bind(&file_id)
    .execute(&pool)
    .await;

    tracing::info!(
        %file_id,
        export_bytes = mp4_bytes.len(),
        "HLS export MP4 ready"
    );

    let _ = tokio::fs::remove_dir_all(&work_dir).await;
}

async fn prepare_hls_workdir(
    storage: &dyn Storage,
    storage_key: &str,
    segment_count: i32,
    work_dir: &Path,
    pool: &PgPool,
    file_id: &str,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(work_dir).await?;
    let segments_dir = work_dir.join("segments");
    tokio::fs::create_dir_all(&segments_dir).await?;

    let prefix = format!("{storage_key}/");

    let key_bytes = read_storage_object(storage, &format!("{prefix}key.bin")).await?;
    tokio::fs::write(work_dir.join("key.bin"), &key_bytes).await?;

    let count = segment_count.max(0) as usize;
    let mut segment_files = Vec::new();
    let mut segment_durations = Vec::new();
    for i in 0..count {
        let name = format!("{i:04}.ts");
        let data = read_storage_object(storage, &format!("{prefix}segments/{name}")).await?;
        tokio::fs::write(segments_dir.join(&name), &data).await?;
        segment_files.push(format!("segments/{name}"));
        segment_durations.push(4.0);

        // Human: Long HLS videos spend most of export time fetching segments — surface progress in the tray.
        // Agent: MAPS segment index to 5–39% before ffmpeg remux starts.
        if count > 0 {
            let pct = 5 + (((i + 1) as f64 / count as f64) * 34.0).round() as i32;
            set_export_progress(pool, file_id, pct).await;
        }
    }

    let key_uri = "key.bin";
    let playlist = PlaylistGenerator::generate(".", &segment_files, &segment_durations, key_uri);
    tokio::fs::write(work_dir.join("stream.m3u8"), playlist).await?;

    Ok(())
}

async fn read_storage_object(storage: &dyn Storage, key: &str) -> anyhow::Result<Vec<u8>> {
    use futures_util::TryStreamExt;

    let (mut stream, _, _) = storage.get_stream(key).await?;
    let mut out = Vec::new();
    while let Some(chunk) = stream.try_next().await? {
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}
