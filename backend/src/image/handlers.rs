// Human: HTTP handlers for server-generated grid thumbnail JPEG sidecars.
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
);

// Human: Stream the grid JPEG sidecar for an owned image or document file.
// Agent: GET /files/:id/grid-thumbnail; READS image/document thumbnail ready flags; RETURNS image/jpeg body.
pub async fn get_grid_thumbnail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<impl axum::response::IntoResponse, AppError> {
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
         hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status \
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

    let thumb_key = grid_thumbnail_storage_key(&storage_key);
    let (mut stream, _, _) = state
        .storage
        .get_stream(&thumb_key)
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
