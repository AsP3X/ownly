// Human: Dispatches claimed background jobs to the correct handler (HLS, zip, export).
// Agent: READS job kind + payload; CALLS run_* functions; WRITES complete/fail on background_jobs.

use std::path::PathBuf;
use std::sync::Arc;

use crate::{
    files::zip_job::{
        collect_zip_entries_for_file_ids, run_zip_entries_job, FolderDownloadJob,
        FolderDownloadRegistry,
    },
    hls::encode_job::{run_hls_encode_job, HlsEncodeJob},
    hls::export_job::run_hls_export_job,
    AppState,
};

use super::model::{
    AudioWaveformPayload, BackgroundJob, HlsEncodePayload, HlsExportPayload, JobKind, ZipBulkPayload,
    ZipFolderPayload,
};
use super::store::{
    complete_job, fail_job, finalize_cancelled_running, is_job_cancelled, set_job_progress,
};

/// Human: Run one claimed job to completion — the worker pool calls this after claim_next_job.
// Agent: MATCHES kind; RETURNS Ok on success; CALLS fail_job on Err; CHECKS cancellation for zip jobs.
pub async fn execute_job(state: Arc<AppState>, job: BackgroundJob) -> Result<(), String> {
    let kind = JobKind::parse(&job.kind).ok_or_else(|| format!("unknown job kind: {}", job.kind))?;

    match kind {
        JobKind::HlsEncode => run_hls_encode(state, &job).await,
        JobKind::HlsExport => run_hls_export(state, &job).await,
        JobKind::AudioWaveform => run_audio_waveform(state, &job).await,
        JobKind::ZipBulk => run_zip_bulk(state, &job).await,
        JobKind::ZipFolder => run_zip_folder(state, &job).await,
    }
}

async fn run_hls_encode(state: Arc<AppState>, job: &BackgroundJob) -> Result<(), String> {
    let payload: HlsEncodePayload = serde_json::from_value(job.payload.clone())
        .map_err(|e| format!("invalid hls_encode payload: {e}"))?;

    if is_job_cancelled(&state.pool, &job.id)
        .await
        .map_err(|e| e.to_string())?
    {
        crate::hls::encode_job::mark_cancelled(&state.pool, &payload.file_id).await;
        let _ = finalize_cancelled_running(&state.pool, &job.id)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let pool = state.pool.clone();
    let job_id = job.id.clone();
    let file_id = payload.file_id.clone();

    // Human: Mirror file conversion progress into the jobs table for the UI tray.
    // Agent: SPAWNS progress sync task; CANCELLED when encode finishes.
    let progress_pool = pool.clone();
    let progress_job_id = job_id.clone();
    let progress_file_id = file_id.clone();
    let progress_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let row: Option<(i32,)> =
                sqlx::query_as("SELECT conversion_progress FROM files WHERE id = $1")
                    .bind(&progress_file_id)
                    .fetch_optional(&progress_pool)
                    .await
                    .unwrap_or(None);
            if let Some((pct,)) = row {
                let _ = set_job_progress(&progress_pool, &progress_job_id, pct).await;
            }
        }
    });

    let encode_job = HlsEncodeJob {
        file_id: payload.file_id,
        storage_key: payload.storage_key,
        tmp_video: PathBuf::from(payload.tmp_video),
        duration_seconds: payload.duration_seconds,
    };

    let result = run_hls_encode_job(
        pool,
        state.storage.clone(),
        state.hls_key_store.clone(),
        state.hls_hardware.clone(),
        encode_job,
    )
    .await;

    progress_handle.abort();

    if is_job_cancelled(&state.pool, &job_id)
        .await
        .map_err(|e| e.to_string())?
    {
        crate::hls::encode_job::mark_cancelled(&state.pool, &file_id).await;
        let _ = finalize_cancelled_running(&state.pool, &job_id)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    match result {
        Ok(()) => {
            complete_job(&state.pool, &job_id)
                .await
                .map_err(|e| e.to_string())?;
        }
        Err(message) => {
            fail_job(&state.pool, &job_id, &message)
                .await
                .map_err(|e| e.to_string())?;
            tracing::warn!(job_id = %job_id, error = %message, "HLS encode job failed");
        }
    }

    Ok(())
}

async fn run_audio_waveform(state: Arc<AppState>, job: &BackgroundJob) -> Result<(), String> {
    let payload: AudioWaveformPayload = serde_json::from_value(job.payload.clone())
        .map_err(|e| format!("invalid audio_waveform payload: {e}"))?;

    if is_job_cancelled(&state.pool, &job.id)
        .await
        .map_err(|e| e.to_string())?
    {
        crate::audio::waveform_job::mark_cancelled(&state.pool, &payload.file_id).await;
        let _ = finalize_cancelled_running(&state.pool, &job.id)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let pool = state.pool.clone();
    let job_id = job.id.clone();
    let file_id = payload.file_id.clone();

    let progress_pool = pool.clone();
    let progress_job_id = job_id.clone();
    let progress_file_id = file_id.clone();
    let progress_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let row: Option<(i32,)> =
                sqlx::query_as("SELECT conversion_progress FROM files WHERE id = $1")
                    .bind(&progress_file_id)
                    .fetch_optional(&progress_pool)
                    .await
                    .unwrap_or(None);
            if let Some((pct,)) = row {
                let _ = set_job_progress(&progress_pool, &progress_job_id, pct).await;
            }
        }
    });

    let waveform_job = crate::audio::waveform_job::AudioWaveformJob {
        file_id: payload.file_id,
        storage_key: payload.storage_key,
    };

    let result = crate::audio::waveform_job::run_audio_waveform_job(
        pool,
        state.storage.clone(),
        waveform_job,
    )
    .await;

    progress_handle.abort();

    if is_job_cancelled(&state.pool, &job_id)
        .await
        .map_err(|e| e.to_string())?
    {
        crate::audio::waveform_job::mark_cancelled(&state.pool, &file_id).await;
        let _ = finalize_cancelled_running(&state.pool, &job_id)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    match result {
        Ok(()) => {
            complete_job(&state.pool, &job_id)
                .await
                .map_err(|e| e.to_string())?;
        }
        Err(message) => {
            crate::audio::waveform_job::mark_failed(&state.pool, &file_id, &message).await;
            fail_job(&state.pool, &job_id, &message)
                .await
                .map_err(|e| e.to_string())?;
            tracing::warn!(job_id = %job_id, error = %message, "audio waveform job failed");
        }
    }

    Ok(())
}

async fn run_hls_export(state: Arc<AppState>, job: &BackgroundJob) -> Result<(), String> {
    let payload: HlsExportPayload = serde_json::from_value(job.payload.clone())
        .map_err(|e| format!("invalid hls_export payload: {e}"))?;

    let pool = state.pool.clone();
    let job_id = job.id.clone();
    let file_id = payload.file_id.clone();

    let progress_pool = pool.clone();
    let progress_job_id = job_id.clone();
    let progress_file_id = file_id.clone();
    let progress_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let row: Option<(i32,)> =
                sqlx::query_as("SELECT download_export_progress FROM files WHERE id = $1")
                    .bind(&progress_file_id)
                    .fetch_optional(&progress_pool)
                    .await
                    .unwrap_or(None);
            if let Some((pct,)) = row {
                let _ = set_job_progress(&progress_pool, &progress_job_id, pct).await;
            }
        }
    });

    run_hls_export_job(
        pool,
        state.storage.clone(),
        payload.file_id,
        payload.storage_key,
        payload.segment_count,
    )
    .await;

    progress_handle.abort();

    let ready: Option<(bool, Option<String>)> = sqlx::query_as(
        "SELECT download_export_ready, download_export_error FROM files WHERE id = $1",
    )
    .bind(&file_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    match ready {
        Some((true, _)) => {
            complete_job(&state.pool, &job_id)
                .await
                .map_err(|e| e.to_string())?;
        }
        Some((false, err)) => {
            let message = err.unwrap_or_else(|| "video export failed".into());
            fail_job(&state.pool, &job_id, &message)
                .await
                .map_err(|e| e.to_string())?;
            tracing::warn!(job_id = %job_id, error = %message, "HLS export job failed");
        }
        None => {
            let message = "file not found after export".to_string();
            fail_job(&state.pool, &job_id, &message)
                .await
                .map_err(|e| e.to_string())?;
            tracing::warn!(job_id = %job_id, error = %message, "HLS export job missing file row");
        }
    }

    Ok(())
}

async fn mark_registry_queued_to_compressing(
    registry: &FolderDownloadRegistry,
    registry_key: &str,
    archive_name: &str,
) {
    if let Some(mut existing) = registry.get(registry_key).await {
        existing.status = "compressing".to_string();
        registry.set(registry_key.to_string(), existing).await;
    } else {
        registry
            .set(
                registry_key.to_string(),
                FolderDownloadJob {
                    status: "compressing".to_string(),
                    progress: 0,
                    ready: false,
                    error: None,
                    archive_name: archive_name.to_string(),
                    size_bytes: None,
                    archive_path: None,
                    cancelled: false,
                },
            )
            .await;
    }
}

async fn run_zip_bulk(state: Arc<AppState>, job: &BackgroundJob) -> Result<(), String> {
    let payload: ZipBulkPayload = serde_json::from_value(job.payload.clone())
        .map_err(|e| format!("invalid zip_bulk payload: {e}"))?;

    if is_job_cancelled(&state.pool, &job.id)
        .await
        .map_err(|e| e.to_string())?
    {
        let _ = finalize_cancelled_running(&state.pool, &job.id)
            .await
            .map_err(|e| e.to_string())?;
        state
            .folder_download_jobs
            .remove(&payload.registry_key)
            .await;
        return Ok(());
    }

    mark_registry_queued_to_compressing(
        &state.folder_download_jobs,
        &payload.registry_key,
        &payload.archive_name,
    )
    .await;

    let entries = collect_zip_entries_for_file_ids(
        &state.pool,
        &job.user_id,
        &payload.file_ids,
    )
    .await
    .map_err(|e| e.to_string())?;

    let work_dir = PathBuf::from(&payload.work_dir);
    run_zip_entries_job(
        state.clone(),
        payload.registry_key.clone(),
        work_dir,
        payload.archive_name.clone(),
        entries,
        &format!("bulk:{}", payload.job_id),
        Some(job.id.clone()),
    )
    .await;

    finalize_zip_job(state, job).await
}

async fn run_zip_folder(state: Arc<AppState>, job: &BackgroundJob) -> Result<(), String> {
    let payload: ZipFolderPayload = serde_json::from_value(job.payload.clone())
        .map_err(|e| format!("invalid zip_folder payload: {e}"))?;

    if is_job_cancelled(&state.pool, &job.id)
        .await
        .map_err(|e| e.to_string())?
    {
        let _ = finalize_cancelled_running(&state.pool, &job.id)
            .await
            .map_err(|e| e.to_string())?;
        state
            .folder_download_jobs
            .remove(&payload.registry_key)
            .await;
        return Ok(());
    }

    mark_registry_queued_to_compressing(
        &state.folder_download_jobs,
        &payload.registry_key,
        &payload.archive_name,
    )
    .await;

    let entries = super::super::files::folder_download::collect_zip_entries_for_folder(
        &state.pool,
        &job.user_id,
        &payload.folder_id,
    )
    .await
    .map_err(|e| e.to_string())?;

    let work_dir = PathBuf::from(&payload.work_dir);
    run_zip_entries_job(
        state.clone(),
        payload.registry_key.clone(),
        work_dir,
        payload.archive_name.clone(),
        entries,
        &format!("folder:{}", payload.folder_name),
        Some(job.id.clone()),
    )
    .await;

    finalize_zip_job(state, job).await
}

async fn finalize_zip_job(state: Arc<AppState>, job: &BackgroundJob) -> Result<(), String> {
    let payload_key = job
        .payload
        .get("registry_key")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let registry_job = state.folder_download_jobs.get(payload_key).await;

    match registry_job {
        Some(ref reg) if reg.ready => {
            complete_job(&state.pool, &job.id)
                .await
                .map_err(|e| e.to_string())?;
        }
        Some(ref reg) if reg.cancelled => {
            let _ = finalize_cancelled_running(&state.pool, &job.id)
                .await
                .map_err(|e| e.to_string())?;
        }
        Some(ref reg) if reg.status == "failed" => {
            let message = reg
                .error
                .clone()
                .unwrap_or_else(|| "zip job failed".into());
            fail_job(&state.pool, &job.id, &message)
                .await
                .map_err(|e| e.to_string())?;
            tracing::warn!(job_id = %job.id, error = %message, "zip job failed");
        }
        _ => {
            let message = "zip job ended in unexpected state".to_string();
            fail_job(&state.pool, &job.id, &message)
                .await
                .map_err(|e| e.to_string())?;
            tracing::warn!(job_id = %job.id, error = %message, "zip job unexpected state");
        }
    }

    Ok(())
}
