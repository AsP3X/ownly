// Human: Background job that remuxes stored HLS segments into a downloadable MP4.
// Agent: READS storage prefix; WRITES {storage_key}/export.mp4; UPDATES files.download_export_*.

use std::path::Path;
use std::sync::Arc;

use anyhow::Context;
use sqlx::PgPool;

use crate::hls::encoder::HlsEncoder;
use crate::hls::playlist::{
    normalize_segment_rel_path, parse_segment_manifest, playlist_uses_fmp4,
    segment_aes_sequence_map, PlaylistGenerator, HLS_INIT_FILENAME, HLS_SEGMENT_EXTENSION,
};
use crate::hls::segment_crypto::decrypt_hls_media_segment;
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
    let aes_key: [u8; 16] = key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("stored HLS AES key must be 16 bytes"))?;

    let playlist_key = format!("{prefix}stream.m3u8");
    let stored_playlist = read_storage_object(storage, &playlist_key).await.ok();
    let stored_text = stored_playlist
        .as_ref()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default();
    let fmp4 = storage
        .exists(&format!("{prefix}{HLS_INIT_FILENAME}"))
        .await
        .unwrap_or(false)
        || playlist_uses_fmp4(&stored_text);

    if fmp4 {
        let init_bytes = read_storage_object(storage, &format!("{prefix}{HLS_INIT_FILENAME}")).await?;
        tokio::fs::write(work_dir.join(HLS_INIT_FILENAME), &init_bytes).await?;
    }

    let (segment_names, segment_durations) = resolve_export_segments(
        &stored_text,
        segment_count,
        fmp4,
    )?;

    let seq_map = segment_aes_sequence_map(&stored_text).unwrap_or_default();

    let count = segment_names.len();
    let mut segment_files = Vec::new();
    for (i, name) in segment_names.iter().enumerate() {
        let storage_name = name.rsplit('/').next().unwrap_or(name.as_str());
        let encrypted =
            read_storage_object(storage, &format!("{prefix}segments/{storage_name}")).await?;
        let sequence = seq_map
            .get(storage_name)
            .copied()
            .with_context(|| format!("no AES sequence for segment {storage_name}"))?;
        let clear = decrypt_hls_media_segment(&encrypted, &aes_key, sequence)?;
        tokio::fs::write(segments_dir.join(storage_name), &clear).await?;
        segment_files.push(normalize_segment_rel_path(name));

        if count > 0 {
            let pct = 5 + (((i + 1) as f64 / count as f64) * 34.0).round() as i32;
            set_export_progress(pool, file_id, pct).await;
        }
    }

    let key_uri = "key.bin";
    let init_uri = HLS_INIT_FILENAME;
    let playlist = if !stored_text.is_empty() {
        PlaylistGenerator::rewrite_stored_playlist(&stored_text, ".", key_uri, init_uri)
            .unwrap_or_else(|_| {
                PlaylistGenerator::generate(
                    ".",
                    &segment_files,
                    &segment_durations,
                    key_uri,
                    init_uri,
                    fmp4,
                )
            })
    } else {
        PlaylistGenerator::generate(
            ".",
            &segment_files,
            &segment_durations,
            key_uri,
            init_uri,
            fmp4,
        )
    };
    tokio::fs::write(work_dir.join("stream.m3u8"), playlist).await?;

    Ok(())
}

// Human: Segment filenames for export — prefer stored playlist order, else numbered TS/fMP4.
// Agent: RETURNS parallel names + durations; LEGACY TS when fmp4 false and manifest missing.
fn resolve_export_segments(
    stored_playlist: &str,
    segment_count: i32,
    fmp4: bool,
) -> anyhow::Result<(Vec<String>, Vec<f64>)> {
    if let Ok((files, durations)) = parse_segment_manifest(stored_playlist) {
        if !files.is_empty() && files.len() == durations.len() {
            return Ok((files, durations));
        }
    }

    let count = segment_count.max(0) as usize;
    let mut names = Vec::new();
    let mut durations = Vec::new();
    for i in 0..count {
        if fmp4 {
            names.push(format!("segments/{i:04}.{HLS_SEGMENT_EXTENSION}"));
        } else {
            names.push(format!("segments/{i:04}.ts"));
        }
        durations.push(4.0);
    }
    Ok((names, durations))
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
