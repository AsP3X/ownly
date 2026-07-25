// Human: Authenticated video thumbnail + HLS reprocess routes.
// Agent: GET/PATCH /files/:id/thumbnail(s); POST /files/:id/hls/reprocess; READS Nebular sidecars.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use futures_util::StreamExt;
use serde::Deserialize;

use crate::{
    audit,
    auth::handlers::Claims,
    authz::Permission,
    error::AppError,
    files::{
        handlers::{FileDto, FILE_COLUMNS},
        recycle_bin::ACTIVE_FILES_SQL,
    },
    jobs::{
        self,
        model::{HlsEncodePayload, JobKind, VideoThumbnailPayload},
    },
};

use super::{thumbnail::VideoThumbnailManifest, thumbnail_option_storage_key};

type ThumbnailManifestRow = (Option<String>, bool, Option<String>, Option<i32>);
type SelectedThumbnailRow = (
    Option<String>,
    String,
    bool,
    Option<i32>,
    chrono::DateTime<chrono::Utc>,
);

fn thumbnail_etag(updated_at: chrono::DateTime<chrono::Utc>) -> String {
    format!("W/\"{}\"", updated_at.timestamp_millis())
}

#[derive(Debug, Deserialize)]
pub struct SelectThumbnailRequest {
    pub selected_index: u32,
}

// Human: Load the stored thumbnail manifest for a video file owned by the caller.
// Agent: READS video_thumbnail_manifest_key; STREAMS JSON from Nebular; MERGES DB selected_index.
async fn load_manifest_for_file(
    state: &Arc<crate::AppState>,
    file_id: &str,
    user_id: &str,
) -> Result<(VideoThumbnailManifest, String), AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        user_id,
        file_id,
        Permission::ContentRead,
    )
    .await?;

    let row: Option<ThumbnailManifestRow> = sqlx::query_as(
        "SELECT mime_type, video_thumbnail_ready, video_thumbnail_manifest_key, \
         video_thumbnail_selected_index FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, ready, manifest_key, selected_index) = row.ok_or(AppError::NotFound)?;

    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest("file is not a video".into()));
    }

    if !ready {
        return Err(AppError::Conflict("video thumbnails are not ready yet".into()));
    }

    let key = manifest_key.ok_or(AppError::NotFound)?;
    let (mut stream, _, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Storage(e.to_string()))?;
        data.extend_from_slice(&chunk);
    }

    let mut manifest: VideoThumbnailManifest = serde_json::from_slice(&data)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("invalid thumbnail manifest: {e}")))?;

    if let Some(idx) = selected_index {
        manifest.selected_index = idx.max(0) as u32;
    }

    Ok((manifest, key))
}

// Human: Return scored poster options and the currently selected index.
// Agent: GET /files/:id/thumbnails; RETURNS VideoThumbnailManifest JSON.
pub async fn get_thumbnails(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<VideoThumbnailManifest>, AppError> {
    let (manifest, _) = load_manifest_for_file(&state, &id, &claims.sub).await?;
    Ok(Json(manifest))
}

// Human: Stream the user-selected poster JPEG for grid tiles and previews.
// Agent: GET /files/:id/thumbnail; READS sidecar key from DB; RETURNS image/jpeg body.
pub async fn get_selected_thumbnail(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        Permission::ContentRead,
    )
    .await?;

    let row: Option<SelectedThumbnailRow> = sqlx::query_as(
        "SELECT mime_type, storage_key, video_thumbnail_ready, video_thumbnail_selected_index, updated_at \
         FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, storage_key, ready, selected_index, updated_at) = row.ok_or(AppError::NotFound)?;

    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest("file is not a video".into()));
    }

    if !ready {
        return Err(AppError::Conflict("video thumbnails are not ready yet".into()));
    }

    let index = selected_index.unwrap_or(0).max(0) as u32;
    let thumb_key = thumbnail_option_storage_key(&storage_key, index);
    stream_thumbnail_bytes(
        &state,
        &thumb_key,
        &headers,
        Some(thumbnail_etag(updated_at)),
    )
    .await
}

// Human: Stream one manifest option by index for the thumbnail picker UI.
// Agent: GET /files/:id/thumbnails/:index; BUILDS sidecar key from files.storage_key + index.
pub async fn get_thumbnail_option(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path((id, index)): Path<(String, u32)>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        Permission::ContentRead,
    )
    .await?;

    let row: Option<SelectedThumbnailRow> = sqlx::query_as(
        "SELECT mime_type, storage_key, video_thumbnail_ready, video_thumbnail_selected_index, updated_at \
         FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, storage_key, ready, _, updated_at) = row.ok_or(AppError::NotFound)?;

    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest("file is not a video".into()));
    }

    if !ready {
        return Err(AppError::Conflict("video thumbnails are not ready yet".into()));
    }

    let thumb_key = thumbnail_option_storage_key(&storage_key, index);
    stream_thumbnail_bytes(
        &state,
        &thumb_key,
        &headers,
        Some(thumbnail_etag(updated_at)),
    )
    .await
}

// Human: Stream poster JPEG sidecars with ETag support and passthrough storage streaming.
// Agent: READS storage stream; SETS image/jpeg + private cache; RETURNS 304 when If-None-Match matches.
async fn stream_thumbnail_bytes(
    state: &Arc<crate::AppState>,
    storage_key: &str,
    request_headers: &HeaderMap,
    etag: Option<String>,
) -> Result<Response, AppError> {
    if let Some(ref tag) = etag {
        if request_headers
            .get(header::IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.trim() == tag)
        {
            let mut not_modified = HeaderMap::new();
            not_modified.insert(header::ETAG, tag.parse().unwrap());
            not_modified.insert(
                header::CACHE_CONTROL,
                "private, max-age=3600".parse().unwrap(),
            );
            return Ok((StatusCode::NOT_MODIFIED, not_modified).into_response());
        }
    }

    let (stream, content_length, _) = state
        .storage
        .get_stream(storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::CONTENT_TYPE,
        "image/jpeg"
            .parse()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content type")))?,
    );
    response_headers.insert(
        header::CACHE_CONTROL,
        "private, max-age=3600"
            .parse()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid cache-control")))?,
    );
    if let Some(tag) = etag {
        response_headers.insert(
            header::ETAG,
            tag.parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid etag")))?,
        );
    }
    if content_length > 0 {
        response_headers.insert(
            header::CONTENT_LENGTH,
            content_length
                .to_string()
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content length")))?,
        );
    }

    Ok((response_headers, Body::from_stream(stream)).into_response())
}

// Human: Persist the user's chosen poster frame for drive grid and share previews.
// Agent: PATCH /files/:id/thumbnail; WRITES video_thumbnail_selected_index; AUDIT files.thumbnail.select.
pub async fn select_thumbnail(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SelectThumbnailRequest>,
) -> Result<Json<VideoThumbnailManifest>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        Permission::ContentWrite,
    )
    .await?;

    let (manifest, manifest_key) = load_manifest_for_file(&state, &id, &claims.sub).await?;

    if !manifest
        .options
        .iter()
        .any(|opt| opt.index == body.selected_index)
    {
        return Err(AppError::BadRequest("invalid thumbnail index".into()));
    }

    sqlx::query(
        "UPDATE files SET video_thumbnail_selected_index = $1 WHERE id = $2",
    )
    .bind(body.selected_index as i32)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    let mut updated = manifest;
    updated.selected_index = body.selected_index;

    // Human: Keep manifest JSON in sync so copies and future readers see the same default.
    let payload =
        serde_json::to_vec(&updated).map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?;
    state
        .storage
        .put(&manifest_key, "application/json", payload)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.thumbnail.select",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({ "selected_index": body.selected_index })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(updated))
}

type RegenerateThumbnailRow = (
    String,
    Option<String>,
    String,
    Option<String>,
);

// Human: Re-queue poster extraction when upload-time thumbnails failed or never finished.
// Agent: POST /files/:id/thumbnails/regenerate; ENQUEUES VideoThumbnail job; AUDIT files.thumbnail.regenerate.
pub async fn regenerate_thumbnails(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        Permission::ContentWrite,
    )
    .await?;

    let row: Option<RegenerateThumbnailRow> = sqlx::query_as(
        "SELECT storage_key, mime_type, name, video_thumbnail_status FROM files \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, mime_type, name, thumbnail_status) = row.ok_or(AppError::NotFound)?;

    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest("file is not a video".into()));
    }

    let is_generating = thumbnail_status.as_deref().is_some_and(|status| {
        matches!(status, "queued" | "processing")
    });
    if is_generating
        && jobs::find_active_job(&state.pool, JobKind::VideoThumbnail, "file", &id)
            .await?
            .is_some()
    {
        return Err(AppError::Conflict(
            "video thumbnails are already being generated".into(),
        ));
    }

    sqlx::query(
        "UPDATE files SET video_thumbnail_ready = false, video_thumbnail_status = 'queued', \
         video_thumbnail_error = NULL, video_thumbnail_progress = 0 WHERE id = $1",
    )
    .bind(&id)
    .execute(&state.pool)
    .await?;

    let payload = VideoThumbnailPayload {
        file_id: id.clone(),
        storage_key,
        tmp_video: None,
    };

    jobs::enqueue_job(
        &state.pool,
        &claims.sub,
        JobKind::VideoThumbnail,
        &name,
        Some("file"),
        Some(&id),
        serde_json::to_value(payload)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("thumbnail job payload: {e}")))?,
    )
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.thumbnail.regenerate",
        Some("file"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    let file: FileDto = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "file": file })))
}

type ReprocessHlsRow = (String, Option<String>, String, bool, Option<i32>);

// Human: Rebuild browser HLS with GOP-aligned re-encode when playback freezes or A/V drifts.
// Agent: POST /files/:id/hls/reprocess; RESETS hls_ready; ENQUEUES HlsEncode with empty spool (remux source).
pub async fn reprocess_hls(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        Permission::ContentWrite,
    )
    .await?;

    let row: Option<ReprocessHlsRow> = sqlx::query_as(
        "SELECT storage_key, mime_type, name, hls_ready, segment_count FROM files \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, mime_type, name, hls_ready, segment_count) =
        row.ok_or(AppError::NotFound)?;

    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest("file is not a video".into()));
    }

    if !hls_ready && segment_count.unwrap_or(0) <= 0 {
        return Err(AppError::BadRequest(
            "video has no packaged stream to reprocess yet — wait for the first encode or re-upload"
                .into(),
        ));
    }

    if jobs::find_active_job(&state.pool, JobKind::HlsEncode, "file", &id)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict(
            "video is already being processed".into(),
        ));
    }

    // Human: Hide stream while re-encode runs so the player does not keep serving the broken package.
    // Agent: WRITES hls_ready=false + reprocessing; KEEP segment_count + source.master for the worker.
    sqlx::query(
        "UPDATE files SET hls_ready = false, hls_encode_status = 'reprocessing', hls_encode_error = NULL, \
         conversion_progress = 0 WHERE id = $1",
    )
    .bind(&id)
    .execute(&state.pool)
    .await?;

    let payload = HlsEncodePayload {
        file_id: id.clone(),
        storage_key,
        tmp_video: String::new(),
        duration_seconds: 0,
    };

    // Human: Job title shows rebuild intent in the transfer/job tray.
    // Agent: ENQUEUES HlsEncode with display name "Rebuild stream — {name}".
    let job_title = format!("Rebuild stream — {name}");
    jobs::enqueue_job(
        &state.pool,
        &claims.sub,
        JobKind::HlsEncode,
        &job_title,
        Some("file"),
        Some(&id),
        serde_json::to_value(payload)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("hls reprocess payload: {e}")))?,
    )
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.hls.reprocess",
        Some("file"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    let file: FileDto = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "file": file,
        "concurrent_limit": state.user_transcode_gate.max_per_user(),
    })))
}

// Human: Queue HLS reprocess for every ready video the caller owns (library-wide repair).
// Agent: POST /files/hls/reprocess-all; ENQUEUES one HlsEncode job per hls_ready video;
// Agent: WORKERS throttle via UserTranscodeGate (max concurrent ffmpeg per user).
pub async fn reprocess_all_hls(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let concurrent_limit = state.user_transcode_gate.max_per_user();
    let rows: Vec<(String, String, String, Option<i32>)> = sqlx::query_as(
        "SELECT id, storage_key, name, segment_count FROM files \
         WHERE user_id = $1 AND deleted_at IS NULL AND hls_ready = true \
         AND mime_type LIKE 'video/%' AND COALESCE(segment_count, 0) > 0 \
         ORDER BY created_at ASC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;

    let mut queued = 0u32;
    let mut skipped = 0u32;

    for (id, storage_key, name, _segment_count) in rows {
        if jobs::find_active_job(&state.pool, JobKind::HlsEncode, "file", &id)
            .await?
            .is_some()
        {
            skipped += 1;
            continue;
        }

        sqlx::query(
            "UPDATE files SET hls_ready = false, hls_encode_status = 'reprocessing', hls_encode_error = NULL, \
             conversion_progress = 0 WHERE id = $1",
        )
        .bind(&id)
        .execute(&state.pool)
        .await?;

        let payload = HlsEncodePayload {
            file_id: id.clone(),
            storage_key,
            tmp_video: String::new(),
            duration_seconds: 0,
        };

        let job_title = format!("Rebuild stream — {name}");
        match jobs::enqueue_job(
            &state.pool,
            &claims.sub,
            JobKind::HlsEncode,
            &job_title,
            Some("file"),
            Some(&id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("hls reprocess payload: {e}")))?,
        )
        .await
        {
            Ok(_) => {
                queued += 1;
                audit::write_audit(
                    &state.pool,
                    Some(&claims.sub),
                    "files.hls.reprocess",
                    Some("file"),
                    Some(&id),
                    Some(serde_json::json!({ "bulk": true })),
                    &headers,
                )
                .await
                .ok();
            }
            Err(error) => {
                tracing::warn!(%id, %error, "failed to enqueue HLS reprocess");
                skipped += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "queued": queued,
        "skipped": skipped,
        "concurrent_limit": concurrent_limit,
        "note": format!(
            "Jobs run at most {concurrent_limit} at a time per account; others wait in the job tray."
        ),
    })))
}

// Human: Cancel one unfinished stream rebuild and restore the previous package for playback.
// Agent: POST /files/:id/hls/cancel-reprocess; CALLS cancel_hls_reprocess_for_file; RETURNS { file }.
pub async fn cancel_reprocess_hls(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        Permission::ContentWrite,
    )
    .await?;

    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT mime_type, hls_encode_status FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, status) = row.ok_or(AppError::NotFound)?;
    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest("file is not a video".into()));
    }
    if status.as_deref() != Some("reprocessing") {
        return Err(AppError::Conflict(
            "video is not currently rebuilding".into(),
        ));
    }

    let cancelled =
        jobs::cancel_hls_reprocess_for_file(&state.pool, &claims.sub, &id).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.hls.reprocess_cancel",
        Some("file"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    let file: FileDto = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "ok": cancelled,
        "file": file,
    })))
}

// Human: Cancel every unfinished stream rebuild for the signed-in user (queued or in progress).
// Agent: POST /files/hls/cancel-reprocess-all; RESTORES prior packages; RETURNS cancelled counts.
pub async fn cancel_all_reprocess_hls(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let (cancelled_files, cancelled_jobs) =
        jobs::cancel_all_hls_reprocess_for_user(&state.pool, &claims.sub).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.hls.reprocess_cancel_all",
        None,
        None,
        Some(serde_json::json!({
            "cancelled_files": cancelled_files,
            "cancelled_jobs": cancelled_jobs,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({
        "cancelled_files": cancelled_files,
        "cancelled_jobs": cancelled_jobs,
    })))
}
