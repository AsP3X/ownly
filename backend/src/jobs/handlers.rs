// Human: HTTP handlers for listing, polling, and cancelling background jobs.
// Agent: GET /jobs; GET /jobs/:id; DELETE /jobs/:id; READS background_jobs for authenticated user.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Serialize;

use crate::{
    auth::handlers::Claims,
    error::AppError,
    AppState,
};

use super::model::JobResponse;
use super::store::{cancel_job, get_job_for_user, list_user_jobs};

#[derive(Debug, Serialize)]
pub struct JobListResponse {
    pub jobs: Vec<JobResponse>,
}

/// Human: List recent background jobs for the authenticated user (drive job tray).
// Agent: GET /api/v1/jobs; READS up to 50 newest jobs.
pub async fn list_jobs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<JobListResponse>, AppError> {
    let jobs = list_user_jobs(&state.pool, &claims.sub).await?;
    Ok(Json(JobListResponse { jobs }))
}

/// Human: Poll a single job by id for progress and status.
// Agent: GET /api/v1/jobs/:id; RETURNS NotFound when not owned.
pub async fn get_job(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(job_id): Path<String>,
) -> Result<Json<JobResponse>, AppError> {
    let job = get_job_for_user(&state.pool, &claims.sub, &job_id).await?;
    Ok(Json(JobResponse::from(job)))
}

/// Human: Cancel a queued or running background job.
// Agent: DELETE /api/v1/jobs/:id; WRITES status=cancelled; RETURNS ok:false when not cancellable.
pub async fn delete_job(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(job_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cancelled = cancel_job(&state.pool, &claims.sub, &job_id).await?;
    Ok(Json(serde_json::json!({ "ok": cancelled })))
}
