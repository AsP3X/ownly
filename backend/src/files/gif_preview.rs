// Human: iOS WebKit GIF workaround — cache a looping H.264 MP4 sidecar for ticket-gated preview streams.
// Agent: READS GIF from storage; SPAWNS ffmpeg; WRITES {storage_key}/.ownly-gif-preview.mp4; STREAMS mp4.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use tokio::sync::Mutex;
use futures_util::StreamExt;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
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

/// Human: Sidecar metadata recording source byte length when the MP4 was generated.
/// Agent: COMPARED on read; INVALIDATES stale previews when size_bytes changes.
pub const GIF_PREVIEW_META_SUFFIX: &str = ".ownly-gif-preview.meta";

/// Human: Cap webpmux frame extraction so huge animated WebP uploads cannot OOM the API.
/// Agent: REJECTS transcode when webpmux reports more frames than this limit.
const MAX_WEBP_EXTRACT_FRAMES: u32 = 480;

// Human: Per-storage-key mutex so concurrent first opens share one ffmpeg transcode.
// Agent: WRITES HashMap of Arc<Mutex<()>>; CALLED from open_gif_preview_stream.
pub struct GifPreviewTranscodeLocks {
    inner: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl GifPreviewTranscodeLocks {
    // Human: Construct an empty lock registry for AppState.
    // Agent: CALLED once at startup in build_app_state.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
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
    if !qualifies_for_animated_preview(&mime_type) {
        return Err(AppError::BadRequest(
            "animated preview is only available for GIF and animated WebP images".into(),
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

    let (stream, mp4_size) = open_gif_preview_stream(
        &state,
        &storage_key,
        size_bytes.max(0) as u64,
    )
    .await?;
    let headers = preview_mp4_headers(mp4_size)?;

    if method == Method::HEAD {
        return Ok((StatusCode::OK, headers).into_response());
    }

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
        // Human: Legacy sidecars written before meta tracking — treat as usable.
        // Agent: SKIPS invalidation when meta object is absent.
        return Ok(true);
    }

    let stored_size = read_sidecar_source_size(storage, &meta_key).await?;
    if stored_size == source_size_bytes {
        return Ok(true);
    }

    let _ = storage.delete(&preview_key).await;
    let _ = storage.delete(&meta_key).await;
    Ok(false)
}

// Human: Parse the ASCII u64 stored in `.ownly-gif-preview.meta`.
// Agent: READS small object from storage; RETURNS 0 when unreadable.
async fn read_sidecar_source_size(
    storage: &Arc<dyn Storage>,
    meta_key: &str,
) -> Result<u64, AppError> {
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
    Ok(text.trim().parse().unwrap_or(0))
}

// Human: Download GIF bytes, transcode with ffmpeg, upload MP4 sidecar to object storage.
// Agent: WRITES temp files; SPAWNS ffmpeg; PUT preview object; READ-ONLY after cache warm.
async fn generate_and_store_gif_preview(
    storage: Arc<dyn Storage>,
    gif_storage_key: &str,
    preview_key: &str,
    source_size_bytes: u64,
) -> Result<(), AppError> {
    let (gif_dir, source_path, source_format) =
        download_storage_object_to_temp(storage.clone(), gif_storage_key).await?;
    let mp4_bytes = transcode_animation_to_mp4(&source_path, source_format).await?;
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
            source_size_bytes.to_string().into_bytes(),
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
) -> Result<(TempDir, PathBuf, SniffedImageFormat), AppError> {
    let work_dir = TempDir::new()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("temp dir create: {e}")))?;
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

// Human: Animated WebP → PNG sequence via webpmux/dwebp, then ffmpeg H.264 MP4.
// Agent: SPAWNS webpmux per frame; CALLS ffmpeg on frame_%04d.png; RETURNS mp4 bytes.
async fn transcode_webp_via_webpmux(input: &Path) -> Result<Vec<u8>, String> {
    let work_dir = TempDir::new().map_err(|e| format!("temp dir create: {e}"))?;
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
    if frame_count > MAX_WEBP_EXTRACT_FRAMES {
        return Err(format!(
            "webp animation exceeds {MAX_WEBP_EXTRACT_FRAMES} frames ({frame_count})"
        ));
    }

    for frame_index in 1..=frame_count {
        let frame_webp = frames_dir.join(format!("frame_{frame_index}.webp"));
        let frame_png = frames_dir.join(format!("frame_{frame_index:04}.png"));
        let input_str = input
            .to_str()
            .ok_or_else(|| "webp input path invalid".to_string())?;
        let webp_out = frame_webp
            .to_str()
            .ok_or_else(|| "webp frame path invalid".to_string())?;
        let png_out = frame_png
            .to_str()
            .ok_or_else(|| "png frame path invalid".to_string())?;

        let mux_status = Command::new("webpmux")
            .args([
                "-get",
                "frame",
                &frame_index.to_string(),
                input_str,
                "-o",
                webp_out,
            ])
            .status()
            .await
            .map_err(|e| format!("webpmux get frame {frame_index}: {e}"))?;
        if !mux_status.success() {
            return Err(format!("webpmux get frame {frame_index} failed"));
        }

        let dwebp_status = Command::new("dwebp")
            .args([webp_out, "-o", png_out])
            .status()
            .await
            .map_err(|e| format!("dwebp frame {frame_index}: {e}"))?;
        if !dwebp_status.success() {
            return Err(format!("dwebp frame {frame_index} failed"));
        }
    }

    let output_path = work_dir.path().join("preview.mp4");
    let input_pattern = frames_dir.join("frame_%04d.png");
    let pattern_str = input_pattern
        .to_str()
        .ok_or_else(|| "png pattern path invalid".to_string())?;
    let output_str = output_path
        .to_str()
        .ok_or_else(|| "mp4 output path invalid".to_string())?;

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
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
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
) -> Result<Vec<u8>, AppError> {
    let mut attempt_errors = Vec::new();

    for attempt in transcode_attempts(source_format) {
        let result = match attempt {
            TranscodeAttempt::WebpmuxFrames => transcode_webp_via_webpmux(input).await,
            _ => run_ffmpeg_animation_to_mp4(input, source_format, attempt).await,
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

// Human: Single ffmpeg invocation for GIF/WebP/PNG/JPEG → H.264 MP4 preview output.
// Agent: SPAWNS ffmpeg into temp dir; RETURNS Err message tail when exit code is non-zero.
async fn run_ffmpeg_animation_to_mp4(
    input: &Path,
    source_format: SniffedImageFormat,
    attempt: TranscodeAttempt,
) -> Result<Vec<u8>, String> {
    let work_dir = TempDir::new().map_err(|e| format!("temp dir create: {e}"))?;
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
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ])
        .arg(&output_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    let mut stderr_lines = Vec::new();
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

    let status = child.wait().await.map_err(|e| format!("ffmpeg wait: {e}"))?;
    if !status.success() {
        let attempt_label = match attempt {
            TranscodeAttempt::WebpmuxFrames => "webpmux",
            TranscodeAttempt::Auto => "auto",
            TranscodeAttempt::Demuxer(name) => name,
            TranscodeAttempt::WebpVariableFps => "webp-vfr",
        };
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
    fn gif_preview_meta_object_key_appends_suffix() {
        assert_eq!(
            gif_preview_meta_object_key("users/u1/files/f1"),
            "users/u1/files/f1/.ownly-gif-preview.meta"
        );
    }
}
