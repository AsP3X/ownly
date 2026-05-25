// Human: Multi-file bulk download — zips selected files server-side for one browser save.
// Agent: POST file_ids; SPAWNS zip job; POLL status; STREAM archive; AUDIT bulk download actions.

use std::path::Path;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::zip_job::{
        collect_zip_entries_for_file_ids, zip_status_json,
        FolderDownloadJob, FolderDownloadRegistry, ZipDownloadStatusResponse,
    },
    AppState,
};

const MAX_BULK_FILES: usize = 500;

#[derive(Debug, Deserialize)]
pub struct BulkDownloadRequest {
    pub file_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BulkDownloadStatusResponse {
    pub job_id: String,
    #[serde(flatten)]
    pub status: ZipDownloadStatusResponse,
}

// Human: Build a dated zip filename for multi-select downloads.
// Agent: FORMATS local timestamp as YYYY-MM-DD HH-MM-SS.zip.
fn bulk_archive_filename() -> String {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    format!("{stamp}.zip")
}

fn bulk_status_json(job_id: &str, job: &FolderDownloadJob) -> BulkDownloadStatusResponse {
    BulkDownloadStatusResponse {
        job_id: job_id.to_string(),
        status: zip_status_json(job),
    }
}

// Human: Ensure the caller owns the bulk download job before polling or streaming.
// Agent: READS registry key user_id:bulk:job_id; RETURNS NotFound when missing.
async fn ensure_bulk_job_owned(
    registry: &FolderDownloadRegistry,
    user_id: &str,
    job_id: &str,
) -> Result<(String, FolderDownloadJob), AppError> {
    let key = FolderDownloadRegistry::bulk_job_key(user_id, job_id);
    let job = registry.get(&key).await.ok_or(AppError::NotFound)?;
    Ok((key, job))
}

// Human: Start a background zip job for an explicit list of owned file ids.
// Agent: POST /files/download; VALIDATES file_ids; AUDIT files.download.bulk.start.
pub async fn post_bulk_download(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<BulkDownloadRequest>,
) -> Result<Json<BulkDownloadStatusResponse>, AppError> {
    let file_ids: Vec<String> = body
        .file_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    if file_ids.is_empty() {
        return Err(AppError::BadRequest("file_ids must not be empty".into()));
    }
    if file_ids.len() > MAX_BULK_FILES {
        return Err(AppError::BadRequest(format!(
            "cannot download more than {MAX_BULK_FILES} files at once"
        )));
    }

    let entries =
        collect_zip_entries_for_file_ids(&state.pool, &claims.sub, &file_ids).await?;

    let job_id = Uuid::new_v4().to_string();
    let key = FolderDownloadRegistry::bulk_job_key(&claims.sub, &job_id);
    let archive_name = bulk_archive_filename();
    let job = FolderDownloadJob {
        status: "queued".to_string(),
        progress: 0,
        ready: false,
        error: None,
        archive_name: archive_name.clone(),
        size_bytes: None,
        archive_path: None,
        cancelled: false,
    };
    state
        .folder_download_jobs
        .set(key.clone(), job.clone())
        .await;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.download.bulk.start",
        Some("bulk_download"),
        Some(&job_id),
        Some(serde_json::json!({
            "archive_name": archive_name,
            "file_count": entries.len(),
        })),
        &headers,
    )
    .await
    .ok();

    let work_dir = std::env::temp_dir().join(format!("mv_bulk_zip_{job_id}"));
    let payload = crate::jobs::model::ZipBulkPayload {
        job_id: job_id.clone(),
        registry_key: key.clone(),
        work_dir: work_dir.to_string_lossy().to_string(),
        archive_name: archive_name.clone(),
        file_ids: file_ids.clone(),
    };

    let _background_job_id = crate::jobs::enqueue_job(
        &state.pool,
        &claims.sub,
        crate::jobs::JobKind::ZipBulk,
        &archive_name,
        Some("bulk_download"),
        Some(&job_id),
        serde_json::to_value(payload).map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?,
    )
    .await?;

    Ok(Json(bulk_status_json(&job_id, &job)))
}

// Human: Poll bulk zip job progress for the download tray.
// Agent: GET /files/download/:job_id; READ-ONLY registry lookup.
pub async fn get_bulk_download_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Json<BulkDownloadStatusResponse>, AppError> {
    let (_, job) = ensure_bulk_job_owned(&state.folder_download_jobs, &claims.sub, &job_id).await?;
    Ok(Json(bulk_status_json(&job_id, &job)))
}

// Human: Stream the finished bulk zip archive to the browser once the job is ready.
// Agent: GET /files/download/:job_id/archive; REMOVES temp work dir after streaming starts.
pub async fn get_bulk_download_archive(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Response, AppError> {
    let (key, job) =
        ensure_bulk_job_owned(&state.folder_download_jobs, &claims.sub, &job_id).await?;

    if !job.ready {
        return Err(AppError::Conflict(
            "bulk archive is not ready — poll /download and retry".into(),
        ));
    }

    let archive_path = job
        .archive_path
        .clone()
        .ok_or(AppError::Internal(anyhow::anyhow!("missing archive path")))?;
    let archive_name = job.archive_name.clone();
    let work_dir = archive_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);

    let bytes = tokio::fs::read(&archive_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("read bulk archive: {e}")))?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.download.bulk.complete",
        Some("bulk_download"),
        Some(&job_id),
        Some(serde_json::json!({
            "archive_name": archive_name,
            "size_bytes": bytes.len(),
        })),
        &headers,
    )
    .await
    .ok();

    state.folder_download_jobs.remove(&key).await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;

    let disposition = format!(
        "attachment; filename=\"{}\"",
        archive_name.replace('"', "")
    );

    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Body::from(bytes),
    )
        .into_response())
}

// Human: Cancel an in-flight bulk zip job and remove scratch files.
// Agent: DELETE /files/download/:job_id; WRITES cancelled flag; REMOVES registry entry.
pub async fn delete_bulk_download_job(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (key, mut job) =
        ensure_bulk_job_owned(&state.folder_download_jobs, &claims.sub, &job_id).await?;
    job.cancelled = true;
    state.folder_download_jobs.set(key.clone(), job).await;
    let _ = crate::jobs::cancel_job_by_resource(
        &state.pool,
        &claims.sub,
        crate::jobs::JobKind::ZipBulk,
        "bulk_download",
        &job_id,
    )
    .await;
    let work_dir = std::env::temp_dir().join(format!("mv_bulk_zip_{job_id}"));
    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    state.folder_download_jobs.remove(&key).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
