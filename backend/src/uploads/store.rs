// Human: Persist resumable upload session metadata and received part numbers in Postgres.
// Agent: READS/WRITES upload_sessions + upload_session_parts; USED by uploads handlers.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;

/// Human: Default chunk size for resumable uploads when the client omits chunk_size.
/// Agent: EXPOSED to frontend via create_session response; 16 MiB balances retry cost and request count.
pub const DEFAULT_CHUNK_SIZE: i64 = 16 * 1024 * 1024;

/// Human: Bounds for client-selected chunk sizes.
pub const MIN_CHUNK_SIZE: i64 = 1024 * 1024;
pub const MAX_CHUNK_SIZE: i64 = 32 * 1024 * 1024;

/// Human: Active sessions expire after this many hours when not completed.
pub const SESSION_TTL_HOURS: i64 = 72;

const SESSION_COLUMNS: &str = "id, user_id, file_id, folder_id, filename, mime_type, total_size, chunk_size, \
                bytes_received, storage_key, status, expires_at, content_hash, quota_owner_id, quota_reserved_bytes";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UploadSessionRow {
    pub id: String,
    pub user_id: String,
    pub file_id: String,
    pub folder_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub total_size: i64,
    pub chunk_size: i32,
    pub bytes_received: i64,
    pub storage_key: String,
    pub status: String,
    pub expires_at: DateTime<Utc>,
    pub content_hash: Option<String>,
    pub quota_owner_id: Option<String>,
    pub quota_reserved_bytes: i64,
}

// Human: Compute how many fixed-size chunks cover total_size (last part may be shorter).
// Agent: RETURNS ceil(total_size / chunk_size); MIN 1 when total_size > 0.
pub fn total_parts(total_size: i64, chunk_size: i64) -> i32 {
    if total_size <= 0 {
        return 0;
    }
    ((total_size + chunk_size - 1) / chunk_size) as i32
}

// Human: Expected byte length for a zero-based part index.
// Agent: LAST part may be shorter than chunk_size; REJECTS out-of-range part_number.
pub fn expected_part_size(total_size: i64, chunk_size: i64, part_number: i32) -> Result<i64, AppError> {
    if part_number < 0 {
        return Err(AppError::BadRequest("part_number must be non-negative".into()));
    }
    let parts = total_parts(total_size, chunk_size);
    if part_number >= parts {
        return Err(AppError::BadRequest("part_number out of range".into()));
    }
    let offset = (part_number as i64) * chunk_size;
    Ok(std::cmp::min(chunk_size, total_size - offset))
}

// Human: Insert a new active upload session and reserve quota_owner storage for total_size.
// Agent: WRITES upload_sessions with quota_reserved_bytes = total_size; PRE-ASSIGNS file_id + storage_key.
#[allow(clippy::too_many_arguments)]
pub async fn insert_session(
    pool: &PgPool,
    user_id: &str,
    file_owner_id: &str,
    folder_id: Option<&str>,
    filename: &str,
    mime_type: &str,
    total_size: i64,
    chunk_size: i32,
    content_hash: Option<&str>,
) -> Result<UploadSessionRow, AppError> {
    let session_id = Uuid::new_v4().to_string();
    let file_id = Uuid::new_v4().to_string();
    let storage_key = format!("users/{file_owner_id}/files/{file_id}");
    let expires_at = Utc::now() + chrono::Duration::hours(SESSION_TTL_HOURS);

    sqlx::query_as(&format!(
        "INSERT INTO upload_sessions \
         (id, user_id, file_id, folder_id, filename, mime_type, total_size, chunk_size, storage_key, \
          expires_at, content_hash, quota_owner_id, quota_reserved_bytes) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) \
         RETURNING {SESSION_COLUMNS}"
    ))
    .bind(&session_id)
    .bind(user_id)
    .bind(&file_id)
    .bind(folder_id)
    .bind(filename)
    .bind(mime_type)
    .bind(total_size)
    .bind(chunk_size)
    .bind(storage_key)
    .bind(expires_at)
    .bind(content_hash)
    .bind(file_owner_id)
    .bind(total_size)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

// Human: Load one session owned by the caller.
// Agent: READS upload_sessions WHERE id + user_id; ERRORS NotFound when missing or expired-aborted.
pub async fn load_session_for_user(
    pool: &PgPool,
    session_id: &str,
    user_id: &str,
) -> Result<UploadSessionRow, AppError> {
    sqlx::query_as(&format!(
        "SELECT {SESSION_COLUMNS} FROM upload_sessions WHERE id = $1 AND user_id = $2"
    ))
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound)
}

// Human: List part numbers already stored for resume polling.
// Agent: READS upload_session_parts ORDER BY part_number ASC.
pub async fn list_received_parts(pool: &PgPool, session_id: &str) -> Result<Vec<i32>, AppError> {
    let rows: Vec<(i32,)> = sqlx::query_as(
        "SELECT part_number FROM upload_session_parts \
         WHERE session_id = $1 ORDER BY part_number ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(n,)| n).collect())
}

// Human: Record one uploaded part and bump bytes_received atomically.
// Agent: UPSERT upload_session_parts; UPDATES upload_sessions.bytes_received; IDEMPOTENT when same size.
pub async fn record_part(
    pool: &PgPool,
    session_id: &str,
    part_number: i32,
    size_bytes: i64,
) -> Result<i64, AppError> {
    record_part_with_checksum(pool, session_id, part_number, size_bytes, None).await
}

// Human: Same as record_part but stores optional client content_sha256 for integrity.
// Agent: UPSERT part row; CONFLICT when size or checksum differs.
pub async fn record_part_with_checksum(
    pool: &PgPool,
    session_id: &str,
    part_number: i32,
    size_bytes: i64,
    content_sha256: Option<&str>,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;

    let existing: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT size_bytes, content_sha256 FROM upload_session_parts \
         WHERE session_id = $1 AND part_number = $2",
    )
    .bind(session_id)
    .bind(part_number)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((existing_size, existing_hash)) = existing {
        // Human: Placeholder rows from signed-url mint use size 0 — upgrade on first confirm.
        if existing_size == 0 && size_bytes > 0 {
            sqlx::query(
                "UPDATE upload_session_parts SET size_bytes = $3, content_sha256 = COALESCE($4, content_sha256) \
                 WHERE session_id = $1 AND part_number = $2",
            )
            .bind(session_id)
            .bind(part_number)
            .bind(size_bytes)
            .bind(content_sha256)
            .execute(&mut *tx)
            .await?;

            let (bytes_received,): (i64,) = sqlx::query_as(
                "UPDATE upload_sessions SET bytes_received = bytes_received + $2, updated_at = now() \
                 WHERE id = $1 RETURNING bytes_received",
            )
            .bind(session_id)
            .bind(size_bytes)
            .fetch_one(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(bytes_received);
        }

        if existing_size == size_bytes
            && (content_sha256.is_none()
                || existing_hash.as_deref() == content_sha256
                || existing_hash.is_none())
        {
            if content_sha256.is_some() && existing_hash.is_none() {
                sqlx::query(
                    "UPDATE upload_session_parts SET content_sha256 = $3 \
                     WHERE session_id = $1 AND part_number = $2",
                )
                .bind(session_id)
                .bind(part_number)
                .bind(content_sha256)
                .execute(&mut *tx)
                .await?;
            }
            let (bytes_received,): (i64,) = sqlx::query_as(
                "SELECT bytes_received FROM upload_sessions WHERE id = $1",
            )
            .bind(session_id)
            .fetch_one(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(bytes_received);
        }
        return Err(AppError::Conflict(
            "part already uploaded with a different size or checksum".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO upload_session_parts (session_id, part_number, size_bytes, content_sha256) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(session_id)
    .bind(part_number)
    .bind(size_bytes)
    .bind(content_sha256)
    .execute(&mut *tx)
    .await?;

    let (bytes_received,): (i64,) = sqlx::query_as(
        "UPDATE upload_sessions SET bytes_received = bytes_received + $2, updated_at = now() \
         WHERE id = $1 RETURNING bytes_received",
    )
    .bind(session_id)
    .bind(size_bytes)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(bytes_received)
}

// Human: Store a single-use signed-url token for a part (cleared on confirm).
// Agent: UPDATES upload_session_parts.signed_token; INSERT placeholder row if part not yet recorded.
pub async fn set_part_signed_token(
    pool: &PgPool,
    session_id: &str,
    part_number: i32,
    token: &str,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE upload_session_parts SET signed_token = $3 \
         WHERE session_id = $1 AND part_number = $2",
    )
    .bind(session_id)
    .bind(part_number)
    .bind(token)
    .execute(pool)
    .await?;

    if updated.rows_affected() == 0 {
        // Human: Token row before the part exists — store as zero-size placeholder; confirm replaces size.
        sqlx::query(
            "INSERT INTO upload_session_parts (session_id, part_number, size_bytes, signed_token) \
             VALUES ($1, $2, 0, $3) \
             ON CONFLICT (session_id, part_number) DO UPDATE SET signed_token = EXCLUDED.signed_token",
        )
        .bind(session_id)
        .bind(part_number)
        .bind(token)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// Human: Consume a single-use signed token — returns true when token matched and was cleared.
// Agent: UPDATE signed_token = NULL WHERE token matches; USED by confirm_part.
pub async fn consume_part_signed_token(
    pool: &PgPool,
    session_id: &str,
    part_number: i32,
    token: &str,
) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE upload_session_parts SET signed_token = NULL \
         WHERE session_id = $1 AND part_number = $2 AND signed_token = $3",
    )
    .bind(session_id)
    .bind(part_number)
    .bind(token)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// Human: Clear quota reservation after complete (file row now counts toward used_bytes).
// Agent: SETS quota_reserved_bytes = 0; IDEMPOTENT.
pub async fn clear_quota_reservation(pool: &PgPool, session_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE upload_sessions SET quota_reserved_bytes = 0, updated_at = now() WHERE id = $1",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

// Human: Mark session completing to prevent concurrent complete requests.
// Agent: UPDATE status completing WHERE active; ERRORS Conflict when not active.
pub async fn mark_completing(pool: &PgPool, session_id: &str, user_id: &str) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE upload_sessions SET status = 'completing', updated_at = now() \
         WHERE id = $1 AND user_id = $2 AND status = 'active'",
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "upload session is not active".into(),
        ));
    }
    Ok(())
}

// Human: Mark session complete after files row is registered.
// Agent: UPDATE status complete; CLEARS quota reservation.
pub async fn mark_complete(pool: &PgPool, session_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE upload_sessions SET status = 'complete', quota_reserved_bytes = 0, updated_at = now() \
         WHERE id = $1",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Human: One upload session aborted by the expiry sweeper — used for spool/staging cleanup + audit.
#[derive(Debug, Clone)]
pub struct ExpiredUploadSession {
    pub session_id: String,
    pub user_id: String,
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
}

// Human: Abort expired upload sessions and return metadata for cleanup + audit logging.
// Agent: UPDATE status aborted; CLEARS quota reservation; spool uses file_id; staging uses session_id.
pub async fn expire_stale_upload_sessions(
    pool: &PgPool,
) -> Result<Vec<ExpiredUploadSession>, AppError> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "UPDATE upload_sessions SET status = 'aborted', quota_reserved_bytes = 0, updated_at = now() \
         WHERE status IN ('active', 'completing') AND expires_at < now() \
         RETURNING id, user_id, file_id, filename, mime_type",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(session_id, user_id, file_id, filename, mime_type)| ExpiredUploadSession {
                session_id,
                user_id,
                file_id,
                filename,
                mime_type,
            },
        )
        .collect())
}

// Human: True when an ownly_upload_* directory belongs to an in-flight resumable session.
// Agent: MATCHES spool suffix against session id or pre-assigned file_id while active/completing.
pub async fn is_active_resumable_upload_spool(pool: &PgPool, spool_id: &str) -> bool {
    let row: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM upload_sessions \
         WHERE (id = $1 OR file_id = $1) AND status IN ('active', 'completing') \
         LIMIT 1",
    )
    .bind(spool_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.is_some()
}

// Human: Abort an active session so clients can discard partial spool data.
// Agent: UPDATE status aborted + clear reservation; RETURNS previous row for cleanup.
pub async fn mark_aborted(
    pool: &PgPool,
    session_id: &str,
    user_id: &str,
) -> Result<Option<UploadSessionRow>, AppError> {
    sqlx::query_as(&format!(
        "UPDATE upload_sessions SET status = 'aborted', quota_reserved_bytes = 0, updated_at = now() \
         WHERE id = $1 AND user_id = $2 AND status IN ('active', 'completing') \
         RETURNING {SESSION_COLUMNS}"
    ))
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)
}

// Human: Count in-flight upload sessions for admin health.
// Agent: READS upload_sessions WHERE active/completing.
pub async fn count_active_sessions(pool: &PgPool) -> Result<i64, AppError> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT FROM upload_sessions WHERE status IN ('active', 'completing')",
    )
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

// Human: Sum reserved quota bytes across all active sessions (ops view).
// Agent: SUM quota_reserved_bytes for active/completing.
pub async fn sum_active_reserved_bytes(pool: &PgPool) -> Result<i64, AppError> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(quota_reserved_bytes), 0)::BIGINT FROM upload_sessions \
         WHERE status IN ('active', 'completing')",
    )
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
