// Human: HTTP handlers for server-generated grid thumbnail JPEG sidecars.
// Agent: GET /files/:id/grid-thumbnail streams JPEG bytes with ETag + private cache headers.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension,
};

use crate::{
    auth::handlers::Claims,
    document::mime,
    error::AppError,
    files::processing::ensure_file_not_processing,
    image::grid_thumbnail_storage_key,
    AppState,
};

type GridThumbnailRow = (
    Option<String>,
    String,
    String,
    bool,
    Option<String>,
    bool,
    Option<String>,
    bool,
    Option<String>,
    bool,
    Option<String>,
    chrono::DateTime<chrono::Utc>,
);

// Human: Build a weak ETag from file updated_at for conditional GET support.
// Agent: FORMAT W/"{unix_ms}"; MATCHED by If-None-Match in get_grid_thumbnail.
fn thumbnail_etag(updated_at: chrono::DateTime<chrono::Utc>) -> String {
    format!("W/\"{}\"", updated_at.timestamp_millis())
}

// Human: Stream the grid JPEG sidecar for an owned image or document file.
// Agent: GET /files/:id/grid-thumbnail; READS image/document thumbnail ready flags; RETURNS image/jpeg body.
pub async fn get_grid_thumbnail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let row: Option<GridThumbnailRow> = sqlx::query_as(
        "SELECT mime_type, storage_key, name, image_thumbnail_ready, image_thumbnail_status, \
         document_thumbnail_ready, document_thumbnail_status, \
         hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status, updated_at \
         FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (
        mime_type,
        storage_key,
        name,
        image_thumbnail_ready,
        image_thumbnail_status,
        document_thumbnail_ready,
        document_thumbnail_status,
        hls_ready,
        hls_encode_status,
        audio_waveform_ready,
        audio_encode_status,
        updated_at,
    ) = row.ok_or(AppError::NotFound)?;

    let mime = mime_type.as_deref().unwrap_or("");
    let is_image = mime.starts_with("image/");
    let is_document = mime::qualifies_for_document_grid_thumbnail(mime, &name);
    if !is_image && !is_document {
        return Err(AppError::BadRequest(
            "file does not support grid thumbnail preview".into(),
        ));
    }

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    let preview_ready = if is_image {
        image_thumbnail_ready
    } else {
        document_thumbnail_ready
    };
    if !preview_ready {
        let _detail = if is_image {
            image_thumbnail_status.as_deref().unwrap_or("pending")
        } else {
            document_thumbnail_status.as_deref().unwrap_or("pending")
        };
        return Err(AppError::NotFound);
    }

    let etag = thumbnail_etag(updated_at);
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim() == etag)
    {
        let mut not_modified = HeaderMap::new();
        not_modified.insert(header::ETAG, etag.parse().unwrap());
        not_modified.insert(
            header::CACHE_CONTROL,
            "private, max-age=3600".parse().unwrap(),
        );
        return Ok((StatusCode::NOT_MODIFIED, not_modified).into_response());
    }

    let thumb_key = grid_thumbnail_storage_key(&storage_key);
    let (stream, content_length, _) = state
        .storage
        .get_stream(&thumb_key)
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
    response_headers.insert(
        header::ETAG,
        etag.parse()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid etag")))?,
    );
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
