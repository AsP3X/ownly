// Human: HTTP handlers for resumable chunked uploads — session, parts, complete, abort.
// Agent: ROUTES /api/v1/uploads/*; WRITES temp parts; CALLS finalize_spooled_upload on complete.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        folders::ensure_folder_owned,
        handlers::UploadResponse,
        upload_finalize::{finalize_spooled_upload, SpooledUploadInput},
        upload_spool::{cleanup_upload_work_dir, upload_is_video, upload_work_dir},
        upload_validation::normalize_upload_filename,
    },
    rate_limit,
    request_tracking,
    AppState,
};

use super::assemble::assemble_session_parts;
use super::store::{
    expected_part_size, insert_session, list_received_parts, load_session_for_user, mark_aborted,
    mark_complete, mark_completing, record_part, total_parts, UploadSessionRow, DEFAULT_CHUNK_SIZE,
    MAX_CHUNK_SIZE, MIN_CHUNK_SIZE,
};

#[derive(Debug, Deserialize)]
pub struct CreateUploadSessionRequest {
    pub filename: String,
    pub folder_id: Option<String>,
    pub total_size: i64,
    pub content_type: Option<String>,
    pub chunk_size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct UploadSessionResponse {
    pub session_id: String,
    pub file_id: String,
    pub chunk_size: i32,
    pub total_parts: i32,
    pub total_size: i64,
    pub bytes_received: i64,
    pub parts_received: Vec<i32>,
    pub status: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct UploadPartResponse {
    pub part_number: i32,
    pub bytes_received: i64,
    pub total_size: i64,
}

fn session_to_response(session: &UploadSessionRow, parts_received: Vec<i32>) -> UploadSessionResponse {
    UploadSessionResponse {
        session_id: session.id.clone(),
        file_id: session.file_id.clone(),
        chunk_size: session.chunk_size,
        total_parts: total_parts(session.total_size, session.chunk_size as i64),
        total_size: session.total_size,
        bytes_received: session.bytes_received,
        parts_received,
        status: session.status.clone(),
        expires_at: session.expires_at,
    }
}

fn ensure_session_active(session: &UploadSessionRow) -> Result<(), AppError> {
    if session.status != "active" {
        return Err(AppError::Conflict(format!(
            "upload session is {}",
            session.status
        )));
    }
    if session.expires_at < chrono::Utc::now() {
        return Err(AppError::Conflict("upload session expired".into()));
    }
    Ok(())
}

fn normalize_chunk_size(value: Option<i64>) -> Result<i32, AppError> {
    let chunk_size = value.unwrap_or(DEFAULT_CHUNK_SIZE);
    if !(MIN_CHUNK_SIZE..=MAX_CHUNK_SIZE).contains(&chunk_size) {
        return Err(AppError::BadRequest(format!(
            "chunk_size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE}"
        )));
    }
    Ok(chunk_size as i32)
}

// Human: Start a resumable upload session and prepare temp part storage on disk.
// Agent: POST /uploads; RATE LIMITED; AUDIT uploads.session.create; RETURNS session metadata.
pub async fn create_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    headers: HeaderMap,
    Json(body): Json<CreateUploadSessionRequest>,
) -> Result<Json<UploadSessionResponse>, AppError> {
    rate_limit::enforce(&state.upload_rl, &claims.sub)?;

    if body.total_size <= 0 {
        return Err(AppError::BadRequest("total_size must be positive".into()));
    }
    if body.total_size as u64 > state.max_upload_bytes {
        return Err(AppError::BadRequest(
            "file exceeds maximum upload size".into(),
        ));
    }

    crate::quota::ensure_within_quota(&state.pool, &claims.sub, body.total_size).await?;

    let filename = normalize_upload_filename(&body.filename)?;
    if let Some(ref folder_id) = body.folder_id {
        ensure_folder_owned(&state.pool, &claims.sub, folder_id).await?;
    }

    let chunk_size = normalize_chunk_size(body.chunk_size)?;
    let guessed_mime = mime_guess::from_path(&filename)
        .first_or_octet_stream()
        .to_string();
    let content_type = body
        .content_type
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or(guessed_mime.as_str());
    let mime = if content_type.starts_with("video/") && !guessed_mime.starts_with("video/") {
        guessed_mime
    } else {
        content_type.to_string()
    };

    let session = insert_session(
        &state.pool,
        &claims.sub,
        body.folder_id.as_deref(),
        &filename,
        &mime,
        body.total_size,
        chunk_size,
    )
    .await?;

    let work_dir = upload_work_dir(&session.id);
    tokio::fs::create_dir_all(work_dir.join("parts"))
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("create upload parts dir: {error}")))?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "uploads.session.create",
        Some("upload_session"),
        Some(&session.id),
        Some(serde_json::json!({
            "filename": filename,
            "total_size": body.total_size,
            "chunk_size": chunk_size
        })),
        &headers,
    )
    .await
    .ok();

    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        session_id = %session.id,
        file_id = %session.file_id,
        total_size = body.total_size,
        chunk_size,
        "uploads.session.create"
    );

    Ok(Json(session_to_response(&session, Vec::new())))
}

// Human: Poll upload progress — lists received part numbers for resume after network loss.
// Agent: GET /uploads/{id}; READS upload_session_parts; RETURNS bytes_received + parts_received.
pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
) -> Result<Json<UploadSessionResponse>, AppError> {
    let session = load_session_for_user(&state.pool, &session_id, &claims.sub).await?;
    let parts_received = list_received_parts(&state.pool, &session_id).await?;
    Ok(Json(session_to_response(&session, parts_received)))
}

// Human: Upload one idempotent chunk for an active session.
// Agent: PUT /uploads/{id}/parts/{part_number}; WRITES work_dir/parts/{n}; UPDATES bytes_received.
pub async fn upload_part(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    Path((session_id, part_number)): Path<(String, i32)>,
    body: Bytes,
) -> Result<Json<UploadPartResponse>, AppError> {
    rate_limit::enforce(&state.upload_rl, &claims.sub)?;

    let session = load_session_for_user(&state.pool, &session_id, &claims.sub).await?;
    ensure_session_active(&session)?;

    let expected =
        expected_part_size(session.total_size, session.chunk_size as i64, part_number)?;
    if body.len() as i64 != expected {
        return Err(AppError::BadRequest(format!(
            "part {part_number} must be exactly {expected} bytes"
        )));
    }

    let work_dir = upload_work_dir(&session.id);
    tokio::fs::create_dir_all(work_dir.join("parts"))
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("create upload parts dir: {error}")))?;

    let part_path = work_dir.join("parts").join(part_number.to_string());

    let mut file = tokio::fs::File::create(&part_path).await.map_err(|error| {
        AppError::Internal(anyhow::anyhow!("create upload part file: {error}"))
    })?;
    file.write_all(&body)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("write upload part: {error}")))?;

    let bytes_received =
        record_part(&state.pool, &session_id, part_number, body.len() as i64).await?;

    tracing::debug!(
        request_id = %request_id.0,
        session_id = %session_id,
        part_number,
        part_bytes = body.len(),
        bytes_received,
        "uploads.part.received"
    );

    Ok(Json(UploadPartResponse {
        part_number,
        bytes_received,
        total_size: session.total_size,
    }))
}

// Human: Assemble received parts and register the file using the shared finalize path.
// Agent: POST /uploads/{id}/complete; CALLS assemble_session_parts + finalize_spooled_upload.
pub async fn complete_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<UploadResponse>, AppError> {
    let session = load_session_for_user(&state.pool, &session_id, &claims.sub).await?;
    ensure_session_active(&session)?;

    let parts = total_parts(session.total_size, session.chunk_size as i64);
    let received = list_received_parts(&state.pool, &session_id).await?;
    if received.len() as i32 != parts {
        return Err(AppError::Conflict(format!(
            "upload incomplete: received {} of {parts} parts",
            received.len()
        )));
    }
    if session.bytes_received != session.total_size {
        return Err(AppError::Conflict(
            "upload bytes_received does not match total_size".into(),
        ));
    }

    mark_completing(&state.pool, &session_id, &claims.sub).await?;

    let work_dir = upload_work_dir(&session.id);
    let (tmp_path, size_bytes) = match assemble_session_parts(&session, &work_dir).await {
        Ok(result) => result,
        Err(error) => {
            let _ = sqlx::query(
                "UPDATE upload_sessions SET status = 'active', updated_at = now() WHERE id = $1",
            )
            .bind(&session_id)
            .execute(&state.pool)
            .await;
            return Err(error);
        }
    };

    let mut mime = session.mime_type.clone();
    if !upload_is_video(&session.filename, &mime) {
        if let Ok(head) = crate::files::gif_preview::read_file_magic_head(&tmp_path).await {
            mime = crate::files::gif_preview::reconcile_upload_image_mime(&head, &mime);
        }
    }

    let file = match finalize_spooled_upload(
        &state,
        &request_id,
        &headers,
        SpooledUploadInput {
            file_id: session.file_id.clone(),
            user_id: claims.sub.clone(),
            folder_id: session.folder_id.clone(),
            filename: session.filename.clone(),
            storage_key: session.storage_key.clone(),
            mime,
            work_dir: work_dir.clone(),
            tmp_path,
            size_bytes,
            resumable: true,
        },
    )
    .await
    {
        Ok(file) => file,
        Err(error) => {
            let _ = sqlx::query(
                "UPDATE upload_sessions SET status = 'active', updated_at = now() WHERE id = $1",
            )
            .bind(&session_id)
            .execute(&state.pool)
            .await;
            return Err(error);
        }
    };

    mark_complete(&state.pool, &session_id).await?;
    cleanup_upload_work_dir(&work_dir).await;

    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        session_id = %session_id,
        file_id = %file.id,
        size_bytes = file.size_bytes,
        "uploads.session.complete"
    );

    Ok(Json(UploadResponse { file }))
}

// Human: Abort a partial upload and remove spooled part files from disk.
// Agent: DELETE /uploads/{id}; AUDIT uploads.session.abort; WRITES status aborted.
pub async fn abort_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let session = mark_aborted(&state.pool, &session_id, &claims.sub).await?;
    let Some(session) = session else {
        return Err(AppError::NotFound);
    };

    cleanup_upload_work_dir(&upload_work_dir(&session.id)).await;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "uploads.session.abort",
        Some("upload_session"),
        Some(&session_id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "aborted": true })))
}
