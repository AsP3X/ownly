// Human: Background audio waveform job — download source, analyze peaks, upload JSON sidecar to Nebular.
// Agent: MUTATES files.audio_* + conversion_progress; READS storage; CALLS ffmpeg via waveform module.

use std::path::PathBuf;
use std::sync::Arc;

use futures_util::StreamExt;
use sqlx::PgPool;
use tempfile::NamedTempFile;

use crate::{
    audio::waveform::{extract_waveform_bars, AudioWaveformArtifact},
    hls::probe::probe_duration_seconds,
    storage::Storage,
};

use super::waveform_storage_key;

#[derive(Clone)]
pub struct AudioWaveformJob {
    pub file_id: String,
    pub storage_key: String,
}

pub async fn mark_processing(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET audio_encode_status = 'processing', audio_encode_error = NULL WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

pub async fn mark_failed(pool: &PgPool, file_id: &str, message: &str) {
    let _ = sqlx::query(
        "UPDATE files SET audio_encode_status = 'failed', audio_encode_error = $1, \
         audio_waveform_ready = false, conversion_progress = 0 WHERE id = $2",
    )
    .bind(message)
    .bind(file_id)
    .execute(pool)
    .await;
}

// Human: Mark an audio row as user-cancelled so drive UI and upload polling can stop cleanly.
// Agent: WRITES audio_encode_status=cancelled; CLEARS progress/error; NO-OP when waveform already ready.
pub async fn mark_cancelled(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET audio_encode_status = 'cancelled', audio_encode_error = NULL, \
         conversion_progress = 0 WHERE id = $1 AND NOT audio_waveform_ready",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

async fn is_waveform_cancelled(pool: &PgPool, file_id: &str) -> bool {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT audio_encode_status FROM files WHERE id = $1")
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

// Human: Stream the source audio object from Nebular into a temp file for ffmpeg analysis.
// Agent: READS storage.get_stream; WRITES tempfile path; RETURNS PathBuf for probe/decode.
async fn download_source_to_temp(
    storage: Arc<dyn Storage>,
    storage_key: &str,
) -> Result<PathBuf, String> {
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

    Ok(path)
}

// Human: Run waveform analysis for one queued audio file — main worker entry point.
// Agent: DOWNLOADS source; PROBES duration; PUTS waveform.json; UPDATES files.audio_waveform_ready.
pub async fn run_audio_waveform_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    job: AudioWaveformJob,
) -> Result<(), String> {
    if is_waveform_cancelled(&pool, &job.file_id).await {
        return Ok(());
    }

    mark_processing(&pool, &job.file_id).await;
    set_progress(&pool, &job.file_id, 5).await;

    let tmp_path = download_source_to_temp(storage.clone(), &job.storage_key).await?;
    set_progress(&pool, &job.file_id, 25).await;

    if is_waveform_cancelled(&pool, &job.file_id).await {
        return Ok(());
    }

    let duration = probe_duration_seconds(&tmp_path).await;
    let _ = sqlx::query("UPDATE files SET duration_seconds = $1 WHERE id = $2")
        .bind(duration)
        .bind(&job.file_id)
        .execute(&pool)
        .await;

    set_progress(&pool, &job.file_id, 45).await;

    let bars = extract_waveform_bars(&tmp_path).await?;
    set_progress(&pool, &job.file_id, 75).await;

    let artifact = AudioWaveformArtifact::new(bars);
    let payload = serde_json::to_vec(&artifact).map_err(|e| format!("waveform json encode: {e}"))?;
    let waveform_key = waveform_storage_key(&job.storage_key);

    storage
        .put(&waveform_key, "application/json", payload)
        .await
        .map_err(|e| format!("waveform storage PUT failed: {e}"))?;

    set_progress(&pool, &job.file_id, 95).await;

    sqlx::query(
        "UPDATE files SET audio_waveform_ready = true, audio_encode_status = 'ready', \
         audio_encode_error = NULL, audio_waveform_key = $1, conversion_progress = 100 \
         WHERE id = $2",
    )
    .bind(&waveform_key)
    .bind(&job.file_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("files waveform ready update failed: {e}"))?;

    Ok(())
}
