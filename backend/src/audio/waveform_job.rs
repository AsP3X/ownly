// Human: Background audio waveform job — analyze peaks from upload spool or storage, upload JSON sidecar.
// Agent: MUTATES files.audio_* + conversion_progress; READS storage; CALLS ffmpeg via waveform module.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use sqlx::PgPool;

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
    /// Human: When set, analyze from the upload spool instead of downloading from Nebular.
    pub tmp_audio: Option<PathBuf>,
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

// Human: Guard against deleting the OS temp root during upload spool cleanup.
// Agent: TRUE when path is a strict child of std::env::temp_dir().
fn is_deletable_upload_work_dir(path: &Path) -> bool {
    let temp_root = std::env::temp_dir();
    path.starts_with(&temp_root) && path != temp_root.as_path()
}

// Human: Remove the per-upload scratch directory after waveform ingest finishes or fails.
// Agent: REMOVES ownly_upload_* parent when safe; NO-OP for foreign paths.
async fn cleanup_upload_work_dir(tmp_audio: &Path) {
    let Some(work_dir) = tmp_audio.parent() else {
        return;
    };
    if is_deletable_upload_work_dir(work_dir) {
        let _ = tokio::fs::remove_dir_all(work_dir).await;
    }
}

// Human: Stream the source audio object from Nebular into a temp file for ffmpeg analysis.
// Agent: READS storage.get_stream; WRITES NamedTempFile; FALLBACK when upload spool is unavailable.
async fn download_source_to_temp(
    storage: Arc<dyn Storage>,
    storage_key: &str,
) -> Result<(PathBuf, Option<tempfile::TempPath>), String> {
    use futures_util::StreamExt;
    use tempfile::NamedTempFile;

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

    let temp_path = temp.into_temp_path();
    Ok((path, Some(temp_path)))
}

// Human: Resolve the on-disk audio path — prefer upload spool over Nebular round-trip.
// Agent: RETURNS (path, keep_temp_guard) where guard holds downloaded temp until analysis completes.
async fn resolve_source_audio_path(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    tmp_audio: Option<PathBuf>,
) -> Result<(PathBuf, Option<tempfile::TempPath>), String> {
    if let Some(path) = tmp_audio {
        if tokio::fs::metadata(&path).await.is_ok() {
            return Ok((path, None));
        }
    }
    download_source_to_temp(storage, storage_key).await
}

// Human: Run waveform analysis for one queued audio file — main worker entry point.
// Agent: READS spool or storage; PUTS waveform.json; UPDATES files.audio_waveform_ready; CLEANUP spool dir.
pub async fn run_audio_waveform_job(
    pool: PgPool,
    storage: Arc<dyn Storage>,
    job: AudioWaveformJob,
) -> Result<(), String> {
    if is_waveform_cancelled(&pool, &job.file_id).await {
        if let Some(ref tmp) = job.tmp_audio {
            cleanup_upload_work_dir(tmp).await;
        }
        return Ok(());
    }

    mark_processing(&pool, &job.file_id).await;
    set_progress(&pool, &job.file_id, 5).await;

    let (tmp_path, _temp_guard) =
        resolve_source_audio_path(storage.clone(), &job.storage_key, job.tmp_audio.clone()).await?;
    set_progress(&pool, &job.file_id, 25).await;

    if is_waveform_cancelled(&pool, &job.file_id).await {
        cleanup_upload_work_dir(&tmp_path).await;
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

    let result = storage
        .put(&waveform_key, "application/json", payload)
        .await
        .map_err(|e| format!("waveform storage PUT failed: {e}"));

    cleanup_upload_work_dir(&tmp_path).await;

    result?;

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
