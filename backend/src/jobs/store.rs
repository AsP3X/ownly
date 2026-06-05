// Human: Database operations for enqueue, claim, progress, completion, and stale-job recovery.
// Agent: DB WRITES background_jobs; CLAIM uses FOR UPDATE SKIP LOCKED; FAILURES re-queue or mark failed.

use sqlx::PgPool;

use crate::error::AppError;

use super::model::{BackgroundJob, JobKind, JobResponse, JobStatus};

/// Human: Insert a new queued job or return an existing active job for the same resource.
// Agent: INSERT background_jobs; CHECKS active resource before insert for dedup.
pub async fn enqueue_job(
    pool: &PgPool,
    user_id: &str,
    kind: JobKind,
    label: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    payload: serde_json::Value,
) -> Result<String, AppError> {
    if let (Some(rt), Some(rid)) = (resource_type, resource_id) {
        if let Some(existing) = find_active_job(pool, kind, rt, rid).await? {
            return Ok(existing.id);
        }
    }

    let job_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO background_jobs (id, user_id, kind, status, label, resource_type, resource_id, payload) \
         VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7)",
    )
    .bind(&job_id)
    .bind(user_id)
    .bind(kind.as_str())
    .bind(label)
    .bind(resource_type)
    .bind(resource_id)
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(job_id)
}

/// Human: Look up an in-flight or queued job for deduplication.
// Agent: READS background_jobs WHERE kind+resource AND status IN (queued,running).
pub async fn find_active_job(
    pool: &PgPool,
    kind: JobKind,
    resource_type: &str,
    resource_id: &str,
) -> Result<Option<BackgroundJob>, AppError> {
    let row = sqlx::query_as::<_, BackgroundJob>(
        "SELECT id, user_id, kind, status, progress, error, payload, resource_type, resource_id, label, \
         locked_by, locked_at, attempts, max_attempts, created_at, updated_at, completed_at \
         FROM background_jobs \
         WHERE kind = $1 AND resource_type = $2 AND resource_id = $3 AND status IN ('queued', 'running') \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(kind.as_str())
    .bind(resource_type)
    .bind(resource_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Human: Atomically claim the oldest queued job for a worker — only one worker wins per row.
// Agent: UPDATE … FOR UPDATE SKIP LOCKED; SETS status=running, locked_by, attempts+1.
pub async fn claim_next_job(pool: &PgPool, worker_id: &str) -> Result<Option<BackgroundJob>, AppError> {
    let row = sqlx::query_as::<_, BackgroundJob>(
        "UPDATE background_jobs SET \
            status = 'running', \
            locked_by = $1, \
            locked_at = now(), \
            updated_at = now(), \
            attempts = attempts + 1 \
         WHERE id = ( \
            SELECT id FROM background_jobs \
            WHERE status = 'queued' \
            ORDER BY created_at ASC \
            FOR UPDATE SKIP LOCKED \
            LIMIT 1 \
         ) \
         RETURNING id, user_id, kind, status, progress, error, payload, resource_type, resource_id, label, \
         locked_by, locked_at, attempts, max_attempts, created_at, updated_at, completed_at",
    )
    .bind(worker_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Human: Update job progress while a worker is running.
// Agent: WRITES progress + updated_at; ONLY when status=running.
pub async fn set_job_progress(pool: &PgPool, job_id: &str, progress: i32) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE background_jobs SET progress = $1, updated_at = now() WHERE id = $2 AND status = 'running'",
    )
    .bind(progress)
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Human: Mark a job complete and release the worker lock.
// Agent: WRITES status=complete only from running; CLEARS locked_by to avoid orphan locks.
pub async fn complete_job(pool: &PgPool, job_id: &str) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = 'complete', progress = 100, locked_by = NULL, locked_at = NULL, \
            completed_at = now(), updated_at = now(), error = NULL \
         WHERE id = $1 AND status = 'running'",
    )
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Human: Handle job failure — re-queue for retry or mark permanently failed.
// Agent: CLEARS lock always; ONLY updates running rows so finished jobs are not touched.
pub async fn fail_job(pool: &PgPool, job_id: &str, message: &str) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END, \
            error = $2, \
            locked_by = NULL, \
            locked_at = NULL, \
            updated_at = now() \
         WHERE id = $1 AND status = 'running'",
    )
    .bind(job_id)
    .bind(message)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Human: Finalize a running job as cancelled — releases lock so dedup index does not block.
// Agent: WRITES status=cancelled; CLEARS locked_by; USED when worker detects user cancel.
pub async fn finalize_cancelled_running(pool: &PgPool, job_id: &str) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = 'cancelled', locked_by = NULL, locked_at = NULL, updated_at = now() \
         WHERE id = $1 AND status = 'running'",
    )
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Human: Cancel a queued or running job owned by the user.
// Agent: WRITES status=cancelled; CLEARS lock fields.
pub async fn cancel_job(pool: &PgPool, user_id: &str, job_id: &str) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = 'cancelled', locked_by = NULL, locked_at = NULL, updated_at = now() \
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')",
    )
    .bind(job_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Human: Fetch one job by id for the authenticated user.
// Agent: READS background_jobs; RETURNS NotFound when missing or wrong owner.
pub async fn get_job_for_user(
    pool: &PgPool,
    user_id: &str,
    job_id: &str,
) -> Result<BackgroundJob, AppError> {
    sqlx::query_as::<_, BackgroundJob>(
        "SELECT id, user_id, kind, status, progress, error, payload, resource_type, resource_id, label, \
         locked_by, locked_at, attempts, max_attempts, created_at, updated_at, completed_at \
         FROM background_jobs WHERE id = $1 AND user_id = $2",
    )
    .bind(job_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Human: List recent jobs for the drive UI (active + recently finished).
// Agent: READS background_jobs for user; LIMIT 50 newest first.
pub async fn list_user_jobs(pool: &PgPool, user_id: &str) -> Result<Vec<JobResponse>, AppError> {
    let rows = sqlx::query_as::<_, BackgroundJob>(
        "SELECT id, user_id, kind, status, progress, error, payload, resource_type, resource_id, label, \
         locked_by, locked_at, attempts, max_attempts, created_at, updated_at, completed_at \
         FROM background_jobs \
         WHERE user_id = $1 \
         ORDER BY created_at DESC \
         LIMIT 50",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(JobResponse::from).collect())
}

/// Human: Immediately re-queue every running job after API restart — workers never survive a process exit.
// Agent: WRITES queued/failed; CLEARS locked_by; RUNS once at worker pool startup before claim loops.
pub async fn recover_running_jobs_on_startup(pool: &PgPool) -> Result<u64, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END, \
            error = CASE \
                WHEN attempts >= max_attempts THEN COALESCE(error, 'worker lost on restart') \
                ELSE error \
            END, \
            locked_by = NULL, \
            locked_at = NULL, \
            updated_at = now() \
         WHERE status = 'running'",
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

/// Human: Cancel an in-flight HLS encode for one file and mark the row so UI polling can stop.
// Agent: WRITES background_jobs cancelled; WRITES files.hls_encode_status=cancelled; CLEARS progress.
pub async fn cancel_hls_encode_for_file(
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<bool, AppError> {
    cancel_job_by_resource(pool, user_id, JobKind::HlsEncode, "file", file_id).await?;

    let result = sqlx::query(
        "UPDATE files SET hls_encode_status = 'cancelled', hls_encode_error = NULL, conversion_progress = 0 \
         WHERE id = $1 AND user_id = $2 AND NOT hls_ready",
    )
    .bind(file_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Human: Cancel an in-flight video thumbnail job and mark the row so UI polling can stop.
// Agent: WRITES background_jobs cancelled; WRITES files.video_thumbnail_status=cancelled.
pub async fn cancel_video_thumbnail_for_file(
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<(), AppError> {
    cancel_job_by_resource(pool, user_id, JobKind::VideoThumbnail, "file", file_id).await?;

    sqlx::query(
        "UPDATE files SET video_thumbnail_status = 'cancelled', video_thumbnail_error = NULL \
         WHERE id = $1 AND user_id = $2 AND NOT video_thumbnail_ready",
    )
    .bind(file_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Human: On startup and periodically, release running jobs whose worker stopped heartbeating.
// Agent: RE-QUEUES stale running rows; MARKS failed when attempts exhausted; NEVER leaves locked_by set.
pub async fn recover_stale_jobs(pool: &PgPool, stale_minutes: i64) -> Result<u64, AppError> {
    let stale_minutes = stale_minutes.clamp(1, i64::from(i32::MAX)) as i32;
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END, \
            error = CASE \
                WHEN attempts >= max_attempts THEN COALESCE(error, 'job timed out waiting for worker') \
                ELSE error \
            END, \
            locked_by = NULL, \
            locked_at = NULL, \
            updated_at = now() \
         WHERE status = 'running' \
           AND updated_at < now() - ($1::int * INTERVAL '1 minute')",
    )
    .bind(stale_minutes)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

/// Human: Worker heartbeat — proves the claim lock is still held by a live worker.
// Agent: WRITES locked_at + updated_at; ONLY when status=running AND locked_by matches worker.
pub async fn touch_job_heartbeat(
    pool: &PgPool,
    job_id: &str,
    worker_id: &str,
) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET locked_at = now(), updated_at = now() \
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(job_id)
    .bind(worker_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Human: Safety net after execute — re-queue if worker exited without completing/failing.
// Agent: CLEARS lock on running rows still owned by this worker; PREVENTS permanent orphan locks.
pub async fn ensure_worker_released_job(
    pool: &PgPool,
    job_id: &str,
    worker_id: &str,
) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE background_jobs SET \
            status = 'queued', \
            locked_by = NULL, \
            locked_at = NULL, \
            updated_at = now(), \
            error = COALESCE(error, 'worker exited before job finished') \
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(job_id)
    .bind(worker_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Human: Cancel active background job matching a resource (e.g. folder or bulk download id).
// Agent: WRITES status=cancelled for queued/running rows matching kind+resource.
pub async fn cancel_job_by_resource(
    pool: &PgPool,
    user_id: &str,
    kind: JobKind,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE background_jobs SET \
            status = 'cancelled', locked_by = NULL, locked_at = NULL, updated_at = now() \
         WHERE user_id = $1 AND kind = $2 AND resource_type = $3 AND resource_id = $4 \
           AND status IN ('queued', 'running')",
    )
    .bind(user_id)
    .bind(kind.as_str())
    .bind(resource_type)
    .bind(resource_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Human: Check whether a job was cancelled while a worker was running.
// Agent: READS status; RETURNS true when cancelled.
pub async fn is_job_cancelled(pool: &PgPool, job_id: &str) -> Result<bool, AppError> {
    let status: Option<(String,)> =
        sqlx::query_as("SELECT status FROM background_jobs WHERE id = $1")
            .bind(job_id)
            .fetch_optional(pool)
            .await?;

    Ok(status.is_some_and(|(s,)| s == JobStatus::Cancelled.as_str()))
}
