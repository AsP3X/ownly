// Human: File delete preview and background delete jobs with blob-level progress polling.
// Agent: READS files.segment_count; SPAWNS tokio delete tasks; UPDATES in-memory DeleteJobRegistry.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        file_delete::{
            delete_owned_file_row_with_progress, storage_object_count,
        },
        processing::ensure_files_not_processing,
        recycle_bin,
    },
    AppState,
};

/// Human: Cap per POST /files/delete request so one job stays bounded.
/// Agent: RECYCLE-BIN empty uses [`start_delete_job`] with `enforce_max = false` instead.
pub const MAX_DELETE_FILES_PER_JOB: usize = 500;

type FilePreviewRow = (String, String, Option<i32>);

#[derive(Debug, Clone)]
pub struct DeleteJob {
    pub status: String,
    pub progress: i32,
    pub total_blobs: u32,
    pub deleted_blobs: u32,
    pub total_files: u32,
    pub deleted_files: u32,
    pub ready: bool,
    pub error: Option<String>,
    pub deleted_file_ids: Vec<String>,
    pub cancelled: bool,
}

#[derive(Clone, Default)]
pub struct DeleteJobRegistry {
    inner: Arc<RwLock<HashMap<String, DeleteJob>>>,
}

impl DeleteJobRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn job_key(user_id: &str, job_id: &str) -> String {
        format!("{user_id}:delete:{job_id}")
    }

    pub async fn get(&self, key: &str) -> Option<DeleteJob> {
        self.inner.read().await.get(key).cloned()
    }

    pub async fn set(&self, key: String, job: DeleteJob) {
        self.inner.write().await.insert(key, job);
    }

    pub async fn remove(&self, key: &str) {
        self.inner.write().await.remove(key);
    }
}

#[derive(Debug, Serialize)]
pub struct FileDeletionPreviewItem {
    pub id: String,
    pub name: String,
    pub storage_object_count: u32,
    pub segment_count: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct FileDeletionPreviewResponse {
    pub id: String,
    pub name: String,
    pub storage_object_count: u32,
    pub segment_count: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct BulkDeletionPreviewResponse {
    pub file_count: u32,
    pub storage_object_count: u32,
    pub files: Vec<FileDeletionPreviewItem>,
}

#[derive(Debug, Deserialize)]
pub struct BulkDeletionPreviewRequest {
    pub file_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct StartDeleteJobRequest {
    pub file_ids: Vec<String>,
    #[serde(default)]
    pub permanent: bool,
}

#[derive(Debug, Serialize)]
pub struct DeleteJobStatusResponse {
    pub job_id: String,
    pub status: String,
    pub progress: i32,
    pub total_blobs: u32,
    pub deleted_blobs: u32,
    pub total_files: u32,
    pub deleted_files: u32,
    pub ready: bool,
    pub error: Option<String>,
    pub deleted_file_ids: Vec<String>,
}

// Human: Map registry state to the JSON shape polled by delete confirmation dialogs.
// Agent: READS DeleteJob; RETURNS progress percent from deleted_blobs / total_blobs.
fn delete_status_json(job_id: &str, job: &DeleteJob) -> DeleteJobStatusResponse {
    DeleteJobStatusResponse {
        job_id: job_id.to_string(),
        status: job.status.clone(),
        progress: if job.ready {
            100
        } else if job.total_blobs == 0 {
            0
        } else {
            ((job.deleted_blobs as f64 / job.total_blobs as f64) * 100.0).round() as i32
        },
        total_blobs: job.total_blobs,
        deleted_blobs: job.deleted_blobs,
        total_files: job.total_files,
        deleted_files: job.deleted_files,
        ready: job.ready,
        error: job.error.clone(),
        deleted_file_ids: job.deleted_file_ids.clone(),
    }
}

// Human: Normalize client file id list and optionally reject oversized bulk requests.
// Agent: TRIMS ids; WHEN enforce_max, caps at MAX_DELETE_FILES_PER_JOB; RETURNS owned Vec<String>.
fn normalize_file_ids(
    file_ids: Vec<String>,
    enforce_max: bool,
) -> Result<Vec<String>, AppError> {
    let ids: Vec<String> = file_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if ids.is_empty() {
        return Err(AppError::BadRequest("file_ids must not be empty".into()));
    }
    if enforce_max && ids.len() > MAX_DELETE_FILES_PER_JOB {
        return Err(AppError::BadRequest(format!(
            "cannot delete more than {} files at once",
            MAX_DELETE_FILES_PER_JOB
        )));
    }
    Ok(ids)
}

// Human: Load owned file rows for preview/delete and compute per-file blob counts.
// Agent: SELECT files WHERE user_id AND id = ANY($2); ERRORS when any id is missing.
async fn load_owned_files_for_delete(
    pool: &sqlx::PgPool,
    user_id: &str,
    file_ids: &[String],
) -> Result<Vec<FilePreviewRow>, AppError> {
    let rows: Vec<FilePreviewRow> = sqlx::query_as(
        "SELECT id, name, segment_count FROM files \
         WHERE user_id = $1 AND id = ANY($2) ORDER BY name ASC",
    )
    .bind(user_id)
    .bind(file_ids)
    .fetch_all(pool)
    .await?;

    if rows.len() != file_ids.len() {
        return Err(AppError::NotFound);
    }

    Ok(rows)
}

// Human: Build preview items and total blob count from loaded file rows.
// Agent: MAPS segment_count through storage_object_count; SUMS storage_object_count.
fn preview_from_rows(rows: &[FilePreviewRow]) -> BulkDeletionPreviewResponse {
    let files: Vec<FileDeletionPreviewItem> = rows
        .iter()
        .map(|(id, name, segment_count)| {
            let storage_object_count = storage_object_count(*segment_count);
            FileDeletionPreviewItem {
                id: id.clone(),
                name: name.clone(),
                storage_object_count,
                segment_count: *segment_count,
            }
        })
        .collect();
    let storage_object_count = files
        .iter()
        .map(|file| file.storage_object_count)
        .sum();

    BulkDeletionPreviewResponse {
        file_count: files.len() as u32,
        storage_object_count,
        files,
    }
}

// Human: Preview blob purge scope for one owned file before confirming delete.
// Agent: GET /files/:id/deletion-preview; READ-ONLY files row; NO storage mutations.
pub async fn file_deletion_preview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<FileDeletionPreviewResponse>, AppError> {
    let rows = load_owned_files_for_delete(&state.pool, &claims.sub, &[id]).await?;
    let preview = preview_from_rows(&rows);
    let file = preview
        .files
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)?;

    Ok(Json(FileDeletionPreviewResponse {
        id: file.id,
        name: file.name,
        storage_object_count: file.storage_object_count,
        segment_count: file.segment_count,
    }))
}

// Human: Preview total blob count for a multi-select delete confirmation dialog.
// Agent: POST /files/deletion-preview; READS owned file rows; NO storage mutations.
pub async fn bulk_deletion_preview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<BulkDeletionPreviewRequest>,
) -> Result<Json<BulkDeletionPreviewResponse>, AppError> {
    let file_ids = normalize_file_ids(body.file_ids, true)?;
    let rows = load_owned_files_for_delete(&state.pool, &claims.sub, &file_ids).await?;
    Ok(Json(preview_from_rows(&rows)))
}

// Human: Preview blob purge scope for an arbitrary owned file id list (including recycle bin rows).
// Agent: READS files by id; SUMS storage_object_count; USED by recycle-bin deletion-preview route.
pub async fn preview_files_for_permanent_delete(
    pool: &sqlx::PgPool,
    user_id: &str,
    file_ids: Vec<String>,
) -> Result<BulkDeletionPreviewResponse, AppError> {
    let file_ids = normalize_file_ids(file_ids, false)?;
    let rows = load_owned_files_for_delete(pool, user_id, &file_ids).await?;
    Ok(preview_from_rows(&rows))
}

// Human: Start a delete job for an arbitrary owned file id list (no per-request file cap).
// Agent: SPAWNS run_delete_job; USED by recycle-bin empty; AUDIT files.delete.start.
pub async fn start_delete_job(
    state: &Arc<AppState>,
    user_id: &str,
    headers: &HeaderMap,
    file_ids: Vec<String>,
    permanent: bool,
) -> Result<DeleteJobStatusResponse, AppError> {
    let file_ids = normalize_file_ids(file_ids, false)?;
    ensure_files_not_processing(&state.pool, user_id, &file_ids).await?;
    let preview_rows = load_owned_files_for_delete(&state.pool, user_id, &file_ids).await?;
    let preview = preview_from_rows(&preview_rows);

    let job_id = Uuid::new_v4().to_string();
    let key = DeleteJobRegistry::job_key(user_id, &job_id);
    let job = DeleteJob {
        status: "queued".to_string(),
        progress: 0,
        total_blobs: if permanent {
            preview.storage_object_count
        } else {
            0
        },
        deleted_blobs: 0,
        total_files: preview.file_count,
        deleted_files: 0,
        ready: false,
        error: None,
        deleted_file_ids: Vec::new(),
        cancelled: false,
    };
    state.delete_jobs.set(key.clone(), job.clone()).await;

    let audit_action = if permanent {
        "files.delete.start"
    } else {
        "files.trash.start"
    };
    audit::write_audit(
        &state.pool,
        Some(user_id),
        audit_action,
        Some("delete_job"),
        Some(&job_id),
        Some(serde_json::json!({
            "file_count": preview.file_count,
            "storage_object_count": preview.storage_object_count,
        })),
        headers,
    )
    .await
    .ok();

    let work_state = state.clone();
    let work_user = user_id.to_string();
    let work_headers = headers.clone();
    tokio::spawn(async move {
        run_delete_job(
            work_state,
            work_user,
            key,
            file_ids,
            permanent,
            work_headers,
        )
        .await;
    });

    Ok(delete_status_json(&job_id, &job))
}

// Human: Ensure the caller owns the delete job before polling status.
// Agent: READS registry key user_id:delete:job_id; RETURNS NotFound when missing.
async fn ensure_delete_job_owned(
    registry: &DeleteJobRegistry,
    user_id: &str,
    job_id: &str,
) -> Result<(String, DeleteJob), AppError> {
    let key = DeleteJobRegistry::job_key(user_id, job_id);
    let job = registry.get(&key).await.ok_or(AppError::NotFound)?;
    Ok((key, job))
}

// Human: Background worker that deletes files sequentially and updates blob progress in the registry.
// Agent: CALLS delete_owned_file_row_with_progress; WRITES audit files.delete per success.
async fn run_delete_job(
    state: Arc<AppState>,
    user_id: String,
    registry_key: String,
    file_ids: Vec<String>,
    permanent: bool,
    headers: HeaderMap,
) {
    use std::sync::{
        atomic::{AtomicU32, Ordering},
        Arc as StdArc,
    };

    let rows = match load_owned_files_for_delete(&state.pool, &user_id, &file_ids).await {
        Ok(rows) => rows,
        Err(error) => {
            if let Some(mut job) = state.delete_jobs.get(&registry_key).await {
                job.status = "failed".to_string();
                job.ready = true;
                job.error = Some(error.to_string());
                state.delete_jobs.set(registry_key, job).await;
            }
            return;
        }
    };

    let total_blobs: u32 = if permanent {
        rows
            .iter()
            .map(|(_, _, segment_count)| storage_object_count(*segment_count))
            .sum()
    } else {
        0
    };
    let total_files = rows.len() as u32;

    if let Some(mut job) = state.delete_jobs.get(&registry_key).await {
        job.status = "deleting".to_string();
        job.total_blobs = total_blobs;
        job.total_files = total_files;
        state.delete_jobs.set(registry_key.clone(), job).await;
    }

    let deleted_blobs = StdArc::new(AtomicU32::new(0));
    let reporter_blobs = deleted_blobs.clone();
    let reporter_state = state.clone();
    let reporter_key = registry_key.clone();
    let reporter_total = total_blobs;
    let reporter = tokio::spawn(async move {
        loop {
            let current = reporter_blobs.load(Ordering::Relaxed);
            if let Some(mut job) = reporter_state.delete_jobs.get(&reporter_key).await {
                job.deleted_blobs = current;
                job.progress = if reporter_total == 0 {
                    0
                } else {
                    ((current as f64 / reporter_total as f64) * 100.0).round() as i32
                };
                reporter_state.delete_jobs.set(reporter_key.clone(), job).await;
            }
            if reporter_state
                .delete_jobs
                .get(&reporter_key)
                .await
                .is_some_and(|job| job.ready || job.cancelled)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    });

    let mut deleted_files = 0u32;
    let mut deleted_file_ids = Vec::new();
    let mut first_error: Option<String> = None;

    for (file_id, _name, _segment_count) in rows {
        if state
            .delete_jobs
            .get(&registry_key)
            .await
            .is_some_and(|job| job.cancelled)
        {
            break;
        }

        let delete_result = if permanent {
            let blob_counter = deleted_blobs.clone();
            delete_owned_file_row_with_progress(
                &state,
                &state.pool,
                &user_id,
                &file_id,
                move |_file_deleted, _file_total| {
                    blob_counter.fetch_add(1, Ordering::Relaxed);
                },
            )
            .await
            .map(|deleted| deleted.name)
        } else {
            recycle_bin::soft_delete_owned_file(&state.pool, &user_id, &file_id)
                .await
        };

        match delete_result {
            Ok(deleted_name) => {
                deleted_files = deleted_files.saturating_add(1);
                deleted_file_ids.push(file_id.clone());

                let action = if permanent {
                    "files.delete.permanent"
                } else {
                    "files.trash"
                };
                audit::write_audit(
                    &state.pool,
                    Some(&user_id),
                    action,
                    Some("file"),
                    Some(&file_id),
                    Some(serde_json::json!({ "name": deleted_name })),
                    &headers,
                )
                .await
                .ok();
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(format!("{file_id}: {error}"));
                }
            }
        }

        if let Some(mut job) = state.delete_jobs.get(&registry_key).await {
            job.deleted_blobs = deleted_blobs.load(Ordering::Relaxed);
            job.deleted_files = deleted_files;
            job.deleted_file_ids = deleted_file_ids.clone();
            job.progress = if total_blobs == 0 {
                100
            } else {
                ((job.deleted_blobs as f64 / total_blobs as f64) * 100.0).round() as i32
            };
            state.delete_jobs.set(registry_key.clone(), job).await;
        }
    }

    reporter.abort();

    if let Some(mut job) = state.delete_jobs.get(&registry_key).await {
        job.ready = true;
        job.deleted_blobs = deleted_blobs.load(Ordering::Relaxed);
        job.deleted_files = deleted_files;
        job.deleted_file_ids = deleted_file_ids;
        job.progress = 100;
        if job.cancelled {
            job.status = "cancelled".to_string();
        } else if deleted_files == 0 {
            job.status = "failed".to_string();
            job.error = Some(
                first_error.unwrap_or_else(|| "Could not delete the selected files.".into()),
            );
        } else if deleted_files < total_files {
            job.status = "failed".to_string();
            job.error = Some(format!(
                "Deleted {deleted_files} of {total_files} files. {}",
                first_error.unwrap_or_default()
            ));
        } else {
            job.status = "complete".to_string();
        }
        state.delete_jobs.set(registry_key, job).await;
    }
}

// Human: Start an async delete job for one or more owned files with blob progress polling.
// Agent: POST /files/delete; SPAWNS run_delete_job; AUDIT files.delete.start.
pub async fn post_delete_job(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<StartDeleteJobRequest>,
) -> Result<Json<DeleteJobStatusResponse>, AppError> {
    let file_ids = normalize_file_ids(body.file_ids, true)?;
    let status = start_delete_job(&state, &claims.sub, &headers, file_ids, body.permanent).await?;
    Ok(Json(status))
}

// Human: Poll blob-level delete progress for an in-flight delete job.
// Agent: GET /files/delete/:job_id; READ-ONLY registry lookup.
pub async fn get_delete_job_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(job_id): Path<String>,
) -> Result<Json<DeleteJobStatusResponse>, AppError> {
    let (_, job) = ensure_delete_job_owned(&state.delete_jobs, &claims.sub, &job_id).await?;
    Ok(Json(delete_status_json(&job_id, &job)))
}

// Human: Cancel an in-flight delete job and drop registry state.
// Agent: DELETE /files/delete/:job_id; WRITES cancelled flag; REMOVES registry entry after pause.
pub async fn cancel_delete_job(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(job_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (key, mut job) =
        ensure_delete_job_owned(&state.delete_jobs, &claims.sub, &job_id).await?;
    job.cancelled = true;
    state.delete_jobs.set(key.clone(), job).await;
    state.delete_jobs.remove(&key).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use crate::files::file_delete::storage_object_count;

    #[test]
    fn storage_object_count_matches_delete_attempts() {
        assert_eq!(storage_object_count(None), 5);
        assert_eq!(storage_object_count(Some(0)), 5);
        assert_eq!(storage_object_count(Some(12)), 17);
    }
}
