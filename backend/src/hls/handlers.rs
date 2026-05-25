// Human: Authenticated HLS routes — dynamic playlists, AES keys, and segment proxies for owned video files.
// Agent: READS files row by id+user_id; STREAMS from storage under `{storage_key}/segments/*`; RATE LIMITS segment GETs.

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    hls::playlist::PlaylistGenerator,
    jobs::{self, model::HlsExportPayload, JobKind},
    rate_limit,
    stream_ticket,
    storage::Storage,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct TicketParams {
    pub ticket: Option<String>,
}

async fn ensure_file_owned(
    state: &AppState,
    file_id: &str,
    user_id: &str,
) -> Result<(String, Option<bool>, Option<i32>), AppError> {
    let row: Option<(String, Option<bool>, Option<i32>)> = sqlx::query_as(
        "SELECT storage_key, hls_ready, segment_count FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    row.ok_or(AppError::NotFound)
}

// Human: Load ffmpeg's stored stream.m3u8 and rewrite segment/key URIs for API playback.
// Agent: READS {storage_key}/stream.m3u8; FALLBACK synthesizes playlist when object missing.
pub(crate) async fn build_playlist_for_playback(
    storage: &dyn Storage,
    storage_key: &str,
    base_url: &str,
    key_uri: &str,
    segment_count: usize,
) -> Result<String, AppError> {
    let playlist_key = format!("{storage_key}/stream.m3u8");
    if let Ok(content) = read_storage_text(storage, &playlist_key).await {
        if let Ok(playlist) =
            PlaylistGenerator::rewrite_stored_playlist(&content, base_url, key_uri)
        {
            return Ok(playlist);
        }
        tracing::warn!(
            storage_key,
            "stored HLS playlist could not be rewritten; using synthetic fallback"
        );
    }

    let mut segment_files = Vec::new();
    let mut segment_durations = Vec::new();
    for i in 0..segment_count {
        segment_files.push(format!("segments/{i:04}.ts"));
        segment_durations.push(4.0);
    }

    Ok(PlaylistGenerator::generate(
        base_url,
        &segment_files,
        &segment_durations,
        key_uri,
    ))
}

// Human: Read a small storage object (playlist/key) into UTF-8 text for manifest rewriting.
// Agent: READS storage stream; RETURNS Err when object missing or not valid UTF-8.
async fn read_storage_text(storage: &dyn Storage, key: &str) -> Result<String, AppError> {
    use futures_util::TryStreamExt;

    let (mut stream, _, _) = storage
        .get_stream(key)
        .await
        .map_err(|_| AppError::NotFound)?;
    let mut out = Vec::new();
    while let Some(chunk) = stream.try_next().await.map_err(|e| {
        AppError::Storage(format!("read storage object {key}: {e}"))
    })? {
        out.extend_from_slice(&chunk);
    }
    String::from_utf8(out).map_err(|e| AppError::Storage(format!("playlist not UTF-8: {e}")))
}

// Human: Tell the client which URL to pass to hls.js — playlist when ready, otherwise null with progress.
// Agent: READS hls_ready; RETURNS JSON { url, hls_ready, conversion_progress, hls_encode_status }.
pub async fn get_stream_url(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    type StreamUrlRow = (Option<bool>, Option<i32>, Option<String>, Option<String>);
    let row: Option<StreamUrlRow> = sqlx::query_as(
        "SELECT hls_ready, conversion_progress, hls_encode_status, hls_encode_error \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (hls_ready, conversion_progress, hls_encode_status, hls_encode_error) =
        row.ok_or(AppError::NotFound)?;

    if hls_ready.unwrap_or(false) {
        let playlist_url = format!("/api/v1/files/{id}/playlist");
        return Ok(Json(serde_json::json!({
            "url": playlist_url,
            "hls_ready": true,
            "conversion_progress": conversion_progress.unwrap_or(100),
            "hls_encode_status": hls_encode_status,
        })));
    }

    Ok(Json(serde_json::json!({
        "url": null,
        "hls_ready": false,
        "conversion_progress": conversion_progress.unwrap_or(0),
        "hls_encode_status": hls_encode_status,
        "hls_encode_error": hls_encode_error,
    })))
}

pub async fn get_playlist(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (storage_key, hls_ready, segment_count) =
        ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "video is not ready for HLS playback yet".into(),
        ));
    }

    let base_url = format!("/api/v1/files/{id}");
    let key_uri = format!("/api/v1/files/{id}/key");

    let count = segment_count.unwrap_or(0) as usize;
    let playlist = build_playlist_for_playback(
        state.storage.as_ref(),
        &storage_key,
        &base_url,
        &key_uri,
        count,
    )
    .await?;

    let _storage_key = storage_key;

    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.apple.mpegurl"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
        ],
        playlist,
    )
        .into_response())
}

pub async fn get_key(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

    let key = state
        .hls_key_store
        .get_key(&id)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?
        .ok_or(AppError::NotFound)?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
        ],
        key.to_vec(),
    )
        .into_response())
}

pub async fn get_segment(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((id, segment_name)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let (storage_key, hls_ready, _) = ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::NotFound);
    }

    let rl_key = format!("{}:{}", claims.sub, id);
    rate_limit::enforce(&state.hls_segment_rl, &rl_key)?;

    if !segment_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.')
    {
        return Err(AppError::BadRequest("invalid segment name".into()));
    }

    let key = format!("{storage_key}/segments/{segment_name}");
    let (stream, _, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|_| AppError::NotFound)?;

    Ok((
        [
            (header::CONTENT_TYPE, "video/mp2t"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}

// Human: Ticket-gated progressive stream before HLS is ready (not used once hls_ready; kept for parity).
// Agent: validate_ticket; READS storage_key; SETS Accept-Ranges; STREAMS original blob.
pub async fn stream_file(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<TicketParams>,
) -> Result<impl IntoResponse, AppError> {
    let ticket = params.ticket.ok_or(AppError::Unauthorized)?;
    stream_ticket::validate_ticket(&ticket, &id, &state.signing_secret)?;

    let row: Option<(String,)> =
        sqlx::query_as("SELECT storage_key FROM files WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (storage_key,) = row.ok_or(AppError::NotFound)?;
    let (stream, size, mime) = state
        .storage
        .get_stream(&storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let headers = HeaderMap::from_iter([
        (
            header::CONTENT_TYPE,
            mime.parse().map_err(|_| AppError::Internal(anyhow::anyhow!("invalid content type")))?,
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

// Human: Poll MP4 export progress for HLS-stored videos (download tray uses this).
// Agent: READS download_export_*; POST starts job when idle; GET returns same JSON shape.
#[derive(Debug, serde::Serialize)]
pub struct ExportStatusResponse {
    status: String,
    progress: i32,
    ready: bool,
    size_bytes: Option<i64>,
    error: Option<String>,
}

type ExportRow = (
    String,
    Option<bool>,
    Option<i32>,
    bool,
    Option<String>,
    i32,
    Option<String>,
    Option<i64>,
);

async fn load_export_row(
    pool: &sqlx::PgPool,
    file_id: &str,
    user_id: &str,
) -> Result<ExportRow, AppError> {
    let row: Option<ExportRow> = sqlx::query_as(
        "SELECT storage_key, hls_ready, segment_count, download_export_ready, download_export_status, \
         download_export_progress, download_export_error, download_export_size_bytes \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    row.ok_or(AppError::NotFound)
}

fn export_status_json(
    ready: bool,
    status: Option<&str>,
    progress: i32,
    size_bytes: Option<i64>,
    error: Option<String>,
) -> ExportStatusResponse {
    let status_str = if ready {
        "ready".to_string()
    } else {
        status.unwrap_or("idle").to_string()
    };
    ExportStatusResponse {
        status: status_str,
        progress: if ready { 100 } else { progress },
        ready,
        size_bytes,
        error,
    }
}

// Human: Start or poll background HLS→MP4 export for download.
// Agent: POST WRITES audit files.export.start; SPAWNS export job when idle; GET read-only poll.
pub async fn post_export(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ExportStatusResponse>, AppError> {
    let (
        storage_key,
        hls_ready,
        segment_count,
        export_ready,
        export_status,
        export_progress,
        export_error,
        export_size,
    ) = load_export_row(&state.pool, &id, &claims.sub).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "file is not stored as HLS video".into(),
        ));
    }

    if export_ready {
        return Ok(Json(export_status_json(
            true,
            Some("ready"),
            100,
            export_size,
            None,
        )));
    }

    if export_status.as_deref() == Some("processing") || export_status.as_deref() == Some("queued") {
        return Ok(Json(export_status_json(
            false,
            export_status.as_deref(),
            export_progress,
            export_size,
            None,
        )));
    }

    if export_status.as_deref() == Some("failed") {
        return Ok(Json(export_status_json(
            false,
            Some("failed"),
            0,
            export_size,
            export_error,
        )));
    }

    let count = segment_count.unwrap_or(0);

    sqlx::query(
        "UPDATE files SET download_export_status = 'queued', download_export_error = NULL, \
         download_export_progress = 0, download_export_ready = false WHERE id = $1",
    )
    .bind(&id)
    .execute(&state.pool)
    .await?;

    let payload = HlsExportPayload {
        file_id: id.clone(),
        storage_key,
        segment_count: count,
    };

    jobs::enqueue_job(
        &state.pool,
        &claims.sub,
        JobKind::HlsExport,
        "Video export",
        Some("file"),
        Some(&id),
        serde_json::to_value(payload)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("export job payload: {e}")))?,
    )
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.export.start",
        Some("file"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(export_status_json(
        false,
        Some("queued"),
        0,
        None,
        None,
    )))
}

pub async fn get_export(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<ExportStatusResponse>, AppError> {
    let (
        _storage_key,
        hls_ready,
        _segment_count,
        export_ready,
        export_status,
        export_progress,
        export_error,
        export_size,
    ) = load_export_row(&state.pool, &id, &claims.sub).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "file is not stored as HLS video".into(),
        ));
    }

    Ok(Json(export_status_json(
        export_ready,
        export_status.as_deref(),
        export_progress,
        export_size,
        export_error,
    )))
}
