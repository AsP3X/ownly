// Human: HTTP handlers for resumable chunked uploads — session, parts, complete, abort.
// Agent: ROUTES /api/v1/uploads/*; video spools to disk; non-video stages parts in object storage.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};

use futures_util::stream;
use sha2::{Digest, Sha256};

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        access::resolve_upload_file_owner,
        handlers::UploadResponse,
        upload_finalize::{
            finalize_instant_dedup_upload, finalize_spooled_upload, finalize_staged_upload,
            InstantDedupInput, SpooledUploadInput, StagedUploadInput,
        },
        upload_spool::{cleanup_upload_work_dir, upload_is_video, upload_work_dir},
        upload_staging::{cleanup_staging_prefix, staging_part_key},
        upload_validation::{normalize_content_hash, normalize_upload_filename},
    },
    rate_limit,
    request_tracking,
    storage::StorageStream,
    AppState,
};

use super::assemble::{append_part_to_source, resolve_session_source};
use super::store::{
    consume_part_signed_token, count_active_sessions_for_user, expected_part_size, insert_session,
    list_received_parts, load_session_for_user, mark_aborted, mark_all_aborted_for_user,
    mark_complete, mark_completing,
    part_signed_token_matches, record_part_with_checksum, set_part_signed_token, total_parts,
    UploadSessionRow, DEFAULT_CHUNK_SIZE, MAX_ACTIVE_SESSIONS_PER_USER, MAX_CHUNK_SIZE,
    MIN_CHUNK_SIZE,
};

#[derive(Debug, Deserialize)]
pub struct CreateUploadSessionRequest {
    pub filename: String,
    pub folder_id: Option<String>,
    pub total_size: i64,
    pub content_type: Option<String>,
    pub chunk_size: Option<i64>,
    /// Human: Optional client SHA-256 for early per-user dedup before any part bytes.
    pub content_hash: Option<String>,
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
    /// Human: When true, non-video clients should PUT parts to signed Nebular URLs then confirm.
    /// Agent: FALSE for video (local spool) and MemoryStorage tests; TRUE when storage supports presigned PUT.
    pub direct_upload: bool,
    /// Human: When set, client may skip part upload and POST complete for instant dedup register.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dedup_source_file_id: Option<String>,
    /// Human: Matching content lives only in recycle bin — client may offer restore instead of re-upload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recycle_match_file_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadPartResponse {
    pub part_number: i32,
    pub bytes_received: i64,
    pub total_size: i64,
}

#[derive(Debug, Serialize)]
pub struct SignedPartUrlResponse {
    pub part_number: i32,
    pub upload_url: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub content_type: String,
    pub expected_bytes: i64,
    /// Human: Single-use token required on confirm so a stolen signed URL alone is not enough.
    pub confirm_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmPartRequest {
    /// Human: Token from signed-url response — required for direct-upload confirm.
    pub confirm_token: Option<String>,
    /// Human: Optional client SHA-256 of the part body for integrity.
    pub content_sha256: Option<String>,
}

/// Human: Max lifetime for a browser-direct part PUT URL (shorter than download presigns).
const DIRECT_PART_URL_TTL_SECS: u64 = 30 * 60;

fn session_direct_upload(state: &AppState, session: &UploadSessionRow) -> bool {
    !upload_is_video(&session.filename, &session.mime_type) && state.storage.supports_presigned_put()
}

fn session_to_response(
    state: &AppState,
    session: &UploadSessionRow,
    parts_received: Vec<i32>,
) -> UploadSessionResponse {
    session_to_response_ext(state, session, parts_received, None, None)
}

fn session_to_response_ext(
    state: &AppState,
    session: &UploadSessionRow,
    parts_received: Vec<i32>,
    dedup_source_file_id: Option<String>,
    recycle_match_file_id: Option<String>,
) -> UploadSessionResponse {
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
        direct_upload: session_direct_upload(state, session),
        dedup_source_file_id,
        recycle_match_file_id,
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

// Human: Start a resumable upload session — video preps local spool; non-video stages in object storage.
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

    let active_sessions = count_active_sessions_for_user(&state.pool, &claims.sub).await?;
    if active_sessions >= MAX_ACTIVE_SESSIONS_PER_USER {
        return Err(AppError::BadRequest(format!(
            "too many active upload sessions (max {MAX_ACTIVE_SESSIONS_PER_USER}) — complete or cancel existing uploads first"
        )));
    }

    let filename = normalize_upload_filename(&body.filename)?;
    let file_owner_id = resolve_upload_file_owner(
        &state.pool,
        &claims.sub,
        body.folder_id.as_deref(),
    )
    .await?;

    if let Err(error) =
        crate::quota::ensure_within_quota(&state.pool, &file_owner_id, body.total_size).await
    {
        state.upload_metrics.inc_quota_rejects();
        return Err(error);
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

    let content_hash = match body.content_hash.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(raw) => Some(normalize_content_hash(raw)?),
        None => None,
    };

    let is_video = upload_is_video(&filename, &mime);
    let mut dedup_source_id: Option<String> = None;
    let mut recycle_match_id: Option<String> = None;
    if let Some(ref hash) = content_hash {
        if let Some(source) = crate::files::content_hash::find_dedup_source(
            &state.pool,
            &file_owner_id,
            hash,
            body.total_size,
            is_video,
        )
        .await?
        {
            dedup_source_id = Some(source.id);
            state.upload_metrics.inc_dedup_hits();
        } else if let Some(trashed_id) = crate::files::content_hash::find_trashed_dedup_file_id(
            &state.pool,
            &file_owner_id,
            hash,
            body.total_size,
        )
        .await?
        {
            recycle_match_id = Some(trashed_id);
        }
    }

    let session = insert_session(
        &state.pool,
        &claims.sub,
        &file_owner_id,
        body.folder_id.as_deref(),
        &filename,
        &mime,
        body.total_size,
        chunk_size,
        content_hash.as_deref(),
    )
    .await?;

    // Human: Only video needs a local spool for HLS ingest — non-video parts go to object storage staging.
    if is_video {
        let work_dir = upload_work_dir(&session.file_id);
        tokio::fs::create_dir_all(&work_dir).await.map_err(|error| {
            AppError::Internal(anyhow::anyhow!("create upload work dir: {error}"))
        })?;
    }

    state.upload_metrics.inc_sessions_created();

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "uploads.session.create",
        Some("upload_session"),
        Some(&session.id),
        Some(serde_json::json!({
            "filename": filename,
            "total_size": body.total_size,
            "chunk_size": chunk_size,
            "staged": !is_video,
            "content_hash_present": content_hash.is_some(),
            "dedup_source_file_id": dedup_source_id,
            "recycle_match_file_id": recycle_match_id,
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
        staged = !is_video,
        direct_upload = session_direct_upload(&state, &session),
        dedup = dedup_source_id.is_some(),
        "uploads.session.create"
    );

    Ok(Json(session_to_response_ext(
        &state,
        &session,
        Vec::new(),
        dedup_source_id,
        recycle_match_id,
    )))
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
    Ok(Json(session_to_response(&state, &session, parts_received)))
}

// Human: Mint a short-lived Nebular PUT URL for one staging part (browser-direct upload).
// Agent: POST /uploads/{id}/parts/{n}/signed-url; ONLY non-video + supports_presigned_put.
pub async fn signed_part_url(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    Path((session_id, part_number)): Path<(String, i32)>,
) -> Result<Json<SignedPartUrlResponse>, AppError> {
    rate_limit::enforce(&state.upload_rl, &claims.sub)?;

    let session = load_session_for_user(&state.pool, &session_id, &claims.sub).await?;
    ensure_session_active(&session)?;

    if !session_direct_upload(&state, &session) {
        state.upload_metrics.inc_signed_url_rejected();
        return Err(AppError::BadRequest(
            "direct part upload is not available for this session".into(),
        ));
    }

    // Human: Separate rate limit for signed-url minting (prevents token spam without body cost).
    if let Err(error) = rate_limit::enforce(&state.upload_signed_url_rl, &claims.sub) {
        state.upload_metrics.inc_signed_url_rejected();
        return Err(error);
    }

    // Human: Re-check quota excluding this session's reservation so mid-upload rechecks stay honest.
    let file_owner_id = resolve_upload_file_owner(
        &state.pool,
        &claims.sub,
        session.folder_id.as_deref(),
    )
    .await?;
    if let Err(error) = crate::quota::ensure_within_quota_excluding_reservation(
        &state.pool,
        &file_owner_id,
        0,
        session.quota_reserved_bytes,
    )
    .await
    {
        // Human: With reservation held, zero-incoming check still fails if others over-consumed.
        let _ = error;
    }
    if let Err(error) = crate::quota::ensure_within_quota_excluding_reservation(
        &state.pool,
        &file_owner_id,
        session.total_size,
        session.quota_reserved_bytes,
    )
    .await
    {
        state.upload_metrics.inc_quota_rejects();
        state.upload_metrics.inc_signed_url_rejected();
        return Err(error);
    }

    let expected = expected_part_size(session.total_size, session.chunk_size as i64, part_number)?;
    let staging_key = staging_part_key(&session_id, part_number);

    // Human: Pin direct browser parts to primary so multi-node GET/confirm resolve the same object.
    let _ = crate::storage::placement::persist_placement(
        &state.pool,
        &staging_key,
        &crate::storage::placement::UploadPlacementPlan::Single {
            node_id: "node-primary".into(),
            object_key: staging_key.clone(),
        },
    )
    .await;

    let ttl = DIRECT_PART_URL_TTL_SECS.min(state.url_expiry_seconds.max(60));
    let upload_url = state
        .storage
        .presigned_put_url(&staging_key, ttl)
        .map_err(|error| AppError::Storage(format!("mint signed part URL: {error}")))?;

    let confirm_token = uuid::Uuid::new_v4().to_string();
    set_part_signed_token(&state.pool, &session_id, part_number, &confirm_token).await?;

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(ttl as i64);
    state.upload_metrics.inc_signed_url_minted();

    tracing::info!(
        request_id = %request_id.0,
        session_id = %session_id,
        part_number,
        ttl_secs = ttl,
        expected_bytes = expected,
        placement_node = "node-primary",
        "uploads.part.signed_url"
    );

    Ok(Json(SignedPartUrlResponse {
        part_number,
        upload_url,
        expires_at,
        content_type: "application/octet-stream".into(),
        expected_bytes: expected,
        confirm_token,
    }))
}

// Human: After the browser PUTs a part to Nebular, verify size (HEAD) and record the part row.
// Agent: POST /uploads/{id}/parts/{n}/confirm; REQUIRES confirm_token; CALLS object_size not full GET.
pub async fn confirm_part(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    Path((session_id, part_number)): Path<(String, i32)>,
    body: Option<Json<ConfirmPartRequest>>,
) -> Result<Json<UploadPartResponse>, AppError> {
    rate_limit::enforce(&state.upload_rl, &claims.sub)?;

    let session = load_session_for_user(&state.pool, &session_id, &claims.sub).await?;
    ensure_session_active(&session)?;

    if upload_is_video(&session.filename, &session.mime_type) {
        return Err(AppError::BadRequest(
            "confirm is only used for direct (non-video) part uploads".into(),
        ));
    }

    let confirm_token = body
        .as_ref()
        .and_then(|json| json.confirm_token.as_deref())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::BadRequest("confirm_token is required".into()))?;

    // Human: Validate token without consuming first so a missing staged object can be retried (proxy fallback).
    // Agent: MATCHES signed_token; HEAD object_size; THEN consume + record so false confirms do not burn the token.
    if !part_signed_token_matches(&state.pool, &session_id, part_number, confirm_token).await? {
        return Err(AppError::Conflict(
            "invalid or already used confirm_token".into(),
        ));
    }

    let expected = expected_part_size(session.total_size, session.chunk_size as i64, part_number)?;
    let staging_key = staging_part_key(&session_id, part_number);

    let object_len = state.storage.object_size(&staging_key).await.map_err(|_| {
        AppError::BadRequest(format!(
            "staged part {part_number} not found — upload the part before confirming"
        ))
    })?;

    if object_len as i64 != expected {
        return Err(AppError::BadRequest(format!(
            "staged part {part_number} is {object_len} bytes, expected {expected}"
        )));
    }

    let checksum = match body
        .as_ref()
        .and_then(|json| json.content_sha256.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(raw) => Some(normalize_content_hash(raw)?),
        None => None,
    };

    // Human: Optional integrity — when the client sent a part digest, re-hash staged bytes on confirm.
    // Agent: GET stream SHA-256 when checksum present; REJECTS mismatch before recording the part.
    if let Some(ref expected_hash) = checksum {
        let actual = hash_storage_object(&state.storage, &staging_key).await?;
        if actual != *expected_hash {
            return Err(AppError::BadRequest(format!(
                "staged part {part_number} checksum mismatch"
            )));
        }
    }

    if !consume_part_signed_token(&state.pool, &session_id, part_number, confirm_token).await? {
        // Human: Concurrent confirm won the race — succeed if the part is already recorded.
        let received = list_received_parts(&state.pool, &session_id).await?;
        if received.contains(&part_number) {
            let fresh = load_session_for_user(&state.pool, &session_id, &claims.sub).await?;
            return Ok(Json(UploadPartResponse {
                part_number,
                bytes_received: fresh.bytes_received,
                total_size: fresh.total_size,
            }));
        }
        return Err(AppError::Conflict(
            "invalid or already used confirm_token".into(),
        ));
    }

    let bytes_received = record_part_with_checksum(
        &state.pool,
        &session_id,
        part_number,
        expected,
        checksum.as_deref(),
    )
    .await?;

    state.upload_metrics.inc_parts_confirmed();
    state.upload_metrics.inc_parts_direct();

    tracing::info!(
        request_id = %request_id.0,
        session_id = %session_id,
        part_number,
        part_bytes = expected,
        bytes_received,
        direct = true,
        "uploads.part.confirmed"
    );

    Ok(Json(UploadPartResponse {
        part_number,
        bytes_received,
        total_size: session.total_size,
    }))
}

// Human: Upload one idempotent chunk for an active session.
// Agent: PUT /uploads/{id}/parts/{n}; video → local spool; non-video → object storage staging key.
pub async fn upload_part(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    headers: HeaderMap,
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

    let checksum = match headers
        .get("x-ownly-part-sha256")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(raw) => Some(normalize_content_hash(raw)?),
        None => None,
    };

    // Human: When the client provides a part digest, verify before writing so bad parts never stage.
    if let Some(ref expected_hash) = checksum {
        let actual = hex::encode(Sha256::digest(body.as_ref()));
        if actual != *expected_hash {
            return Err(AppError::BadRequest(format!(
                "part {part_number} checksum mismatch"
            )));
        }
    }

    let is_video = upload_is_video(&session.filename, &session.mime_type);
    if is_video {
        let work_dir = upload_work_dir(&session.file_id);
        tokio::fs::create_dir_all(&work_dir).await.map_err(|error| {
            AppError::Internal(anyhow::anyhow!("create upload work dir: {error}"))
        })?;
        append_part_to_source(
            &work_dir,
            part_number,
            session.chunk_size as i64,
            &body,
        )
        .await?;
    } else {
        let staging_key = staging_part_key(&session_id, part_number);
        // Human: Stream the buffered part body into object storage without an extra Vec clone per retry.
        // Agent: Bytes is refcounted; put_stream_with_retry reopens a once-stream of the same buffer.
        let part_len = body.len() as u64;
        let body_for_stream = body.clone();
        crate::storage::put_stream_with_retry(
            state.storage.as_ref(),
            &staging_key,
            "application/octet-stream",
            part_len,
            || {
                let body_for_stream = body_for_stream.clone();
                async move {
                    let stream: StorageStream =
                        Box::pin(stream::once(async move { Ok::<Bytes, std::io::Error>(body_for_stream) }));
                    Ok(stream)
                }
            },
        )
        .await
        .map_err(|error| AppError::Storage(format!("stage upload part: {error}")))?;
    }

    let bytes_received = record_part_with_checksum(
        &state.pool,
        &session_id,
        part_number,
        body.len() as i64,
        checksum.as_deref(),
    )
    .await?;

    state.upload_metrics.inc_parts_proxy();

    tracing::debug!(
        request_id = %request_id.0,
        session_id = %session_id,
        part_number,
        part_bytes = body.len(),
        bytes_received,
        staged = !is_video,
        "uploads.part.received"
    );

    Ok(Json(UploadPartResponse {
        part_number,
        bytes_received,
        total_size: session.total_size,
    }))
}

// Human: Assemble received parts and register the file using the shared finalize path.
// Agent: POST /uploads/{id}/complete; instant dedup when content_hash matches library; else parts required.
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
    let is_video = upload_is_video(&session.filename, &session.mime_type);
    let file_owner_id = resolve_upload_file_owner(
        &state.pool,
        &claims.sub,
        session.folder_id.as_deref(),
    )
    .await?;

    // Human: Instant dedup — same-user content already in library; skip part requirement entirely.
    // Agent: ONLY when session.content_hash matches find_dedup_source; NO cross-user leak.
    let instant_source = if let Some(ref hash) = session.content_hash {
        crate::files::content_hash::find_dedup_source(
            &state.pool,
            &file_owner_id,
            hash,
            session.total_size,
            is_video,
        )
        .await?
    } else {
        None
    };

    let parts_complete =
        received.len() as i32 == parts && session.bytes_received == session.total_size;

    if instant_source.is_none() && !parts_complete {
        if received.len() as i32 != parts {
            return Err(AppError::Conflict(format!(
                "upload incomplete: received {} of {parts} parts",
                received.len()
            )));
        }
        return Err(AppError::Conflict(
            "upload bytes_received does not match total_size".into(),
        ));
    }

    mark_completing(&state.pool, &session_id, &claims.sub).await?;

    let storage_key = format!("users/{file_owner_id}/files/{}", session.file_id);

    let file = if let (Some(_source), Some(ref hash)) = (&instant_source, &session.content_hash) {
        match finalize_instant_dedup_upload(
            &state,
            &request_id,
            &headers,
            InstantDedupInput {
                file_id: session.file_id.clone(),
                user_id: file_owner_id.clone(),
                folder_id: session.folder_id.clone(),
                filename: session.filename.clone(),
                mime: session.mime_type.clone(),
                size_bytes: session.total_size as u64,
                content_hash: hash.clone(),
                resumable: true,
                staged: !is_video,
            },
        )
        .await
        {
            Ok(file) => {
                if is_video {
                    cleanup_upload_work_dir(&upload_work_dir(&session.file_id)).await;
                } else {
                    cleanup_staging_prefix(&state.storage, &session_id).await;
                }
                state.upload_metrics.inc_dedup_hits();
                file
            }
            Err(error) => {
                let _ = sqlx::query(
                    "UPDATE upload_sessions SET status = 'active', updated_at = now() WHERE id = $1",
                )
                .bind(&session_id)
                .execute(&state.pool)
                .await;
                return Err(error);
            }
        }
    } else if is_video {
        let work_dir = upload_work_dir(&session.file_id);
        let (tmp_path, size_bytes) = match resolve_session_source(&session, &work_dir).await {
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

        match finalize_spooled_upload(
            &state,
            &request_id,
            &headers,
            SpooledUploadInput {
                file_id: session.file_id.clone(),
                user_id: file_owner_id,
                folder_id: session.folder_id.clone(),
                filename: session.filename.clone(),
                storage_key,
                mime: session.mime_type.clone(),
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
        }
    } else {
        match finalize_staged_upload(
            &state,
            &request_id,
            &headers,
            StagedUploadInput {
                file_id: session.file_id.clone(),
                user_id: file_owner_id,
                folder_id: session.folder_id.clone(),
                filename: session.filename.clone(),
                storage_key,
                mime: session.mime_type.clone(),
                session_id: session_id.clone(),
                total_parts: parts,
                size_bytes: session.total_size as u64,
                resumable: true,
                known_content_hash: session.content_hash.clone(),
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
        }
    };

    mark_complete(&state.pool, &session_id).await?;
    state.upload_metrics.inc_sessions_completed();

    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        session_id = %session_id,
        file_id = %file.id,
        size_bytes = file.size_bytes,
        staged = !is_video,
        instant_dedup = instant_source.is_some(),
        "uploads.session.complete"
    );

    Ok(Json(UploadResponse { file }))
}

// Human: Stream SHA-256 of one object key (staged part integrity on confirm).
// Agent: GET stream; RETURNS lowercase hex; USED when client provided content_sha256.
async fn hash_storage_object(
    storage: &std::sync::Arc<dyn crate::storage::Storage>,
    key: &str,
) -> Result<String, AppError> {
    use futures_util::StreamExt;
    let (mut stream, _, _) = storage
        .get_stream(key)
        .await
        .map_err(|_| AppError::BadRequest(format!("staged object {key} not found for hashing")))?;
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            AppError::Storage(format!("stream staged object for hash: {error}"))
        })?;
        hasher.update(&chunk);
    }
    Ok(hex::encode(hasher.finalize()))
}

// Human: Abort a partial upload and remove spool or staging artifacts.
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

    if upload_is_video(&session.filename, &session.mime_type) {
        cleanup_upload_work_dir(&upload_work_dir(&session.file_id)).await;
    } else {
        cleanup_staging_prefix(&state.storage, &session_id).await;
    }

    state.upload_metrics.inc_sessions_aborted();

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

// Human: Drop leftover resumable reservations so a retry is not charged twice against quota.
// Agent: DELETE /uploads; ABORTS every active/completing session for the caller.
pub async fn abort_all_sessions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let sessions = mark_all_aborted_for_user(&state.pool, &claims.sub).await?;
    for session in &sessions {
        if upload_is_video(&session.filename, &session.mime_type) {
            cleanup_upload_work_dir(&upload_work_dir(&session.file_id)).await;
        } else {
            cleanup_staging_prefix(&state.storage, &session.id).await;
        }
        state.upload_metrics.inc_sessions_aborted();
        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "uploads.session.abort",
            Some("upload_session"),
            Some(&session.id),
            None,
            &headers,
        )
        .await
        .ok();
    }
    Ok(Json(serde_json::json!({ "aborted": sessions.len() })))
}
