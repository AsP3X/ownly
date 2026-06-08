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
    hls::{
        key_store::{AesKey, KeyStore},
        playlist::{
            hls_segment_storage_aliases, hls_segment_target_secs,
            normalize_segment_rel_path_for_playback, parse_segment_manifest,
            synthetic_segment_rel_path, PlaylistGenerator, HLS_INIT_FILENAME,
            HLS_SEGMENT_EXTENSION,
        },
    },
    hls::export::export_cache_is_valid,
    jobs::{self, model::HlsExportPayload, JobKind},
    rate_limit,
    stream_ticket,
    storage::{Storage, StorageStream},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct TicketParams {
    pub ticket: Option<String>,
}

// Human: How long an HLS playback ticket remains valid for AVPlayer segment fetches without JWT.
// Agent: PASSED to stream_ticket::generate_ticket from get_stream_url; MUST match ticket validation on /hls/* routes.
const HLS_PLAYBACK_TICKET_TTL_SECS: u64 = 4 * 3600;

// Human: Row shape for HLS playback lookups — storage key, readiness, segment count, source size.
// Agent: READ by ensure_file_owned; size_bytes drives synthetic playlist segment duration tier.
pub(crate) type HlsPlaybackRow = (String, Option<bool>, Option<i32>, Option<i64>);

async fn ensure_file_owned(
    state: &AppState,
    file_id: &str,
    user_id: &str,
) -> Result<(String, Option<bool>, Option<i32>, Option<i64>), AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        user_id,
        file_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let row: Option<HlsPlaybackRow> = sqlx::query_as(
        "SELECT storage_key, hls_ready, segment_count, size_bytes FROM files \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .fetch_optional(&state.pool)
    .await?;

    row.ok_or(AppError::NotFound)
}

// Human: HLS playback row lookup by file id only — used for ticket-gated public HLS routes.
// Agent: READS files without user_id; NOT FOUND when id missing; ticket still binds user in HMAC.
async fn ensure_file_playback(
    state: &AppState,
    file_id: &str,
) -> Result<HlsPlaybackRow, AppError> {
    let row: Option<HlsPlaybackRow> = sqlx::query_as(
        "SELECT storage_key, hls_ready, segment_count, size_bytes FROM files WHERE id = $1",
    )
    .bind(file_id)
    .fetch_optional(&state.pool)
    .await?;

    row.ok_or(AppError::NotFound)
}

// Human: Require a valid stream ticket on public HLS sub-resource requests.
// Agent: READS TicketParams.ticket; CALLS stream_ticket::validate_ticket; RETURNS Unauthorized when missing/invalid.
fn require_hls_ticket(
    params: &TicketParams,
    file_id: &str,
    secret: &str,
) -> Result<(), AppError> {
    let ticket = params.ticket.as_deref().ok_or(AppError::Unauthorized)?;
    stream_ticket::validate_ticket(ticket, file_id, secret)
}

// Human: Percent-encode a query value so dotted HMAC tickets are safe in playlist URIs.
// Agent: USED when building manifest URL and when appending ticket= to each playlist line.
pub(crate) fn encode_query_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// Human: Append the same playback ticket to every absolute URI in an HLS manifest.
// Agent: REWRITES path lines and URI="..." attributes; SKIPS lines that already contain ticket=.
pub(crate) fn append_ticket_to_playlist(playlist: &str, ticket: &str) -> String {
    let encoded = encode_query_component(ticket);
    playlist
        .lines()
        .map(|line| append_ticket_to_playlist_line(line, &encoded))
        .collect::<Vec<_>>()
        .join("\n")
}

fn append_ticket_to_playlist_line(line: &str, encoded_ticket: &str) -> String {
    if let Some(uri_start) = line.find("URI=\"") {
        let quote_start = uri_start + 5;
        let rest = &line[quote_start..];
        let Some(end_rel) = rest.find('"') else {
            return line.to_string();
        };
        let uri = &rest[..end_rel];
        if uri.contains("ticket=") {
            return line.to_string();
        }
        let sep = if uri.contains('?') { '&' } else { '?' };
        let new_uri = format!("{uri}{sep}ticket={encoded_ticket}");
        return format!(
            "{}{}{}",
            &line[..quote_start],
            new_uri,
            &line[quote_start + end_rel..]
        );
    }

    let trimmed = line.trim();
    if trimmed.starts_with('/') && !trimmed.starts_with('#') {
        if trimmed.contains("ticket=") {
            return line.to_string();
        }
        let sep = if trimmed.contains('?') { '&' } else { '?' };
        return format!("{trimmed}{sep}ticket={encoded_ticket}");
    }

    line.to_string()
}

// Human: Load ffmpeg's stored stream.m3u8 and rewrite segment/key URIs for API playback.
// Agent: READS {storage_key}/stream.m3u8; FALLBACK synthesizes playlist when object missing.
pub(crate) async fn build_playlist_for_playback(
    storage: &dyn Storage,
    storage_key: &str,
    base_url: &str,
    key_uri: &str,
    init_uri: &str,
    segment_count: usize,
    source_size_bytes: u64,
) -> Result<String, AppError> {
    let segment_target_secs = hls_segment_target_secs(source_size_bytes);
    let fmp4_on_storage = storage_hls_uses_fmp4(storage, storage_key).await;
    let playlist_key = format!("{storage_key}/stream.m3u8");
    if let Ok(content) = read_storage_text(storage, &playlist_key).await {
        let fmp4 = fmp4_on_storage || crate::hls::playlist::playlist_uses_fmp4(&content);
        let prefer_fmp4 = fmp4;
        if let Ok(playlist) = PlaylistGenerator::rewrite_stored_playlist(
            &content,
            base_url,
            key_uri,
            init_uri,
            prefer_fmp4,
        ) {
            return Ok(playlist);
        }
        if let Ok((files, durations)) = parse_segment_manifest(&content) {
            if !files.is_empty() && files.len() == durations.len() {
                let segment_files: Vec<String> = files
                    .iter()
                    .map(|path| normalize_segment_rel_path_for_playback(path, prefer_fmp4))
                    .collect();
                return Ok(PlaylistGenerator::generate(
                    base_url,
                    &segment_files,
                    &durations,
                    key_uri,
                    init_uri,
                    fmp4,
                ));
            }
        }
        tracing::warn!(
            storage_key,
            "stored HLS playlist could not be rewritten; using synthetic fallback"
        );
    }

    let fmp4 = fmp4_on_storage;
    // Human: DB segment_count can be 0 while storage still has a valid ffmpeg manifest.
    // Agent: RE-PARSE stored playlist before emitting an empty synthetic manifest.
    let effective_segment_count = if segment_count == 0 {
        if let Ok(content) = read_storage_text(storage, &playlist_key).await {
            parse_segment_manifest(&content)
                .ok()
                .map(|(files, durations)| {
                    if !files.is_empty() && files.len() == durations.len() {
                        files.len()
                    } else {
                        0
                    }
                })
                .unwrap_or(0)
        } else {
            0
        }
    } else {
        segment_count
    };

    let mut segment_files = Vec::new();
    let mut segment_durations = Vec::new();
    for i in 0..effective_segment_count {
        segment_files.push(synthetic_segment_rel_path(i, fmp4));
        segment_durations.push(segment_target_secs);
    }

    Ok(PlaylistGenerator::generate(
        base_url,
        &segment_files,
        &segment_durations,
        key_uri,
        init_uri,
        fmp4,
    ))
}

// Human: Detect fMP4 HLS bundles in storage — init.mp4 or at least one `.m4s` segment.
// Agent: USED before rewriting legacy `.ts` playlists; AVOIDS false TS synthetic manifests.
pub(crate) async fn storage_hls_uses_fmp4(storage: &dyn Storage, storage_key: &str) -> bool {
    let init_key = format!("{storage_key}/{HLS_INIT_FILENAME}");
    if storage.exists(&init_key).await.unwrap_or(false) {
        return true;
    }
    let first_m4s = format!("{storage_key}/segments/0000.{HLS_SEGMENT_EXTENSION}");
    storage.exists(&first_m4s).await.unwrap_or(false)
}

// Human: Open an encrypted HLS media segment, trying `.ts` / `.m4s` aliases when needed.
// Agent: READS `{storage_key}/segments/*`; RETURNS resolved basename for Content-Type.
pub(crate) async fn open_hls_segment(
    storage: &dyn Storage,
    storage_key: &str,
    segment_name: &str,
) -> Result<(StorageStream, u64, String), AppError> {
    for name in hls_segment_storage_aliases(segment_name) {
        let key = format!("{storage_key}/segments/{name}");
        match storage.get_stream(&key).await {
            Ok((stream, size, _)) => return Ok((stream, size, name)),
            Err(_) => continue,
        }
    }
    Err(AppError::NotFound)
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

// Human: Read a small binary object from storage (AES key, segment blob header).
// Agent: READS full stream into Vec; USED by resolve_hls_aes_key before key_store fallback.
async fn read_storage_bytes(storage: &dyn Storage, key: &str) -> Result<Vec<u8>, AppError> {
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
    Ok(out)
}

// Human: Resolve the 16-byte AES-128 key used to encrypt uploaded HLS segments.
// Agent: PREFERS {storage_key}/key.bin from encode upload; FALLBACK key_store DB decrypt.
pub(crate) async fn resolve_hls_aes_key(
    storage: &dyn Storage,
    key_store: &KeyStore,
    storage_key: &str,
    file_id: &str,
) -> Result<AesKey, AppError> {
    let object_key = format!("{storage_key}/key.bin");
    if let Ok(bytes) = read_storage_bytes(storage, &object_key).await {
        if bytes.len() == 16 {
            let mut key = [0u8; 16];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        tracing::warn!(
            %file_id,
            len = bytes.len(),
            "stored key.bin has unexpected length; falling back to key_store"
        );
    }

    key_store
        .get_key(file_id)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?
        .ok_or(AppError::NotFound)
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
        let ticket = stream_ticket::generate_ticket(
            &id,
            &claims.sub,
            &state.signing_secret,
            HLS_PLAYBACK_TICKET_TTL_SECS,
        );
        let encoded = encode_query_component(&ticket);
        let playlist_url = format!("/api/v1/files/{id}/hls/manifest.m3u8?ticket={encoded}");
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
    let (storage_key, hls_ready, segment_count, size_bytes) =
        ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "video is not ready for HLS playback yet".into(),
        ));
    }

    let base_url = format!("/api/v1/files/{id}");
    let key_uri = format!("/api/v1/files/{id}/key");
    let init_uri = format!("/api/v1/files/{id}/init");

    let count = segment_count.unwrap_or(0) as usize;
    let source_size = size_bytes.unwrap_or(0).max(0) as u64;
    let playlist = build_playlist_for_playback(
        state.storage.as_ref(),
        &storage_key,
        &base_url,
        &key_uri,
        &init_uri,
        count,
        source_size,
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
    let (storage_key, _, _, _) =
        ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

    let key = resolve_hls_aes_key(
        state.storage.as_ref(),
        &state.hls_key_store,
        &storage_key,
        &id,
    )
    .await?;

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
    let (storage_key, hls_ready, _, _) =
        ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

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

    let (stream, size, resolved_name) =
        open_hls_segment(state.storage.as_ref(), &storage_key, &segment_name).await?;

    Ok(segment_media_response(stream, size, &resolved_name))
}

// Human: AES-128 fMP4 init segment (EXT-X-MAP) for owned video playback.
// Agent: READS {storage_key}/init.mp4; RATE LIMITS like media segments.
pub async fn get_init(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (storage_key, hls_ready, _, _) =
        ensure_file_owned(state.as_ref(), &id, &claims.sub).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::NotFound);
    }

    let rl_key = format!("{}:{}", claims.sub, id);
    rate_limit::enforce(&state.hls_segment_rl, &rl_key)?;

    let key = format!("{storage_key}/{HLS_INIT_FILENAME}");
    let (stream, size, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|_| AppError::NotFound)?;

    Ok(segment_media_response(stream, size, HLS_INIT_FILENAME))
}

// Human: Ticket-gated HLS master manifest for native AVPlayer HTTP playback (no JWT on segments).
// Agent: validate_ticket; BUILD playlist under /hls/*; APPEND ticket= to every sub-resource URI.
pub async fn get_hls_manifest(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<TicketParams>,
) -> Result<Response, AppError> {
    require_hls_ticket(&params, &id, &state.signing_secret)?;
    let ticket = params.ticket.as_deref().expect("ticket checked");

    let (storage_key, hls_ready, segment_count, size_bytes) =
        ensure_file_playback(state.as_ref(), &id).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::NotFound);
    }

    let encoded = encode_query_component(ticket);
    let base_url = format!("/api/v1/files/{id}/hls");
    let key_uri = format!("/api/v1/files/{id}/hls/key?ticket={encoded}");
    let init_uri = format!("/api/v1/files/{id}/hls/init?ticket={encoded}");

    let count = segment_count.unwrap_or(0) as usize;
    let source_size = size_bytes.unwrap_or(0).max(0) as u64;
    let playlist = build_playlist_for_playback(
        state.storage.as_ref(),
        &storage_key,
        &base_url,
        &key_uri,
        &init_uri,
        count,
        source_size,
    )
    .await?;
    let playlist = append_ticket_to_playlist(&playlist, ticket);

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

// Human: Ticket-gated AES-128 key for HLS playback without Authorization header.
// Agent: validate_ticket; READS key.bin or key_store; SAME bytes as authenticated get_key.
pub async fn get_hls_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<TicketParams>,
) -> Result<Response, AppError> {
    require_hls_ticket(&params, &id, &state.signing_secret)?;

    let (storage_key, _, _, _) = ensure_file_playback(state.as_ref(), &id).await?;

    let key = resolve_hls_aes_key(
        state.storage.as_ref(),
        &state.hls_key_store,
        &storage_key,
        &id,
    )
    .await?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
        ],
        key.to_vec(),
    )
        .into_response())
}

// Human: Ticket-gated fMP4 init segment for EXT-X-MAP without JWT.
// Agent: validate_ticket; RATE LIMITS per file id; STREAMS {storage_key}/init.mp4.
pub async fn get_hls_init(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<TicketParams>,
) -> Result<Response, AppError> {
    require_hls_ticket(&params, &id, &state.signing_secret)?;

    let (storage_key, hls_ready, _, _) = ensure_file_playback(state.as_ref(), &id).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::NotFound);
    }

    let rl_key = format!("ticket:{id}");
    rate_limit::enforce(&state.hls_segment_rl, &rl_key)?;

    let key = format!("{storage_key}/{HLS_INIT_FILENAME}");
    let (stream, size, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|_| AppError::NotFound)?;

    Ok(segment_media_response(stream, size, HLS_INIT_FILENAME))
}

// Human: Ticket-gated encrypted media segment proxy for AVPlayer.
// Agent: validate_ticket; OPEN segment aliases; RATE LIMITS ticket:{file_id}.
pub async fn get_hls_segment(
    State(state): State<Arc<AppState>>,
    Path((id, segment_name)): Path<(String, String)>,
    Query(params): Query<TicketParams>,
) -> Result<Response, AppError> {
    require_hls_ticket(&params, &id, &state.signing_secret)?;

    let (storage_key, hls_ready, _, _) = ensure_file_playback(state.as_ref(), &id).await?;

    if !hls_ready.unwrap_or(false) {
        return Err(AppError::NotFound);
    }

    let rl_key = format!("ticket:{id}");
    rate_limit::enforce(&state.hls_segment_rl, &rl_key)?;

    if !segment_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.')
    {
        return Err(AppError::BadRequest("invalid segment name".into()));
    }

    let (stream, size, resolved_name) =
        open_hls_segment(state.storage.as_ref(), &storage_key, &segment_name).await?;

    Ok(segment_media_response(stream, size, &resolved_name))
}

// Human: HLS media segment/init response with Content-Length and type by filename.
// Agent: SETS video/mp4 for .m4s/.mp4 and video/mp2t for legacy .ts; no-store on all.
pub(crate) fn segment_media_response(
    stream: StorageStream,
    size: u64,
    object_name: &str,
) -> Response {
    let content_type = hls_segment_content_type(object_name);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().expect("octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        "no-store, no-cache, must-revalidate"
            .parse()
            .expect("cache control"),
    );
    if size > 0 {
        if let Ok(value) = size.to_string().parse() {
            headers.insert(header::CONTENT_LENGTH, value);
        }
    }

    (headers, Body::from_stream(stream)).into_response()
}

// Human: Pick Content-Type for proxied HLS objects (.m4s init/media vs legacy MPEG-TS).
// Agent: USED by get_segment, get_init, and public share segment proxy.
pub(crate) fn hls_segment_content_type(object_name: &str) -> &'static str {
    if object_name.ends_with(".ts") {
        "video/mp2t"
    } else if object_name.ends_with(".m4s") || object_name.ends_with(".mp4") {
        "video/mp4"
    } else {
        "application/octet-stream"
    }
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

    if export_cache_is_valid(export_ready, export_size) {
        return Ok(Json(export_status_json(
            true,
            Some("ready"),
            100,
            export_size,
            None,
        )));
    }

    // Human: Stale tiny exports (legacy bug) must not block re-export on web/iOS download.
    // Agent: WHEN ready flag set but size invalid, fall through and enqueue a fresh HlsExport job.
    if export_ready {
        tracing::warn!(
            file_id = %id,
            export_size_bytes = ?export_size,
            "invalid cached video export — re-queueing remux"
        );
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

    let ready = export_cache_is_valid(export_ready, export_size);
    Ok(Json(export_status_json(
        ready,
        if ready {
            Some("ready")
        } else {
            export_status.as_deref()
        },
        export_progress,
        export_size,
        export_error,
    )))
}

#[cfg(test)]
mod tests {
    use super::{
        append_ticket_to_playlist, encode_query_component, hls_segment_content_type,
    };

    #[test]
    fn hls_segment_content_type_by_extension() {
        assert_eq!(hls_segment_content_type("0000.ts"), "video/mp2t");
        assert_eq!(hls_segment_content_type("0000.m4s"), "video/mp4");
        assert_eq!(hls_segment_content_type("init.mp4"), "video/mp4");
    }

    #[test]
    fn append_ticket_to_playlist_paths_and_uri_attrs() {
        let ticket = "file.user.9999.deadbeef";
        let input = concat!(
            "#EXTM3U\n",
            "#EXT-X-KEY:METHOD=AES-128,URI=\"/api/v1/files/f/key\"\n",
            "/api/v1/files/f/hls/segments/0000.m4s\n",
        );
        let out = append_ticket_to_playlist(input, ticket);
        assert!(out.contains("/api/v1/files/f/key?ticket="));
        assert!(out.contains("/api/v1/files/f/hls/segments/0000.m4s?ticket="));
        assert!(!out.contains("ticket=ticket="));
    }

    #[test]
    fn encode_query_component_leaves_ticket_dots() {
        let ticket = "a.b.c.d";
        assert_eq!(encode_query_component(ticket), ticket);
    }
}
