// Human: iOS WebKit GIF workaround — cache a looping H.264 MP4 sidecar for ticket-gated preview streams.
// Agent: READS GIF from storage; SPAWNS ffmpeg; WRITES {storage_key}/.ownly-gif-preview.mp4; STREAMS mp4.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use tokio::sync::Mutex;
use futures_util::{stream, StreamExt};
use tempfile::TempDir;

use crate::temp_cleanup::{create_ownly_temp_dir, GIF_PREVIEW_TEMP_PREFIX};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::{
    error::AppError,
    files::delete_config::DELETE_BLOB_CONCURRENCY,
    hls::handlers::{encode_query_component, TicketParams},
    storage::Storage,
    stream_ticket,
    AppState,
};
use serde::Serialize;
use sqlx::PgPool;

/// Human: Sidecar object name for a cached GIF→MP4 preview (one per uploaded GIF blob).
/// Agent: APPENDED under the file storage_key; NOT shown as a separate drive row.
pub const GIF_PREVIEW_OBJECT_SUFFIX: &str = ".ownly-gif-preview.mp4";

// Human: Build the Nebular object key for a cached animated preview MP4.
// Agent: READS files.storage_key; RETURNS `{storage_key}/.ownly-gif-preview.mp4`.
pub fn gif_preview_object_key(storage_key: &str) -> String {
    format!("{storage_key}/{GIF_PREVIEW_OBJECT_SUFFIX}")
}

/// Human: Sidecar metadata recording source byte length when the MP4 was generated.
/// Agent: COMPARED on read; INVALIDATES stale previews when size_bytes changes.
pub const GIF_PREVIEW_META_SUFFIX: &str = ".ownly-gif-preview.meta";

/// Human: Cap webpmux frame extraction so huge animated WebP uploads cannot OOM the API.
/// Agent: REJECTS transcode when webpmux reports more frames than this limit.
const MAX_WEBP_EXTRACT_FRAMES: u32 = 480;

/// Human: Kill ffmpeg/webpmux work that exceeds this wall time so hung jobs cannot run forever.
/// Agent: USED by run_ffmpeg_animation_to_mp4 and transcode_webp_via_webpmux wrappers.
const GIF_PREVIEW_TRANSCODE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

// Human: Per-storage-key mutex so concurrent first opens share one ffmpeg transcode.
// Agent: WRITES HashMap of Arc<Mutex<()>>; TRACKS active scratch dirs for temp janitor exclusion.
pub struct GifPreviewTranscodeLocks {
    inner: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    active_scratch_dirs: Mutex<HashSet<PathBuf>>,
}

impl Default for GifPreviewTranscodeLocks {
    fn default() -> Self {
        Self::new()
    }
}

impl GifPreviewTranscodeLocks {
    // Human: Construct an empty lock registry for AppState.
    // Agent: CALLED once at startup in build_app_state.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            active_scratch_dirs: Mutex::new(HashSet::new()),
        }
    }

    // Human: Return (or create) the async mutex for one storage_key transcode critical section.
    // Agent: READS inner map; CLONES Arc<Mutex> for await-friendly guard acquisition.
    pub async fn lock_for(&self, storage_key: &str) -> Arc<Mutex<()>> {
        let mut map = self.inner.lock().await;
        map.entry(storage_key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    // Human: Mark a scratch directory in-use so the idle temp janitor will not delete it mid-transcode.
    // Agent: CALLED when ownly_gif_preview_* work dirs are created; CLEARED on transcode completion.
    pub async fn register_scratch_dir(&self, path: &Path) {
        self.active_scratch_dirs
            .lock()
            .await
            .insert(path.to_path_buf());
    }

    // Human: Release a scratch directory after ffmpeg finishes or aborts.
    // Agent: CALLED from generate_and_store finally paths; ALLOWS janitor to remove idle dirs later.
    pub async fn unregister_scratch_dir(&self, path: &Path) {
        self.active_scratch_dirs.lock().await.remove(path);
    }

    // Human: True when the temp janitor must skip this ownly_gif_preview_* path.
    // Agent: READ by temp_cleanup::remove_temp_entry; MATCHES exact registered work dir paths.
    pub async fn is_scratch_dir_in_use(&self, path: &Path) -> bool {
        self.active_scratch_dirs.lock().await.contains(path)
    }
}

// Human: Build the sidecar metadata key used to detect stale MP4 previews.
// Agent: APPENDED under storage_key; STORES ASCII source size bytes.
pub fn gif_preview_meta_object_key(storage_key: &str) -> String {
    format!("{storage_key}/{GIF_PREVIEW_META_SUFFIX}")
}

// Human: True when the stored mime type should use the animated preview MP4 path.
// Agent: READS files.mime_type string; MATCHES image/gif and common variants.
pub fn is_gif_mime(mime_type: &str) -> bool {
    mime_type.to_lowercase().contains("gif")
}

// Human: True when a file row may request server-side animated preview transcode.
// Agent: MATCHES image/gif and corrected image/webp uploads.
pub fn qualifies_for_animated_preview(mime_type: &str) -> bool {
    let mime = mime_type.to_ascii_lowercase();
    mime.contains("gif") || mime == "image/webp"
}

// Human: Admin maintenance only — delete cached iOS replay MP4/meta sidecars from object storage.
// Agent: READS files.storage_key; DELETE storage objects; NEVER called by the idle temp janitor.
pub async fn purge_all_cached_preview_sidecars(
    pool: &PgPool,
    storage: Arc<dyn Storage>,
) -> Result<u32, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT storage_key FROM files \
         WHERE deleted_at IS NULL \
           AND (lower(mime_type) LIKE '%gif%' OR lower(mime_type) = 'image/webp')",
    )
    .fetch_all(pool)
    .await?;

    let keys: Vec<String> = rows
        .into_iter()
        .flat_map(|(storage_key,)| {
            [
                gif_preview_object_key(&storage_key),
                gif_preview_meta_object_key(&storage_key),
            ]
        })
        .collect();

    let removed = stream::iter(keys)
        .map(|key| {
            let storage = storage.clone();
            async move {
                if !storage.exists(&key).await.unwrap_or(false) {
                    return 0u32;
                }
                match storage.delete(&key).await {
                    Ok(()) => 1,
                    Err(error) => {
                        tracing::warn!(key = %key, %error, "failed to delete gif preview sidecar");
                        0
                    }
                }
            }
        })
        .buffer_unordered(DELETE_BLOB_CONCURRENCY)
        .fold(0u32, |acc, count| async move { acc.saturating_add(count) })
        .await;

    Ok(removed)
}

// Human: Read the first bytes of an upload temp file for magic-byte MIME reconciliation.
// Agent: READS path on disk; RETURNS up to 16 header bytes.
pub async fn read_file_magic_head(path: &Path) -> Result<Vec<u8>, AppError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("upload magic open: {e}")))?;
    let mut head = vec![0u8; 16];
    let read_len = file
        .read(&mut head)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("upload magic read: {e}")))?;
    head.truncate(read_len);
    Ok(head)
}

// Human: Prefer sniffed image container over client Content-Type when bytes are known.
// Agent: READS magic header; FIXES WebP-stored-as-GIF and similar upload mismatches.
pub fn reconcile_upload_image_mime(head: &[u8], resolved_mime: &str) -> String {
    match sniff_image_format(head) {
        SniffedImageFormat::Gif => "image/gif".to_string(),
        SniffedImageFormat::WebP => "image/webp".to_string(),
        SniffedImageFormat::Png => {
            if resolved_mime.to_ascii_lowercase().contains("gif") {
                "image/png".to_string()
            } else if resolved_mime.to_ascii_lowercase().starts_with("image/") {
                resolved_mime.to_string()
            } else {
                "image/png".to_string()
            }
        }
        SniffedImageFormat::Jpeg => {
            if resolved_mime.to_ascii_lowercase().contains("gif") {
                "image/jpeg".to_string()
            } else if resolved_mime.to_ascii_lowercase().starts_with("image/") {
                resolved_mime.to_string()
            } else {
                "image/jpeg".to_string()
            }
        }
        SniffedImageFormat::Unknown => resolved_mime.to_string(),
    }
}

// Human: Build standard MP4 preview response headers for GET and HEAD handlers.
// Agent: SETS video/mp4, Content-Length, Accept-Ranges bytes.
pub fn preview_mp4_headers_for_size(size: u64) -> Result<HeaderMap, AppError> {
    preview_mp4_headers(size)
}

fn preview_mp4_headers(size: u64) -> Result<HeaderMap, AppError> {
    Ok(HeaderMap::from_iter([
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
    ]))
}

/// Human: Ticket URL for preview-animation plus whether the MP4 sidecar is already in object storage.
/// Agent: SERIALIZED by preview_animation_url handlers; `ready` avoids client-side ffmpeg polling.
#[derive(Debug, Serialize)]
pub struct PreviewAnimationUrlResponse {
    pub url: String,
    pub expires_in_seconds: u64,
    /// Human: True when `.ownly-gif-preview.mp4` is cached — GET streams without re-transcoding.
    /// Agent: READ from preview_sidecar_is_ready; FALSE on first open until ffmpeg finishes.
    pub ready: bool,
}

// Human: True when a cached MP4 sidecar in object storage matches the live source object.
// Agent: READS storage exists + meta; DOES NOT transcode or download source bytes.
pub async fn preview_sidecar_is_ready(
    storage: &Arc<dyn Storage>,
    storage_key: &str,
    source_size_bytes: u64,
) -> Result<bool, AppError> {
    cached_sidecar_is_fresh(storage, storage_key, source_size_bytes).await
}

// Human: Return a same-origin ticket URL for the MP4 animated preview (iOS WebKit workaround).
// Agent: GET protected; CALLS stream_ticket::generate_ticket; REPORTS object-storage sidecar readiness.
pub async fn preview_animation_url(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::auth::Claims>,
    AxumPath(id): AxumPath<String>,
) -> Result<axum::Json<PreviewAnimationUrlResponse>, AppError> {
    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT storage_key, mime_type, size_bytes FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, mime_type, size_bytes) = row.ok_or(AppError::NotFound)?;
    if !qualifies_for_animated_preview(&mime_type) {
        return Err(AppError::BadRequest(
            "animated preview is only available for GIF and animated WebP images".into(),
        ));
    }

    let source_size_bytes = size_bytes.max(0) as u64;
    let ready =
        preview_sidecar_is_ready(&state.storage, &storage_key, source_size_bytes).await?;

    let ticket = stream_ticket::generate_ticket(
        &id,
        &claims.sub,
        &state.signing_secret,
        state.url_expiry_seconds,
    );
    let encoded = encode_query_component(&ticket);
    Ok(axum::Json(PreviewAnimationUrlResponse {
        url: format!("/api/v1/files/{id}/preview-animation?ticket={encoded}"),
        expires_in_seconds: state.url_expiry_seconds,
        ready,
    }))
}

// Human: Ticket-gated MP4 stream for animated GIF previews (iOS Safari / WebKit).
// Agent: validate_ticket; ENSURES sidecar mp4; SETS video/mp4 headers; STREAMS bytes or HEAD only.
pub async fn stream_gif_preview_animation(
    method: Method,
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
    Query(params): Query<TicketParams>,
) -> Result<Response, AppError> {
    let ticket = params.ticket.ok_or(AppError::Unauthorized)?;
    stream_ticket::validate_ticket(&ticket, &id, &state.signing_secret)?;

    let row: Option<(String, String, i64)> =
        sqlx::query_as("SELECT storage_key, mime_type, size_bytes FROM files WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (storage_key, mime_type, size_bytes) = row.ok_or(AppError::NotFound)?;
    if !qualifies_for_animated_preview(&mime_type) {
        return Err(AppError::NotFound);
    }

    let source_size_bytes = size_bytes.max(0) as u64;
    let storage = state.storage.clone();

    // Human: HEAD must not transcode — only report cached sidecar metadata when already ready.
    // Agent: READS cached_sidecar_is_fresh; RETURNS 404 on miss; SKIPS open_gif_preview_stream/ffmpeg.
    if method == Method::HEAD {
        if !preview_sidecar_is_ready(&storage, &storage_key, source_size_bytes).await? {
            return Err(AppError::NotFound);
        }
        let preview_key = gif_preview_object_key(&storage_key);
        let (_, mp4_size, _) = storage
            .get_stream(&preview_key)
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let headers = preview_mp4_headers(mp4_size)?;
        return Ok((StatusCode::OK, headers).into_response());
    }

    let (stream, mp4_size) =
        open_gif_preview_stream(&state, &storage_key, source_size_bytes).await?;
    let headers = preview_mp4_headers(mp4_size)?;

    Ok((headers, Body::from_stream(stream)).into_response())
}

// Human: Open (or generate) the cached MP4 sidecar for a storage object.
// Agent: READS sidecar + meta; LOCKS transcode; CALLS ffmpeg on cache miss.
pub async fn open_gif_preview_stream(
    state: &AppState,
    gif_storage_key: &str,
    source_size_bytes: u64,
) -> Result<(crate::storage::StorageStream, u64), AppError> {
    let storage = state.storage.clone();
    let preview_key = gif_preview_object_key(gif_storage_key);

    if cached_sidecar_is_fresh(&storage, gif_storage_key, source_size_bytes).await? {
        let (stream, size, _) = storage
            .get_stream(&preview_key)
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        return Ok((stream, size));
    }

    let lock = state
        .gif_preview_transcode_locks
        .lock_for(gif_storage_key)
        .await;
    let _guard = lock.lock().await;

    if cached_sidecar_is_fresh(&storage, gif_storage_key, source_size_bytes).await? {
        let (stream, size, _) = storage
            .get_stream(&preview_key)
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        return Ok((stream, size));
    }

    generate_and_store_gif_preview(
        storage.clone(),
        gif_storage_key,
        &preview_key,
        source_size_bytes,
        &state.gif_preview_transcode_locks,
    )
    .await?;

    let (stream, size, _) = storage
        .get_stream(&preview_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok((stream, size))
}

// Human: True when a cached MP4 sidecar exists and matches the current source size_bytes.
// Agent: READS meta sidecar; DELETES stale mp4+meta when size drift detected.
async fn cached_sidecar_is_fresh(
    storage: &Arc<dyn Storage>,
    gif_storage_key: &str,
    source_size_bytes: u64,
) -> Result<bool, AppError> {
    let preview_key = gif_preview_object_key(gif_storage_key);
    if !storage
        .exists(&preview_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?
    {
        return Ok(false);
    }

    let meta_key = gif_preview_meta_object_key(gif_storage_key);
    if !storage
        .exists(&meta_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?
    {
        // Human: Legacy sidecars without versioned meta must regenerate with compositing fixes.
        // Agent: RETURNS false so open_gif_preview_stream rebuilds the MP4 sidecar.
        return Ok(false);
    }

    let (meta_version, stored_size) = read_sidecar_meta(storage, &meta_key).await?;
    if !sidecar_meta_matches_source(meta_version, stored_size, source_size_bytes) {
        let _ = storage.delete(&preview_key).await;
        let _ = storage.delete(&meta_key).await;
        return Ok(false);
    }

    Ok(true)
}

// Human: True when sidecar meta version and recorded source size still match the live object.
// Agent: PURE check; USED by cached_sidecar_is_fresh before returning cache hit.
fn sidecar_meta_matches_source(
    meta_version: u32,
    stored_size: u64,
    source_size_bytes: u64,
) -> bool {
    meta_version == GIF_PREVIEW_META_VERSION && stored_size == source_size_bytes
}

// Human: Parse versioned `.ownly-gif-preview.meta` (`version\\nsource_size`).
// Agent: READS sidecar meta object; RETURNS (version, size) or defaults when malformed.
async fn read_sidecar_meta(
    storage: &Arc<dyn Storage>,
    meta_key: &str,
) -> Result<(u32, u64), AppError> {
    let (mut stream, _, _) = storage
        .get_stream(meta_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Internal(anyhow::anyhow!("meta read: {e}")))?;
        bytes.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = text.lines();
    let version = lines
        .next()
        .and_then(|line| line.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let size = lines
        .next()
        .and_then(|line| line.trim().parse::<u64>().ok())
        .unwrap_or(0);
    Ok((version, size))
}

fn format_sidecar_meta(source_size_bytes: u64) -> String {
    format!("{GIF_PREVIEW_META_VERSION}\n{source_size_bytes}")
}

// Human: Download GIF bytes, transcode with ffmpeg, upload MP4 sidecar to object storage.
// Agent: WRITES temp files; SPAWNS ffmpeg; PUT preview object; READ-ONLY after cache warm.
async fn generate_and_store_gif_preview(
    storage: Arc<dyn Storage>,
    gif_storage_key: &str,
    preview_key: &str,
    source_size_bytes: u64,
    transcode_locks: &GifPreviewTranscodeLocks,
) -> Result<(), AppError> {
    let (gif_dir, source_path, source_format) =
        download_storage_object_to_temp(storage.clone(), gif_storage_key, transcode_locks).await?;
    let source_scratch = gif_dir.path().to_path_buf();
    let mp4_bytes =
        transcode_animation_to_mp4(&source_path, source_format, transcode_locks).await;
    transcode_locks
        .unregister_scratch_dir(&source_scratch)
        .await;
    let mp4_bytes = mp4_bytes?;
    drop(gif_dir);

    if mp4_bytes.len() < 128 {
        return Err(AppError::Internal(anyhow::anyhow!(
            "gif preview transcode produced empty output"
        )));
    }

    storage
        .put(preview_key, "video/mp4", mp4_bytes)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let meta_key = gif_preview_meta_object_key(gif_storage_key);
    storage
        .put(
            &meta_key,
            "text/plain",
            format_sidecar_meta(source_size_bytes).into_bytes(),
        )
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(())
}

// Human: Detected on-disk image container — drives ffmpeg input flags and file extension.
// Agent: READS first bytes of downloaded object; USED before ffmpeg spawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SniffedImageFormat {
    Gif,
    WebP,
    Png,
    Jpeg,
    Unknown,
}

// Human: Classify stored bytes so mislabeled GIF mime rows still transcode (WebP/PNG/JPEG).
// Agent: READS magic header; RETURNS SniffedImageFormat.
fn sniff_image_format(head: &[u8]) -> SniffedImageFormat {
    if head.len() >= 6 && (head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a")) {
        return SniffedImageFormat::Gif;
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return SniffedImageFormat::WebP;
    }
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        return SniffedImageFormat::Png;
    }
    if head.len() >= 2 && head[0] == 0xFF && head[1] == 0xD8 {
        return SniffedImageFormat::Jpeg;
    }
    SniffedImageFormat::Unknown
}

// Human: Pick a filename extension ffmpeg can probe when the DB mime type is image/gif.
// Agent: MAPS SniffedImageFormat → source.{gif,webp,png,jpg,bin}.
fn source_filename_for_format(format: SniffedImageFormat) -> &'static str {
    match format {
        SniffedImageFormat::Gif => "source.gif",
        SniffedImageFormat::WebP => "source.webp",
        SniffedImageFormat::Png => "source.png",
        SniffedImageFormat::Jpeg => "source.jpg",
        SniffedImageFormat::Unknown => "source.bin",
    }
}

// Human: Ordered ffmpeg input strategies per sniffed container type.
// Agent: RETURNS Auto first, then container-specific fallbacks (image2 for WebP).
#[derive(Clone, Copy)]
enum TranscodeAttempt {
    /// Human: Extract animated WebP frames with webpmux+dwebp — ffmpeg libwebp often fails on uploads.
    WebpmuxFrames,
    Auto,
    Demuxer(&'static str),
    /// Human: WebP animation often needs variable frame timing on the output side.
    WebpVariableFps,
}

fn transcode_attempts(format: SniffedImageFormat) -> Vec<TranscodeAttempt> {
    match format {
        SniffedImageFormat::Gif => vec![
            TranscodeAttempt::Auto,
            TranscodeAttempt::Demuxer("gif"),
        ],
        SniffedImageFormat::WebP => vec![
            TranscodeAttempt::WebpmuxFrames,
            TranscodeAttempt::Auto,
            TranscodeAttempt::WebpVariableFps,
        ],
        SniffedImageFormat::Png => vec![
            TranscodeAttempt::Auto,
            TranscodeAttempt::Demuxer("png"),
        ],
        SniffedImageFormat::Jpeg => vec![
            TranscodeAttempt::Auto,
            TranscodeAttempt::Demuxer("image2"),
        ],
        SniffedImageFormat::Unknown => vec![TranscodeAttempt::Auto],
    }
}

// Human: Persist one storage object to a temp dir with a sniffed extension for ffmpeg.
// Agent: READS get_stream; WRITES work_dir/source.*; RETURNS dir handle, path, and format.
async fn download_storage_object_to_temp(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    transcode_locks: &GifPreviewTranscodeLocks,
) -> Result<(TempDir, PathBuf, SniffedImageFormat), AppError> {
    let work_dir = create_ownly_temp_dir(GIF_PREVIEW_TEMP_PREFIX)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp dir create: {e}")))?;
    transcode_locks
        .register_scratch_dir(work_dir.path())
        .await;
    let staging_path = work_dir.path().join("source.staging");

    let (mut stream, _, _) = storage
        .get_stream(storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut file = tokio::fs::File::create(&staging_path)
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
    drop(file);

    let size = tokio::fs::metadata(&staging_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp stat: {e}")))?
        .len();
    if size < 6 {
        return Err(AppError::Internal(anyhow::anyhow!(
            "gif preview source object is empty or truncated ({size} bytes)"
        )));
    }

    let mut head = [0u8; 16];
    let mut header_file = tokio::fs::File::open(&staging_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp header open: {e}")))?;
    let read_len = header_file
        .read(&mut head)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp header read: {e}")))?;
    let source_format = sniff_image_format(&head[..read_len]);
    let source_path = work_dir.path().join(source_filename_for_format(source_format));
    tokio::fs::rename(&staging_path, &source_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp rename: {e}")))?;

    Ok((work_dir, source_path, source_format))
}

const FFMPEG_EVEN_SCALE_VF: &str = "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1";

/// Human: Bump when preview MP4 encoding logic changes so stale sidecars regenerate.
/// Agent: WRITTEN to `.ownly-gif-preview.meta` line 1; READ by cached_sidecar_is_fresh.
const GIF_PREVIEW_META_VERSION: u32 = 2;

// Human: Per-frame metadata from `webpmux -info` for animated WebP compositing.
// Agent: READS x/y offsets + dispose/blend; DRIVES canvas overlay loop before ffmpeg MP4.
#[derive(Debug, Clone)]
struct WebpFrameMeta {
    x_offset: u32,
    y_offset: u32,
    dispose: String,
    blend: bool,
}

// Human: Round a pixel dimension down to an even value for H.264 / yuv420p output.
// Agent: USED by webpmux canvas sizing; PREVENTS SAR drift in preview MP4.
fn even_dimension(value: u32) -> u32 {
    let value = value.max(2);
    value - (value % 2)
}

// Human: Parse `webpmux -info` canvas size for fixed-frame animated WebP transcodes.
// Agent: READS `Canvas size: W x H`; RETURNS even dimensions when present.
fn parse_webpmux_canvas_size(info: &str) -> Option<(u32, u32)> {
    for line in info.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("Canvas size:") else {
            continue;
        };
        let mut parts = rest.split('x');
        let width = parts.next()?.trim().parse::<u32>().ok()?;
        let height = parts.next()?.trim().parse::<u32>().ok()?;
        return Some((even_dimension(width), even_dimension(height)));
    }
    None
}

// Human: Build ffmpeg `-vf` for stable preview MP4 aspect ratio (even output + square pixels).
// Agent: USES fixed canvas pad for webpmux PNG sequences; FALLBACK to even scale otherwise.
fn preview_mp4_video_filter(canvas_size: Option<(u32, u32)>) -> String {
    if let Some((width, height)) = canvas_size {
        return format!(
            "scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,\
             pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1"
        );
    }
    FFMPEG_EVEN_SCALE_VF.to_string()
}

// Human: Parse `webpmux -info` output for animated WebP frame count.
// Agent: READS stdout line `Number of frames:`; DEFAULTS to 1 when missing.
fn parse_webpmux_frame_count(info: &str) -> u32 {
    for line in info.lines() {
        if let Some(count) = line
            .trim()
            .strip_prefix("Number of frames:")
            .map(str::trim)
        {
            if let Ok(parsed) = count.parse::<u32>() {
                return parsed.max(1);
            }
        }
    }
    1
}

// Human: Parse the animated WebP frame table from `webpmux -info` output.
// Agent: READS width/height/x_offset/y_offset/dispose/blend per frame row.
fn parse_webpmux_frame_table(info: &str) -> Vec<WebpFrameMeta> {
    let mut frames = Vec::new();
    for line in info.lines() {
        let trimmed = line.trim();
        let Some(first_char) = trimmed.chars().next() else {
            continue;
        };
        if !first_char.is_ascii_digit() {
            continue;
        }
        let Some((_, rest)) = trimmed.split_once(':') else {
            continue;
        };
        let tokens: Vec<&str> = rest.split_whitespace().collect();
        if tokens.len() < 8 {
            continue;
        }
        let Ok(width) = tokens[0].parse::<u32>() else {
            continue;
        };
        let Ok(height) = tokens[1].parse::<u32>() else {
            continue;
        };
        let Ok(x_offset) = tokens[3].parse::<u32>() else {
            continue;
        };
        let Ok(y_offset) = tokens[4].parse::<u32>() else {
            continue;
        };
        let _ = (width, height);
        frames.push(WebpFrameMeta {
            x_offset,
            y_offset,
            dispose: tokens[6].to_ascii_lowercase(),
            blend: matches!(tokens[7].to_ascii_lowercase().as_str(), "yes" | "blend"),
        });
    }
    frames
}

// Human: Read GIF logical screen dimensions from the file header bytes.
// Agent: READS bytes 6–9 little-endian; USED to lock ffmpeg output canvas size for GIF MP4.
fn probe_gif_logical_screen(head: &[u8]) -> Option<(u32, u32)> {
    if sniff_image_format(head) != SniffedImageFormat::Gif || head.len() < 10 {
        return None;
    }
    let width = u16::from_le_bytes([head[6], head[7]]) as u32;
    let height = u16::from_le_bytes([head[8], head[9]]) as u32;
    if width == 0 || height == 0 {
        return None;
    }
    Some((even_dimension(width), even_dimension(height)))
}

// Human: Create a transparent RGBA PNG canvas via ffmpeg lavfi for WebP frame compositing.
// Agent: SPAWNS ffmpeg color source; WRITES canvas PNG at canvas_w x canvas_h.
async fn create_transparent_canvas_png(path: &Path, canvas_w: u32, canvas_h: u32) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "canvas path invalid".to_string())?;
    let color = format!("color=c=0x00000000:s={canvas_w}x{canvas_h}:d=1");
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .args(["-f", "lavfi", "-i"])
        .arg(&color)
        .args(["-frames:v", "1", "-pix_fmt", "rgba"])
        .arg(path_str)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()
        .await
        .map_err(|e| format!("ffmpeg canvas spawn: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg transparent canvas failed exit={:?}",
            status.code()
        ))
    }
}

// Human: Overlay one PNG patch onto a canvas PNG at the animated WebP frame offset.
// Agent: SPAWNS ffmpeg overlay filter; WRITES composited PNG for MP4 frame input.
async fn ffmpeg_overlay_png(
    canvas: &Path,
    patch: &Path,
    output: &Path,
    x_offset: u32,
    y_offset: u32,
    blend: bool,
) -> Result<(), String> {
    let canvas_str = canvas
        .to_str()
        .ok_or_else(|| "canvas path invalid".to_string())?;
    let patch_str = patch
        .to_str()
        .ok_or_else(|| "patch path invalid".to_string())?;
    let output_str = output
        .to_str()
        .ok_or_else(|| "overlay output path invalid".to_string())?;
    let filter = if blend {
        format!("[0][1]overlay={x_offset}:{y_offset}:format=auto")
    } else {
        format!("[0][1]overlay={x_offset}:{y_offset}:format=rgb")
    };
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .args(["-i", canvas_str, "-i", patch_str, "-filter_complex"])
        .arg(&filter)
        .args(["-frames:v", "1"])
        .arg(output_str)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()
        .await
        .map_err(|e| format!("ffmpeg overlay spawn: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg overlay failed exit={:?}",
            status.code()
        ))
    }
}

// Human: Composite animated WebP patches onto a fixed canvas before MP4 encode.
// Agent: READS webpmux frame table; OVERLAYs each patch at x/y; HANDLES dispose modes.
async fn composite_webp_frames_on_canvas(
    frames_dir: &Path,
    input: &Path,
    canvas_size: (u32, u32),
    frame_metas: &[WebpFrameMeta],
) -> Result<(), String> {
    let input_str = input
        .to_str()
        .ok_or_else(|| "webp input path invalid".to_string())?;
    let mut canvas_path = frames_dir.join("canvas_current.png");
    create_transparent_canvas_png(&canvas_path, canvas_size.0, canvas_size.1).await?;
    let mut restore_previous: Option<PathBuf> = None;
    let mut pending_restore = false;

    for (frame_index, meta) in frame_metas.iter().enumerate() {
        let frame_number = frame_index + 1;
        if pending_restore {
            if let Some(previous) = restore_previous.as_ref() {
                let restored = frames_dir.join(format!("canvas_restore_{frame_number:04}.png"));
                tokio::fs::copy(previous, &restored)
                    .await
                    .map_err(|e| format!("restore canvas copy: {e}"))?;
                canvas_path = restored;
            }
            pending_restore = false;
        }

        let backup_path = frames_dir.join(format!("canvas_backup_{frame_number:04}.png"));
        tokio::fs::copy(&canvas_path, &backup_path)
            .await
            .map_err(|e| format!("canvas backup copy: {e}"))?;

        let frame_webp = frames_dir.join(format!("frame_{frame_number}.webp"));
        let patch_png = frames_dir.join(format!("patch_{frame_number:04}.png"));
        let mux_status = Command::new("webpmux")
            .args([
                "-get",
                "frame",
                &frame_number.to_string(),
                input_str,
                "-o",
                frame_webp
                    .to_str()
                    .ok_or_else(|| "webp frame path invalid".to_string())?,
            ])
            .status()
            .await
            .map_err(|e| format!("webpmux get frame {frame_number}: {e}"))?;
        if !mux_status.success() {
            return Err(format!("webpmux get frame {frame_number} failed"));
        }

        let dwebp_status = Command::new("dwebp")
            .args([
                frame_webp
                    .to_str()
                    .ok_or_else(|| "webp frame path invalid".to_string())?,
                "-o",
                patch_png
                    .to_str()
                    .ok_or_else(|| "patch png path invalid".to_string())?,
            ])
            .status()
            .await
            .map_err(|e| format!("dwebp frame {frame_number}: {e}"))?;
        if !dwebp_status.success() {
            return Err(format!("dwebp frame {frame_number} failed"));
        }

        let composited = frames_dir.join(format!("frame_{frame_number:04}.png"));
        ffmpeg_overlay_png(
            &canvas_path,
            &patch_png,
            &composited,
            meta.x_offset,
            meta.y_offset,
            meta.blend,
        )
        .await?;
        canvas_path = composited;

        match meta.dispose.as_str() {
            "background" => {
                let cleared = frames_dir.join(format!("canvas_clear_{frame_number:04}.png"));
                create_transparent_canvas_png(&cleared, canvas_size.0, canvas_size.1).await?;
                canvas_path = cleared;
            }
            "previous" => {
                restore_previous = Some(backup_path);
                pending_restore = true;
            }
            _ => {}
        }
    }

    Ok(())
}

// Human: Animated WebP → PNG sequence via webpmux/dwebp, then ffmpeg H.264 MP4.
// Agent: SPAWNS webpmux per frame; CALLS ffmpeg on frame_%04d.png; RETURNS mp4 bytes.
async fn transcode_webp_via_webpmux(
    input: &Path,
    transcode_locks: &GifPreviewTranscodeLocks,
) -> Result<Vec<u8>, String> {
    let work_dir = create_ownly_temp_dir(GIF_PREVIEW_TEMP_PREFIX)
        .map_err(|e| format!("temp dir create: {e}"))?;
    transcode_locks
        .register_scratch_dir(work_dir.path())
        .await;
    let transcode_result = transcode_webp_via_webpmux_inner(input, &work_dir).await;
    transcode_locks
        .unregister_scratch_dir(work_dir.path())
        .await;
    transcode_result
}

// Human: Animated WebP frame extraction and ffmpeg mux — wrapped for scratch registration and timeout.
// Agent: CALLS webpmux/dwebp per frame; SPAWNS ffmpeg; RETURNS mp4 bytes or Err on timeout.
async fn transcode_webp_via_webpmux_inner(
    input: &Path,
    work_dir: &TempDir,
) -> Result<Vec<u8>, String> {
    match tokio::time::timeout(
        GIF_PREVIEW_TRANSCODE_TIMEOUT,
        transcode_webp_via_webpmux_work(input, work_dir),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(format!(
            "webp preview transcode timed out after {} seconds",
            GIF_PREVIEW_TRANSCODE_TIMEOUT.as_secs()
        )),
    }
}

async fn transcode_webp_via_webpmux_work(
    input: &Path,
    work_dir: &TempDir,
) -> Result<Vec<u8>, String> {
    let frames_dir = work_dir.path().join("frames");
    tokio::fs::create_dir_all(&frames_dir)
        .await
        .map_err(|e| format!("frames dir create: {e}"))?;

    let info_output = Command::new("webpmux")
        .arg("-info")
        .arg(input)
        .output()
        .await
        .map_err(|e| format!("webpmux info spawn: {e}"))?;
    if !info_output.status.success() {
        return Err(format!(
            "webpmux info failed: {}",
            String::from_utf8_lossy(&info_output.stderr)
        ));
    }

    let info = String::from_utf8_lossy(&info_output.stdout);
    let frame_count = parse_webpmux_frame_count(&info);
    let canvas_size = parse_webpmux_canvas_size(&info)
        .ok_or_else(|| "webpmux canvas size missing".to_string())?;
    if frame_count > MAX_WEBP_EXTRACT_FRAMES {
        return Err(format!(
            "webp animation exceeds {MAX_WEBP_EXTRACT_FRAMES} frames ({frame_count})"
        ));
    }

    let mut frame_metas = parse_webpmux_frame_table(&info);
    if frame_metas.is_empty() {
        frame_metas = (0..frame_count)
            .map(|_| WebpFrameMeta {
                x_offset: 0,
                y_offset: 0,
                dispose: "none".to_string(),
                blend: true,
            })
            .collect();
    }

    composite_webp_frames_on_canvas(&frames_dir, input, canvas_size, &frame_metas).await?;

    let output_path = work_dir.path().join("preview.mp4");
    let input_pattern = frames_dir.join("frame_%04d.png");
    let pattern_str = input_pattern
        .to_str()
        .ok_or_else(|| "png pattern path invalid".to_string())?;
    let output_str = output_path
        .to_str()
        .ok_or_else(|| "mp4 output path invalid".to_string())?;
    let setsar_only = format!(
        "scale={}:{}:flags=neighbor,setsar=1",
        canvas_size.0, canvas_size.1
    );

    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .args(["-framerate", "10", "-i"])
        .arg(pattern_str)
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-vf",
            &setsar_only,
        ])
        .arg(output_str)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()
        .await
        .map_err(|e| format!("ffmpeg webpmux spawn: {e}"))?;

    if !status.success() {
        return Err(format!(
            "ffmpeg webpmux png sequence failed exit={:?}",
            status.code()
        ));
    }

    tokio::fs::read(&output_path)
        .await
        .map_err(|e| format!("read webpmux mp4: {e}"))
}

// Human: Run ffmpeg to produce a browser-friendly H.264 MP4 from an animated image file.
// Agent: TRIES auto-probe then explicit demuxer; LOGS stderr tail on failure; RETURNS mp4 bytes.
async fn transcode_animation_to_mp4(
    input: &Path,
    source_format: SniffedImageFormat,
    transcode_locks: &GifPreviewTranscodeLocks,
) -> Result<Vec<u8>, AppError> {
    let fixed_canvas = read_fixed_canvas_size(input, source_format).await;
    let mut attempt_errors = Vec::new();

    for attempt in transcode_attempts(source_format) {
        let result = match attempt {
            TranscodeAttempt::WebpmuxFrames => {
                transcode_webp_via_webpmux(input, transcode_locks).await
            }
            _ => {
                run_ffmpeg_animation_to_mp4(
                    input,
                    source_format,
                    attempt,
                    fixed_canvas,
                    transcode_locks,
                )
                .await
            }
        };
        match result {
            Ok(bytes) => return Ok(bytes),
            Err(err) => attempt_errors.push(err),
        }
    }

    tracing::error!(
        input = %input.display(),
        source_format = ?source_format,
        attempt_errors = %attempt_errors.join(" | "),
        "gif preview ffmpeg transcode failed after all attempts"
    );
    Err(AppError::Internal(anyhow::anyhow!(
        "ffmpeg gif preview transcode failed"
    )))
}

// Human: Probe a fixed output canvas size so ffmpeg keeps every GIF frame on the same grid.
// Agent: READS GIF logical screen from header bytes; RETURNS even dimensions when known.
async fn read_fixed_canvas_size(
    input: &Path,
    source_format: SniffedImageFormat,
) -> Option<(u32, u32)> {
    if source_format != SniffedImageFormat::Gif {
        return None;
    }
    let mut head = [0u8; 10];
    let mut file = tokio::fs::File::open(input).await.ok()?;
    let read_len = file.read(&mut head).await.ok()?;
    probe_gif_logical_screen(&head[..read_len])
}

// Human: Single ffmpeg invocation for GIF/WebP/PNG/JPEG → H.264 MP4 preview output.
// Agent: SPAWNS ffmpeg into protected temp dir; KILLS child on timeout; RETURNS mp4 bytes or Err.
async fn run_ffmpeg_animation_to_mp4(
    input: &Path,
    source_format: SniffedImageFormat,
    attempt: TranscodeAttempt,
    fixed_canvas: Option<(u32, u32)>,
    transcode_locks: &GifPreviewTranscodeLocks,
) -> Result<Vec<u8>, String> {
    let work_dir = create_ownly_temp_dir(GIF_PREVIEW_TEMP_PREFIX)
        .map_err(|e| format!("temp dir create: {e}"))?;
    transcode_locks
        .register_scratch_dir(work_dir.path())
        .await;
    let transcode_result = run_ffmpeg_animation_to_mp4_inner(
        input,
        source_format,
        attempt,
        fixed_canvas,
        &work_dir,
    )
    .await;
    transcode_locks
        .unregister_scratch_dir(work_dir.path())
        .await;
    transcode_result
}

async fn run_ffmpeg_animation_to_mp4_inner(
    input: &Path,
    source_format: SniffedImageFormat,
    attempt: TranscodeAttempt,
    fixed_canvas: Option<(u32, u32)>,
    work_dir: &TempDir,
) -> Result<Vec<u8>, String> {
    let output_path = work_dir.path().join("preview.mp4");

    let mut command = Command::new("ffmpeg");
    command
        .arg("-y")
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error");

    match attempt {
        TranscodeAttempt::WebpmuxFrames => {
            // Human: Handled by transcode_webp_via_webpmux before this ffmpeg helper runs.
        }
        TranscodeAttempt::Auto => {
            if source_format == SniffedImageFormat::Gif {
                // Human: `-ignore_loop` is GIF-only — WebKit/WebP inputs reject it (Option ignore_loop not found).
                // Agent: SETS -ignore_loop 0 before `-i` for animated GIF demux only.
                command.arg("-ignore_loop").arg("0");
            }
        }
        TranscodeAttempt::Demuxer(format) => {
            command.arg("-f").arg(format);
            if format == "gif" {
                command.arg("-ignore_loop").arg("0");
            }
        }
        TranscodeAttempt::WebpVariableFps => {
            // Human: Second-chance WebP path when default timing fails on animated uploads.
            // Agent: USES -vsync vfr after input; NO -ignore_loop (invalid for WebP).
        }
    }

    command.arg("-i").arg(input);

    if matches!(
        (source_format, attempt),
        (SniffedImageFormat::WebP, TranscodeAttempt::WebpVariableFps)
    ) {
        command.arg("-vsync").arg("vfr");
    }

    let video_filter = fixed_canvas
        .map(|size| preview_mp4_video_filter(Some(size)))
        .unwrap_or_else(|| FFMPEG_EVEN_SCALE_VF.to_string());

    command
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-vf",
            &video_filter,
        ])
        .arg(&output_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    let attempt_label = match attempt {
        TranscodeAttempt::WebpmuxFrames => "webpmux",
        TranscodeAttempt::Auto => "auto",
        TranscodeAttempt::Demuxer(name) => name,
        TranscodeAttempt::WebpVariableFps => "webp-vfr",
    };

    let mut stderr_lines = Vec::new();
    let status = tokio::select! {
        _ = tokio::time::sleep(GIF_PREVIEW_TRANSCODE_TIMEOUT) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            tracing::warn!(
                input = %input.display(),
                attempt = attempt_label,
                timeout_secs = GIF_PREVIEW_TRANSCODE_TIMEOUT.as_secs(),
                "gif preview ffmpeg timed out"
            );
            return Err(format!(
                "attempt={attempt_label} timed out after {} seconds",
                GIF_PREVIEW_TRANSCODE_TIMEOUT.as_secs()
            ));
        }
        exit = async {
            if let Some(stderr) = child.stderr.take() {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    let trimmed = line.trim_end().to_string();
                    if !trimmed.is_empty() {
                        stderr_lines.push(trimmed);
                        if stderr_lines.len() > 24 {
                            let drain = stderr_lines.len() - 24;
                            stderr_lines.drain(0..drain);
                        }
                    }
                    line.clear();
                }
            }
            child.wait().await
        } => exit.map_err(|e| format!("ffmpeg wait: {e}"))?,
    };

    if !status.success() {
        return Err(format!(
            "attempt={attempt_label} exit={:?} stderr={}",
            status.code(),
            stderr_lines.join("\n")
        ));
    }

    tokio::fs::read(&output_path)
        .await
        .map_err(|e| format!("read preview mp4: {e}"))
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

    #[test]
    fn sniff_image_format_detects_common_containers() {
        assert_eq!(sniff_image_format(b"GIF89a"), SniffedImageFormat::Gif);
        assert_eq!(
            sniff_image_format(b"GIF87a\x01"),
            SniffedImageFormat::Gif
        );
        assert_eq!(
            sniff_image_format(b"RIFF\x00\x00\x00\x00WEBP"),
            SniffedImageFormat::WebP
        );
        assert_eq!(
            sniff_image_format(b"\x89PNG\r\n\x1a\n"),
            SniffedImageFormat::Png
        );
        assert_eq!(sniff_image_format(b"\xFF\xD8\xFF"), SniffedImageFormat::Jpeg);
        assert_eq!(sniff_image_format(b"NOTAFILE"), SniffedImageFormat::Unknown);
    }

    #[test]
    fn transcode_attempts_for_webp_uses_webpmux_first() {
        let attempts = transcode_attempts(SniffedImageFormat::WebP);
        assert_eq!(attempts.len(), 3);
        assert!(matches!(attempts[0], TranscodeAttempt::WebpmuxFrames));
        assert!(matches!(attempts[1], TranscodeAttempt::Auto));
        assert!(matches!(attempts[2], TranscodeAttempt::WebpVariableFps));
    }

    #[test]
    fn qualifies_for_animated_preview_matches_gif_and_webp() {
        assert!(qualifies_for_animated_preview("image/gif"));
        assert!(qualifies_for_animated_preview("image/webp"));
        assert!(!qualifies_for_animated_preview("image/png"));
    }

    #[test]
    fn reconcile_upload_image_mime_fixes_webp_labeled_as_gif() {
        let webp_head = b"RIFF\x00\x00\x00\x00WEBP";
        assert_eq!(
            reconcile_upload_image_mime(webp_head, "image/gif"),
            "image/webp"
        );
    }

    #[test]
    fn parse_webpmux_canvas_size_reads_info_line() {
        let info = "Format: ANIM\nCanvas size: 481 x 271\nNumber of frames: 24\n";
        assert_eq!(parse_webpmux_canvas_size(info), Some((480, 270)));
    }

    #[test]
    fn parse_webpmux_frame_table_reads_offsets() {
        let info = "No.: width height alpha x_offset y_offset duration dispose blend\n\
             1: 200 200 yes 50 30 100 none yes\n";
        let frames = parse_webpmux_frame_table(info);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].x_offset, 50);
        assert_eq!(frames[0].y_offset, 30);
    }

    #[test]
    fn probe_gif_logical_screen_reads_header() {
        let head = *b"GIF89a\x40\x01\xE0\x00";
        assert_eq!(probe_gif_logical_screen(&head), Some((320, 224)));
    }

    #[test]
    fn preview_mp4_video_filter_uses_canvas_pad_for_webp() {
        let filter = preview_mp4_video_filter(Some((480, 270)));
        assert!(filter.contains("pad=480:270"));
        assert!(filter.contains("setsar=1"));
    }

    #[test]
    fn sidecar_meta_matches_source_requires_version_and_size() {
        assert!(sidecar_meta_matches_source(GIF_PREVIEW_META_VERSION, 1024, 1024));
        assert!(!sidecar_meta_matches_source(GIF_PREVIEW_META_VERSION - 1, 1024, 1024));
        assert!(!sidecar_meta_matches_source(GIF_PREVIEW_META_VERSION, 1024, 2048));
    }
}
