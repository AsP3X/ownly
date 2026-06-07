// Human: iOS WebKit GIF workaround — cache a looping H.264 MP4 sidecar for ticket-gated preview streams.
// Agent: READS GIF from storage; SPAWNS ffmpeg; WRITES {storage_key}/.ownly-gif-preview.mp4; STREAMS mp4.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap},
    response::IntoResponse,
};
use futures_util::StreamExt;
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::{
    error::AppError,
    hls::handlers::{encode_query_component, TicketParams},
    storage::Storage,
    stream_ticket,
    AppState,
};

/// Human: Sidecar object name for a cached GIF→MP4 preview (one per uploaded GIF blob).
/// Agent: APPENDED under the file storage_key; NOT shown as a separate drive row.
pub const GIF_PREVIEW_OBJECT_SUFFIX: &str = ".ownly-gif-preview.mp4";

// Human: Build the Nebular object key for a cached animated preview MP4.
// Agent: READS files.storage_key; RETURNS `{storage_key}/.ownly-gif-preview.mp4`.
pub fn gif_preview_object_key(storage_key: &str) -> String {
    format!("{storage_key}/{GIF_PREVIEW_OBJECT_SUFFIX}")
}

// Human: True when the stored mime type should use the animated preview MP4 path.
// Agent: READS files.mime_type string; MATCHES image/gif and common variants.
pub fn is_gif_mime(mime_type: &str) -> bool {
    mime_type.to_lowercase().contains("gif")
}

// Human: Return a same-origin ticket URL for the MP4 animated preview (iOS WebKit workaround).
// Agent: GET protected; CALLS stream_ticket::generate_ticket; GIF mime only.
pub async fn preview_animation_url(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::auth::Claims>,
    AxumPath(id): AxumPath<String>,
) -> Result<axum::Json<crate::files::handlers::DownloadUrlResponse>, AppError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT storage_key, mime_type FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (_storage_key, mime_type) = row.ok_or(AppError::NotFound)?;
    if !is_gif_mime(&mime_type) {
        return Err(AppError::BadRequest(
            "animated preview is only available for GIF images".into(),
        ));
    }

    let ticket = stream_ticket::generate_ticket(
        &id,
        &claims.sub,
        &state.signing_secret,
        state.url_expiry_seconds,
    );
    let encoded = encode_query_component(&ticket);
    Ok(axum::Json(crate::files::handlers::DownloadUrlResponse {
        url: format!("/api/v1/files/{id}/preview-animation?ticket={encoded}"),
        expires_in_seconds: state.url_expiry_seconds,
    }))
}

// Human: Ticket-gated MP4 stream for animated GIF previews (iOS Safari / WebKit).
// Agent: validate_ticket; ENSURES sidecar mp4; SETS video/mp4 headers; STREAMS bytes.
pub async fn stream_gif_preview_animation(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
    Query(params): Query<TicketParams>,
) -> Result<impl IntoResponse, AppError> {
    let ticket = params.ticket.ok_or(AppError::Unauthorized)?;
    stream_ticket::validate_ticket(&ticket, &id, &state.signing_secret)?;

    let row: Option<(String, String)> =
        sqlx::query_as("SELECT storage_key, mime_type FROM files WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (storage_key, mime_type) = row.ok_or(AppError::NotFound)?;
    if !is_gif_mime(&mime_type) {
        return Err(AppError::NotFound);
    }

    let (stream, size) = open_gif_preview_stream(state.storage.clone(), &storage_key).await?;

    let headers = HeaderMap::from_iter([
        (
            header::CONTENT_TYPE,
            "video/mp4"
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content type")))?,
        ),
        (
            header::CONTENT_LENGTH,
            size
                .to_string()
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content length")))?,
        ),
        (
            header::ACCEPT_RANGES,
            "bytes"
                .parse()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid accept-ranges")))?,
        ),
    ]);

    Ok((headers, Body::from_stream(stream)))
}

// Human: Return a cached MP4 preview stream, generating and uploading the sidecar on first request.
// Agent: READS storage; CALLS ffmpeg when sidecar missing; RETURNS (stream, size).
async fn open_gif_preview_stream(
    storage: Arc<dyn Storage>,
    gif_storage_key: &str,
) -> Result<(crate::storage::StorageStream, u64), AppError> {
    let preview_key = gif_preview_object_key(gif_storage_key);

    if storage
        .exists(&preview_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?
    {
        let (stream, size, _) = storage
            .get_stream(&preview_key)
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        return Ok((stream, size));
    }

    generate_and_store_gif_preview(storage.clone(), gif_storage_key, &preview_key).await?;

    let (stream, size, _) = storage
        .get_stream(&preview_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok((stream, size))
}

// Human: Download GIF bytes, transcode with ffmpeg, upload MP4 sidecar to object storage.
// Agent: WRITES temp files; SPAWNS ffmpeg; PUT preview object; READ-ONLY after cache warm.
async fn generate_and_store_gif_preview(
    storage: Arc<dyn Storage>,
    gif_storage_key: &str,
    preview_key: &str,
) -> Result<(), AppError> {
    let gif_temp = download_storage_object_to_temp(storage.clone(), gif_storage_key).await?;
    let mp4_temp = transcode_gif_file_with_ffmpeg(gif_temp.path()).await?;
    let mp4_bytes = tokio::fs::read(mp4_temp.path())
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("read preview mp4: {e}")))?;

    if mp4_bytes.len() < 128 {
        return Err(AppError::Internal(anyhow::anyhow!(
            "gif preview transcode produced empty output"
        )));
    }

    storage
        .put(preview_key, "video/mp4", mp4_bytes)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(())
}

// Human: Persist one storage object to a temp file for ffmpeg input.
// Agent: READS get_stream; WRITES NamedTempFile on local disk.
async fn download_storage_object_to_temp(
    storage: Arc<dyn Storage>,
    storage_key: &str,
) -> Result<NamedTempFile, AppError> {
    let (mut stream, _, _) = storage
        .get_stream(storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let temp = NamedTempFile::new()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp file create: {e}")))?;
    let path = temp.path().to_path_buf();
    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp file open: {e}")))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Internal(anyhow::anyhow!("storage read: {e}")))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("temp write: {e}")))?;
    }

    file.sync_all()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp flush: {e}")))?;

    Ok(temp)
}

// Human: Run ffmpeg to produce a browser-friendly H.264 MP4 from an animated GIF file.
// Agent: SPAWNS ffmpeg with yuv420p + faststart; RETURNS temp output path.
async fn transcode_gif_file_with_ffmpeg(input: &Path) -> Result<NamedTempFile, AppError> {
    let output = NamedTempFile::new()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp mp4 create: {e}")))?;

    let output_path: PathBuf = output.path().to_path_buf();

    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .args([
            "-f",
            "mp4",
            "-c:v",
            "libx264",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ])
        .arg(&output_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("ffmpeg spawn: {e}")))?;

    if !status.success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "ffmpeg gif preview transcode failed"
        )));
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gif_preview_object_key_appends_suffix() {
        assert_eq!(
            gif_preview_object_key("users/u1/files/f1"),
            "users/u1/files/f1/.ownly-gif-preview.mp4"
        );
    }

    #[test]
    fn is_gif_mime_matches_image_gif() {
        assert!(is_gif_mime("image/gif"));
        assert!(!is_gif_mime("image/png"));
    }
}
