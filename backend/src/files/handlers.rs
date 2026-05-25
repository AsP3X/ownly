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
    files::folders::ensure_folder_owned,
    rate_limit,
    request_tracking,
    AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FileDto {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
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

// Human: List the current user's files with optional folder filter and name search.
// Agent: READS files WHERE user_id; SUM size_bytes; ORDER BY name.
pub async fn list_files(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListQuery>,
) -> Result<Json<FileListResponse>, AppError> {
    let search = query.q.as_deref().unwrap_or("").trim().to_lowercase();

    let files: Vec<FileDto> = if search.is_empty() {
        sqlx::query_as(
            "SELECT id, name, mime_type, size_bytes, folder_id, created_at, updated_at \
             FROM files WHERE user_id = $1 AND (($2::text IS NULL AND folder_id IS NULL) OR folder_id = $2) \
             ORDER BY name ASC",
        )
        .bind(&claims.sub)
        .bind(&query.folder_id)
        .fetch_all(&state.pool)
        .await?
    } else {
        let pattern = format!("%{search}%");
        sqlx::query_as(
            "SELECT id, name, mime_type, size_bytes, folder_id, created_at, updated_at \
             FROM files WHERE user_id = $1 AND LOWER(name) LIKE $2 ORDER BY name ASC",
        )
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

    rate_limit::enforce(&state.upload_rl, &claims.sub)?;

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

    tracing::info!(
        request_id = %request_id.0,
        file_id = %file_id,
        storage_key = %storage_key,
        size_bytes,
        "files.upload object storage PUT starting (backend re-sends full payload to Nebular OS)"
    );
    let storage_put_started = Instant::now();
    state
        .storage
        .put(&storage_key, &content_type, data)
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
    if storage_put_ms > 60_000 {
        tracing::warn!(
            request_id = %request_id.0,
            file_id = %file_id,
            size_bytes,
            storage_put_ms,
            "files.upload object storage PUT was slow — see object-storage logs for compression/disk phases"
        );
    }

    let mime = if content_type.is_empty() {
        mime_guess::from_path(&filename)
            .first_or_octet_stream()
            .to_string()
    } else {
        content_type
    };

    let db_started = Instant::now();
    let file: FileDto = sqlx::query_as(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING id, name, mime_type, size_bytes, folder_id, created_at, updated_at",
    )
    .bind(&file_id)
    .bind(&claims.sub)
    .bind(&folder_id)
    .bind(&filename)
    .bind(&storage_key)
    .bind(&mime)
    .bind(size_bytes as i64)
    .fetch_one(&state.pool)
    .await?;
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
    let row: Option<(String, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT storage_key, name, mime_type, size_bytes FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, name, mime_type, _size_bytes) = row.ok_or(AppError::NotFound)?;
    let (stream, _len, content_type) = state
        .storage
        .get_stream(&storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let body = Body::from_stream(stream);
    // Human: attachment triggers Save As / Downloads folder; filename escaped for HTTP header safety.
    // Agent: OMITS Content-Length on streamed bodies — wrong length stalls XHR when storage decompresses.
    let disposition = format!("attachment; filename=\"{}\"", name.replace('"', ""));

    let resolved_type = mime_type.unwrap_or(content_type);
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
    let row: Option<(String,)> =
        sqlx::query_as("SELECT storage_key FROM files WHERE id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    let (storage_key,) = row.ok_or(AppError::NotFound)?;

    let url = state
        .storage
        .presigned_url(&storage_key, state.url_expiry_seconds)
        .map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(Json(DownloadUrlResponse {
        url,
        expires_in_seconds: state.url_expiry_seconds,
    }))
}

// Human: Remove file metadata and delete the blob from object storage.
// Agent: DELETE files row; CALLS storage.delete; AUDIT files.delete.
pub async fn delete_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT storage_key, name FROM files WHERE id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    let (storage_key, name) = row.ok_or(AppError::NotFound)?;

    sqlx::query("DELETE FROM files WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    state
        .storage
        .delete(&storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.delete",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({ "name": name })),
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
