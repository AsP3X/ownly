// Human: User file library — list, upload, download, delete media stored in Nebular OS.
// Agent: READS/WRITES files + folders tables; CALLS Storage trait; REQUIRES auth Claims.

use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        file_delete::delete_owned_file_row,
        folders::ensure_folder_owned,
        processing::ensure_file_not_processing,
    },
    jobs::{self, model::HlsEncodePayload, JobKind},
    rate_limit,
    request_tracking,
    AppState,
};

// Human: Shared column list for file rows including HLS transcode metadata.
// Agent: USED in SELECT/RETURNING for list, get, upload, and move handlers.
pub(crate) const FILE_COLUMNS: &str = "id, name, mime_type, size_bytes, folder_id, created_at, updated_at, \
    hls_ready, hls_encode_status, hls_encode_error, conversion_progress, duration_seconds";

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

type DownloadFileRow = (String, String, Option<String>, bool, bool, Option<String>);
type DownloadUrlRow = (String, Option<String>, bool, bool, Option<String>);
type MoveFileCurrentRow = (Option<String>, String, Option<String>, bool, Option<String>);

// Human: True when the vault keeps an HLS bundle (no standalone original blob).
// Agent: USED by download/export handlers to branch away from raw storage_key GET.
fn is_hls_stored_video(mime_type: &Option<String>, hls_ready: bool) -> bool {
    mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
        && hls_ready
}

// Human: Download filename for remuxed exports — preserve stem, force .mp4 extension.
fn mp4_download_name(name: &str) -> String {
    if name.to_lowercase().ends_with(".mp4") {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, _)) => format!("{stem}.mp4"),
        None => format!("{name}.mp4"),
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FileDto {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub hls_ready: bool,
    pub hls_encode_status: Option<String>,
    pub hls_encode_error: Option<String>,
    pub conversion_progress: i32,
    pub duration_seconds: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct FileListResponse {
    pub files: Vec<FileDto>,
    pub total_bytes: i64,
    pub file_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub folder_id: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub file: FileDto,
}

#[derive(Debug, Serialize)]
pub struct DownloadUrlResponse {
    pub url: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct MoveFileRequest {
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MoveFileResponse {
    pub file: FileDto,
}

// Human: List the current user's files with optional folder filter and name search.
// Agent: READS files WHERE user_id; SUM size_bytes; ORDER BY name.
pub async fn list_files(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListQuery>,
) -> Result<Json<FileListResponse>, AppError> {
    let search = query.q.as_deref().unwrap_or("").trim().to_lowercase();

    let files: Vec<FileDto> = if search.is_empty() {
        sqlx::query_as(&format!(
            "SELECT {FILE_COLUMNS} FROM files WHERE user_id = $1 \
             AND (($2::text IS NULL AND folder_id IS NULL) OR folder_id = $2) ORDER BY name ASC"
        ))
        .bind(&claims.sub)
        .bind(&query.folder_id)
        .fetch_all(&state.pool)
        .await?
    } else {
        let pattern = format!("%{search}%");
        sqlx::query_as(&format!(
            "SELECT {FILE_COLUMNS} FROM files WHERE user_id = $1 AND LOWER(name) LIKE $2 ORDER BY name ASC"
        ))
        .bind(&claims.sub)
        .bind(&pattern)
        .fetch_all(&state.pool)
        .await?
    };

    let total_bytes: i64 = files.iter().map(|f| f.size_bytes).sum();
    let file_count = files.len() as i64;

    Ok(Json(FileListResponse {
        files,
        total_bytes,
        file_count,
    }))
}

// Human: Fetch one file row for preview polling and detail views.
// Agent: READS files WHERE id + user_id; RETURNS FileDto with HLS fields.
pub async fn get_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let file: Option<FileDto> = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2"
    ))
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let file = file.ok_or(AppError::NotFound)?;
    Ok(Json(serde_json::json!({ "file": file })))
}

// Human: Discard an entire multipart body without storing it — used when rejecting before upload work.
// Agent: READS every field to EOF; IGNORES parse errors so the HTTP connection can close cleanly.
async fn drain_multipart(multipart: &mut Multipart) {
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let _ = field.bytes().await;
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

// Human: Accept multipart uploads and persist bytes to object storage with metadata in Postgres.
// Agent: WRITES storage PUT + files INSERT; RATE LIMITED upload_rl; AUDIT files.upload; LOGS phase timings.
pub async fn upload_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    let upload_started = Instant::now();
    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        max_upload_bytes = state.max_upload_bytes,
        "files.upload started"
    );

    // Human: Reject over quota but still drain the multipart body so the client gets a clean 429.
    // Agent: READS all multipart fields when rate limited; AVOIDS ERR_CONNECTION_ABORTED mid-body.
    if let Err(e) = rate_limit::enforce(&state.upload_rl, &claims.sub) {
        drain_multipart(&mut multipart).await;
        return Err(e);
    }

    let mut filename = String::from("untitled");
    let mut folder_id: Option<String> = None;
    let mut data: Vec<u8> = Vec::new();
    let mut content_type = String::from("application/octet-stream");

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        match field.name() {
            Some("file") => {
                filename = field
                    .file_name()
                    .map(str::to_string)
                    .unwrap_or_else(|| filename.clone());
                content_type = field
                    .content_type()
                    .map(str::to_string)
                    .unwrap_or(content_type.clone());
                let multipart_read_started = Instant::now();
                tracing::info!(
                    request_id = %request_id.0,
                    user_id = %claims.sub,
                    filename = %filename,
                    content_type = %content_type,
                    "files.upload reading multipart body (browser may show upload complete before this finishes)"
                );
                data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?
                    .to_vec();
                let multipart_ms = multipart_read_started.elapsed().as_millis() as u64;
                tracing::info!(
                    request_id = %request_id.0,
                    user_id = %claims.sub,
                    filename = %filename,
                    size_bytes = data.len(),
                    multipart_read_ms = multipart_ms,
                    "files.upload multipart body read complete"
                );
                if multipart_ms > 30_000 {
                    tracing::warn!(
                        request_id = %request_id.0,
                        filename = %filename,
                        size_bytes = data.len(),
                        multipart_read_ms = multipart_ms,
                        "files.upload multipart read was slow — check nginx proxy buffering or client link"
                    );
                }
            }
            Some("folder_id") => {
                let value = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                if !value.trim().is_empty() {
                    folder_id = Some(value);
                }
            }
            _ => {}
        }
    }

    if data.is_empty() {
        return Err(AppError::BadRequest("file is required".into()));
    }
    if data.len() as u64 > state.max_upload_bytes {
        return Err(AppError::BadRequest("file exceeds maximum upload size".into()));
    }

    // Human: Reject uploads into folders the caller does not own.
    // Agent: READS folders via ensure_folder_owned before storage PUT.
    if let Some(ref target_folder_id) = folder_id {
        ensure_folder_owned(&state.pool, &claims.sub, target_folder_id).await?;
    }

    let size_bytes = data.len();
    let file_id = Uuid::new_v4().to_string();
    let storage_key = format!("users/{}/files/{}", claims.sub, file_id);

    let mime = if content_type.is_empty() {
        mime_guess::from_path(&filename)
            .first_or_octet_stream()
            .to_string()
    } else {
        content_type
    };

    let is_video = mime.starts_with("video/");

    tracing::info!(
        request_id = %request_id.0,
        file_id = %file_id,
        storage_key = %storage_key,
        size_bytes,
        is_video,
        "files.upload object storage PUT starting (backend re-sends full payload to Nebular OS)"
    );
    let storage_put_started = Instant::now();

    let db_started = Instant::now();

    let file: FileDto = if is_video {
        // Human: Spool each video under its own work dir so HLS cleanup never removes the OS temp root.
        // Agent: WRITES mediavault_upload_{file_id}/source; create_dir_all before write; PASSED to HlsEncodeJob.
        let work_dir = std::env::temp_dir().join(format!("mediavault_upload_{file_id}"));
        tokio::fs::create_dir_all(&work_dir)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("create upload work dir: {e}")))?;
        let tmp_path = work_dir.join("source");
        tokio::fs::write(&tmp_path, &data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("write upload temp file: {e}")))?;
        let duration_seconds = crate::hls::probe::probe_duration_seconds(&tmp_path).await;

        let _: FileDto = sqlx::query_as(&format!(
            "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, \
             duration_seconds, hls_encode_status, conversion_progress) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0) \
             RETURNING {FILE_COLUMNS}"
        ))
        .bind(&file_id)
        .bind(&claims.sub)
        .bind(&folder_id)
        .bind(&filename)
        .bind(&storage_key)
        .bind(&mime)
        .bind(size_bytes as i64)
        .bind(duration_seconds)
        .fetch_one(&state.pool)
        .await?;

        tracing::info!(
            request_id = %request_id.0,
            file_id = %file_id,
            "files.upload HLS ingest queued (client polls conversion_progress)"
        );

        let payload = HlsEncodePayload {
            file_id: file_id.clone(),
            storage_key: storage_key.clone(),
            tmp_video: tmp_path.to_string_lossy().to_string(),
            duration_seconds,
        };

        jobs::enqueue_job(
            &state.pool,
            &claims.sub,
            JobKind::HlsEncode,
            &filename,
            Some("file"),
            Some(&file_id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("encode job payload: {e}")))?,
        )
        .await?;

        sqlx::query_as(&format!(
            "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2"
        ))
        .bind(&file_id)
        .bind(&claims.sub)
        .fetch_one(&state.pool)
        .await?
    } else {
        state
            .storage
            .put(&storage_key, &mime, data)
            .await
            .map_err(|e| {
                tracing::error!(
                    request_id = %request_id.0,
                    file_id = %file_id,
                    storage_key = %storage_key,
                    size_bytes,
                    storage_put_ms = storage_put_started.elapsed().as_millis() as u64,
                    error = %e,
                    "files.upload object storage PUT failed"
                );
                AppError::Storage(e.to_string())
            })?;

        let storage_put_ms = storage_put_started.elapsed().as_millis() as u64;
        tracing::info!(
            request_id = %request_id.0,
            file_id = %file_id,
            storage_key = %storage_key,
            size_bytes,
            storage_put_ms,
            "files.upload object storage PUT complete"
        );

        sqlx::query_as(&format!(
            "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {FILE_COLUMNS}"
        ))
        .bind(&file_id)
        .bind(&claims.sub)
        .bind(&folder_id)
        .bind(&filename)
        .bind(&storage_key)
        .bind(&mime)
        .bind(size_bytes as i64)
        .fetch_one(&state.pool)
        .await?
    };
    tracing::info!(
        request_id = %request_id.0,
        file_id = %file_id,
        db_insert_ms = db_started.elapsed().as_millis() as u64,
        "files.upload database insert complete"
    );

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.upload",
        Some("file"),
        Some(&file_id),
        Some(serde_json::json!({ "name": filename, "size_bytes": size_bytes })),
        &headers,
    )
    .await
    .ok();

    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        file_id = %file_id,
        filename = %filename,
        size_bytes,
        total_ms = upload_started.elapsed().as_millis() as u64,
        "files.upload complete"
    );

    Ok(Json(UploadResponse { file }))
}

// Human: Stream file bytes through the API for inline viewing or download.
// Agent: READS files by id+user; CALLS storage.get_stream; SETS Content-Type/Disposition headers.
pub async fn download_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<DownloadFileRow> = sqlx::query_as(
        "SELECT storage_key, name, mime_type, hls_ready, download_export_ready, hls_encode_status \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, name, mime_type, hls_ready, export_ready, hls_encode_status) =
        row.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(&mime_type, hls_ready, &hls_encode_status)?;

    let object_key = if is_hls_stored_video(&mime_type, hls_ready) {
        if !export_ready {
            return Err(AppError::Conflict(
                "video export is not ready — poll /export and retry".into(),
            ));
        }
        format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}")
    } else {
        storage_key.clone()
    };

    let (stream, _len, content_type) = state
        .storage
        .get_stream(&object_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let body = Body::from_stream(stream);
    let download_name = if is_hls_stored_video(&mime_type, hls_ready) {
        mp4_download_name(&name)
    } else {
        name.clone()
    };
    let disposition = format!("attachment; filename=\"{}\"", download_name.replace('"', ""));

    let resolved_type = if is_hls_stored_video(&mime_type, hls_ready) {
        "video/mp4".to_string()
    } else {
        mime_type.unwrap_or(content_type)
    };
    Ok((
        [
            (header::CONTENT_TYPE, resolved_type),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        body,
    )
        .into_response())
}

// Human: Return a time-limited presigned URL for direct client download from object storage.
// Agent: READS files; CALLS storage.presigned_url; NO byte proxy.
pub async fn download_url(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<DownloadUrlResponse>, AppError> {
    let row: Option<DownloadUrlRow> = sqlx::query_as(
        "SELECT storage_key, mime_type, hls_ready, download_export_ready, hls_encode_status \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (storage_key, mime_type, hls_ready, export_ready, hls_encode_status) =
        row.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(&mime_type, hls_ready, &hls_encode_status)?;

    let object_key = if is_hls_stored_video(&mime_type, hls_ready) {
        if !export_ready {
            return Err(AppError::Conflict(
                "video export is not ready — poll /export and retry".into(),
            ));
        }
        format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}")
    } else {
        storage_key
    };

    let url = state
        .storage
        .presigned_url(&object_key, state.url_expiry_seconds)
        .map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(Json(DownloadUrlResponse {
        url,
        expires_in_seconds: state.url_expiry_seconds,
    }))
}

// Human: Move a file into another folder or back to the drive root.
// Agent: PATCH files.folder_id; VALIDATES folder ownership; AUDIT files.move.
pub async fn move_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MoveFileRequest>,
) -> Result<Json<MoveFileResponse>, AppError> {
    let current: Option<MoveFileCurrentRow> = sqlx::query_as(
        "SELECT folder_id, name, mime_type, hls_ready, hls_encode_status \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (current_folder_id, name, mime_type, hls_ready, hls_encode_status) =
        current.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(&mime_type, hls_ready, &hls_encode_status)?;

    let target_folder_id = body
        .folder_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if current_folder_id.as_deref() == target_folder_id.as_deref() {
        return Err(AppError::BadRequest(
            "file is already in this folder".into(),
        ));
    }

    if let Some(ref folder_id) = target_folder_id {
        ensure_folder_owned(&state.pool, &claims.sub, folder_id).await?;
    }

    let file: FileDto = sqlx::query_as(&format!(
        "UPDATE files SET folder_id = $1, updated_at = NOW() \
         WHERE id = $2 AND user_id = $3 RETURNING {FILE_COLUMNS}"
    ))
    .bind(&target_folder_id)
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.move",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({
            "name": name,
            "from_folder_id": current_folder_id,
            "to_folder_id": target_folder_id,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(MoveFileResponse { file }))
}

// Human: Cancel server-side HLS ingest for a video still being transcoded after upload.
// Agent: POST /api/v1/files/:id/cancel-ingest; WRITES job cancelled + file hls_encode_status; AUDIT files.ingest.cancel.
pub async fn cancel_video_ingest(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, bool)> = sqlx::query_as(
        "SELECT mime_type, hls_ready FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, hls_ready) = row.ok_or(AppError::NotFound)?;
    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest(
            "only video files can cancel ingest".into(),
        ));
    }
    if hls_ready {
        return Err(AppError::Conflict(
            "video ingest already finished".into(),
        ));
    }

    let cancelled = jobs::cancel_hls_encode_for_file(&state.pool, &claims.sub, &id).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.ingest.cancel",
        Some("file"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": cancelled })))
}

// Human: Remove file metadata and delete the blob from object storage.
// Agent: DELETE files row; CALLS storage.delete; AUDIT files.delete.
pub async fn delete_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, bool, Option<String>)> = sqlx::query_as(
        "SELECT mime_type, hls_ready, hls_encode_status FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (mime_type, hls_ready, hls_encode_status) = row.ok_or(AppError::NotFound)?;
    ensure_file_not_processing(&mime_type, hls_ready, &hls_encode_status)?;

    let deleted =
        delete_owned_file_row(&state, &state.pool, &claims.sub, &id).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.delete",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({ "name": deleted.name })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Return instance branding and storage summary for the drive dashboard header.
// Agent: READS app_settings instance_name + quota; READS user file stats.
pub async fn dashboard_summary(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let instance_name: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'instance_name'")
            .fetch_optional(&state.pool)
            .await?;
    let quota_gb: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'default_storage_quota_gb'")
            .fetch_optional(&state.pool)
            .await?;

    // Human: SUM(bigint) returns NUMERIC in Postgres — cast to BIGINT so sqlx can decode into i64.
    // Agent: READS files for user; RETURNS (file_count, used_bytes) as i64 pair for dashboard JSON.
    let stats: (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(size_bytes), 0)::BIGINT FROM files WHERE user_id = $1",
    )
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    let quota_bytes = quota_gb
        .and_then(|(v,)| v.parse::<i64>().ok())
        .unwrap_or(50)
        .saturating_mul(1024 * 1024 * 1024);

    Ok(Json(serde_json::json!({
        "instance_name": instance_name.map(|(n,)| n).unwrap_or_else(|| "MediaVault".into()),
        "file_count": stats.0,
        "used_bytes": stats.1,
        "quota_bytes": quota_bytes,
    })))
}
