// Human: Authenticated video thumbnail routes — manifest, image bytes, and user poster selection.
// Agent: GET/PATCH /files/:id/thumbnail(s); READS Nebular sidecars; AUDIT on selection change.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap},
    Extension, Json,
};
use futures_util::StreamExt;
use serde::Deserialize;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        handlers::{FileDto, FILE_COLUMNS},
        recycle_bin::ACTIVE_FILES_SQL,
    },
    jobs::{
        self,
        model::{JobKind, VideoThumbnailPayload},
    },
};

use super::{thumbnail::VideoThumbnailManifest, thumbnail_option_storage_key};

type ThumbnailManifestRow = (Option<String>, bool, Option<String>, Option<i32>);
type SelectedThumbnailRow = (Option<String>, String, bool, Option<i32>);

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
    let row: Option<ThumbnailManifestRow> = sqlx::query_as(
        "SELECT mime_type, video_thumbnail_ready, video_thumbnail_manifest_key, \
         video_thumbnail_selected_index FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(user_id)
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

// Human: Resolve the canonical poster JPEG key from DB — avoids a manifest round-trip on hot grid paths.
// Agent: READS files.storage_key + video_thumbnail_selected_index; RETURNS sidecar object key.
async fn selected_thumbnail_storage_key(
    state: &Arc<crate::AppState>,
    file_id: &str,
    user_id: &str,
) -> Result<String, AppError> {
    let row: Option<SelectedThumbnailRow> = sqlx::query_as(
        "SELECT mime_type, storage_key, video_thumbnail_ready, video_thumbnail_selected_index \
         FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, storage_key, ready, selected_index) = row.ok_or(AppError::NotFound)?;

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
    Ok(thumbnail_option_storage_key(&storage_key, index))
}

// Human: Stream the user-selected poster JPEG for grid tiles and previews.
// Agent: GET /files/:id/thumbnail; READS sidecar key from DB; RETURNS image/jpeg body.
pub async fn get_selected_thumbnail(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let thumb_key = selected_thumbnail_storage_key(&state, &id, &claims.sub).await?;
    stream_thumbnail_bytes(&state, &thumb_key).await
}

// Human: Stream one manifest option by index for the thumbnail picker UI.
// Agent: GET /files/:id/thumbnails/:index; BUILDS sidecar key from files.storage_key + index.
pub async fn get_thumbnail_option(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    Path((id, index)): Path<(String, u32)>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let row: Option<SelectedThumbnailRow> = sqlx::query_as(
        "SELECT mime_type, storage_key, video_thumbnail_ready, video_thumbnail_selected_index \
         FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, storage_key, ready, _) = row.ok_or(AppError::NotFound)?;

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
    stream_thumbnail_bytes(&state, &thumb_key).await
}

// Human: Buffered JPEG response for poster sidecars — Content-Length must match bytes read.
// Agent: READS storage stream fully; SETS image/jpeg + private cache; USES data.len() not upstream hint.
async fn stream_thumbnail_bytes(
    state: &Arc<crate::AppState>,
    storage_key: &str,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let (mut stream, _, _) = state
        .storage
        .get_stream(storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Storage(e.to_string()))?;
        data.extend_from_slice(&chunk);
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "image/jpeg"
            .parse()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content type")))?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        "private, max-age=3600"
            .parse()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid cache-control")))?,
    );
    let body_len = data.len() as u64;
    if body_len > 0 {
        headers.insert(
            header::CONTENT_LENGTH,
            body_len
                .to_string()
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content length")))?,
        );
    }

    Ok((headers, Body::from(data)))
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
    let (manifest, manifest_key) = load_manifest_for_file(&state, &id, &claims.sub).await?;

    if !manifest
        .options
        .iter()
        .any(|opt| opt.index == body.selected_index)
    {
        return Err(AppError::BadRequest("invalid thumbnail index".into()));
    }

    sqlx::query(
        "UPDATE files SET video_thumbnail_selected_index = $1 WHERE id = $2 AND user_id = $3",
    )
    .bind(body.selected_index as i32)
    .bind(&id)
    .bind(&claims.sub)
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
    let row: Option<RegenerateThumbnailRow> = sqlx::query_as(
        "SELECT storage_key, mime_type, name, video_thumbnail_status FROM files \
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
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
         video_thumbnail_error = NULL, video_thumbnail_progress = 0 WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
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
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "file": file })))
}
