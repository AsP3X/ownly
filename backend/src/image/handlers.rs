// Human: HTTP handlers for server-generated image grid thumbnails.
// Agent: GET /files/:id/grid-thumbnail streams JPEG bytes with private cache headers.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap},
    Extension,
};
use futures_util::StreamExt;

use crate::{
    auth::handlers::Claims,
    error::AppError,
    files::processing::ensure_file_not_processing,
    image::grid_thumbnail_storage_key,
    AppState,
};

type GridThumbnailRow = (
    Option<String>,
    String,
    bool,
    Option<String>,
    bool,
    Option<String>,
    bool,
    Option<String>,
);

// Human: Stream the grid JPEG sidecar for an owned image file.
// Agent: GET /files/:id/grid-thumbnail; READS image_thumbnail_ready; RETURNS image/jpeg body.
pub async fn get_grid_thumbnail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let row: Option<GridThumbnailRow> = sqlx::query_as(
        "SELECT mime_type, storage_key, image_thumbnail_ready, image_thumbnail_status, \
         hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status \
         FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (
        mime_type,
        storage_key,
        image_thumbnail_ready,
        image_thumbnail_status,
        hls_ready,
        hls_encode_status,
        audio_waveform_ready,
        audio_encode_status,
    ) = row.ok_or(AppError::NotFound)?;

    let mime = mime_type.as_deref().unwrap_or("");
    if !mime.starts_with("image/") {
        return Err(AppError::BadRequest("file is not an image".into()));
    }

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    if !image_thumbnail_ready {
        let _detail = image_thumbnail_status.as_deref().unwrap_or("pending");
        return Err(AppError::NotFound);
    }

    let thumb_key = grid_thumbnail_storage_key(&storage_key);
    let (mut stream, size, _) = state
        .storage
        .get_stream(&thumb_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Storage(e.to_string()))?;
        data.extend_from_slice(&chunk);
    }

    let headers = HeaderMap::from_iter([
        (
            header::CONTENT_TYPE,
            "image/jpeg"
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content type")))?,
        ),
        (
            header::CONTENT_LENGTH,
            size.to_string()
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content length")))?,
        ),
        (
            header::CACHE_CONTROL,
            "private, max-age=3600"
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid cache-control")))?,
        ),
    ]);

    Ok((headers, Body::from(data)))
}
