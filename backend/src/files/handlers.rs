// Human: User file library — list, upload, download, delete media stored in Nebular OS.
// Agent: READS/WRITES files + folders tables; CALLS Storage trait; REQUIRES auth Claims.

use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    extract::rejection::JsonRejection,
    http::{header, HeaderMap},
    response::{Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        file_copy::{copy_storage_artifacts, unique_name_in_folder, CopyFileSourceRow},
        file_delete::{delete_owned_file_row, purge_file_storage},
        folders::ensure_folder_owned,
        listing::{self, ListFilesParams},
        processing::ensure_file_not_processing,
        recycle_bin::{self, DeleteQuery, ACTIVE_FILES_SQL},
        upload_validation::{self, normalize_upload_filename, normalize_upload_size_bytes},
    },
    hls::export::export_cache_is_valid,
    jobs::{
        self,
        model::{AudioWaveformPayload, HlsEncodePayload, ImageThumbnailPayload, VideoThumbnailPayload},
        JobKind,
    },
    rate_limit,
    request_tracking,
    AppState,
};

// Human: Shared column list for file rows including HLS transcode metadata.
// Agent: USED in SELECT/RETURNING for list, get, upload, and move handlers.
pub(crate) const FILE_COLUMNS: &str = "id, name, mime_type, size_bytes, folder_id, created_at, updated_at, \
    hls_ready, hls_encode_status, hls_encode_error, conversion_progress, duration_seconds, \
    audio_waveform_ready, audio_encode_status, audio_encode_error, \
    video_thumbnail_ready, video_thumbnail_status, video_thumbnail_error, video_thumbnail_progress, \
    video_thumbnail_selected_index, \
    image_thumbnail_ready, image_thumbnail_status, image_thumbnail_error";

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

type DownloadFileRow = (
    String,
    String,
    Option<String>,
    bool,
    bool,
    Option<String>,
    Option<i64>,
    bool,
    Option<String>,
);
type DownloadUrlRow = (
    String,
    Option<String>,
    bool,
    bool,
    Option<String>,
    Option<i64>,
    bool,
    Option<String>,
);
type MoveFileCurrentRow = (
    Option<String>,
    String,
    Option<String>,
    bool,
    Option<String>,
    bool,
    Option<String>,
);

// Human: True when the vault keeps an HLS bundle (no standalone original blob).
// Agent: USED by download/export handlers to branch away from raw storage_key GET.
fn is_hls_stored_video(mime_type: &Option<String>, hls_ready: bool) -> bool {
    mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
        && hls_ready
}

// Human: Download filename for remuxed exports — preserve stem, force .mp4 extension.
fn mp4_download_name(name: &str) -> String {
    if name.to_lowercase().ends_with(".mp4") {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, _)) => format!("{stem}.mp4"),
        None => format!("{name}.mp4"),
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FileDto {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub hls_ready: bool,
    pub hls_encode_status: Option<String>,
    pub hls_encode_error: Option<String>,
    pub conversion_progress: i32,
    pub duration_seconds: Option<i32>,
    pub audio_waveform_ready: bool,
    pub audio_encode_status: Option<String>,
    pub audio_encode_error: Option<String>,
    pub video_thumbnail_ready: bool,
    pub video_thumbnail_status: Option<String>,
    pub video_thumbnail_error: Option<String>,
    pub video_thumbnail_progress: i32,
    pub video_thumbnail_selected_index: i32,
    pub image_thumbnail_ready: bool,
    pub image_thumbnail_status: Option<String>,
    pub image_thumbnail_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileListResponse {
    pub files: Vec<listing::FileListItem>,
    pub total_bytes: i64,
    pub file_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub folder_id: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    /// When `"minimal"`, omit heavy HLS detail fields from each row.
    pub fields: Option<String>,
    /// Matches frontend type filter buckets: documents, images, video, etc.
    pub type_filter: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BatchFilesRequest {
    pub ids: Vec<String>,
    /// When `"minimal"`, omit heavy HLS detail fields from each row.
    pub fields: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BatchFilesResponse {
    pub files: Vec<listing::FileListItem>,
}

#[derive(Debug, Deserialize)]
pub struct UploadCheckCandidateInput {
    pub name: String,
    #[serde(alias = "sizeBytes", deserialize_with = "upload_validation::deserialize_upload_size_bytes")]
    pub size_bytes: i64,
    #[serde(alias = "contentHash")]
    pub content_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckUploadNamesRequest {
    pub files: Vec<UploadCheckCandidateInput>,
}

#[derive(Debug, Serialize)]
pub struct CheckUploadNamesResponse {
    pub duplicates: Vec<listing::UploadNameDuplicate>,
    pub recycle_matches: Vec<listing::UploadRecycleMatch>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub file: FileDto,
}

#[derive(Debug, Serialize)]
pub struct DownloadUrlResponse {
    pub url: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct MoveFileRequest {
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CopyFileRequest {
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MoveFileResponse {
    pub file: FileDto,
}

#[derive(Debug, Serialize)]
pub struct CopyFileResponse {
    pub file: FileDto,
}

// Human: List the current user's files with optional folder filter and name search.
// Agent: READS files WHERE user_id; SUM size_bytes; ORDER BY name.
// Human: Paginated file listing for one folder, search, or root with optional type filter.
// Agent: READS listing::list_owned_files; RETURNS has_more + share_public per row.
pub async fn list_files(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListQuery>,
) -> Result<Json<FileListResponse>, AppError> {
    let (limit, offset) = listing::normalize_page(query.limit, query.offset);
    let minimal = query.fields.as_deref() == Some("minimal");
    let type_filter = query
        .type_filter
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "all")
        .map(str::to_string);

    let response = listing::list_owned_files(
        &state.pool,
        &claims.sub,
        ListFilesParams {
            folder_id: query.folder_id,
            search: query.q,
            limit,
            offset,
            minimal,
            type_filter,
        },
    )
    .await?;

    Ok(Json(FileListResponse {
        files: response.files,
        total_bytes: response.total_bytes,
        file_count: response.file_count,
        has_more: response.has_more,
    }))
}

// Human: Resolve a bounded set of owned files by id for Home recent/favourites.
// Agent: POST body ids[]; READS listing::batch_owned_files; AUDIT exempt (read-only batch get).
pub async fn batch_files(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<BatchFilesRequest>,
) -> Result<Json<BatchFilesResponse>, AppError> {
    let minimal = body.fields.as_deref() == Some("minimal");
    let files = listing::batch_owned_files(&state.pool, &claims.sub, body.ids, minimal).await?;
    Ok(Json(BatchFilesResponse { files }))
}

// Human: Detect active-library duplicates and exact recycle-bin matches before uploading bytes.
// Agent: POST files[]; VALIDATES filenames + content hashes; READS listing checks globally; AUDIT exempt (read-only preflight).
pub async fn check_upload_names(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    body: Result<Json<CheckUploadNamesRequest>, JsonRejection>,
) -> Result<Json<CheckUploadNamesResponse>, AppError> {
    let Json(body) = body.map_err(|rejection| {
        AppError::BadRequest(format!(
            "invalid upload check request: {}",
            rejection.body_text()
        ))
    })?;

    if body.files.is_empty() {
        return Err(AppError::BadRequest(
            "at least one file is required".into(),
        ));
    }

    let mut candidates = Vec::with_capacity(body.files.len());
    for (index, file) in body.files.into_iter().enumerate() {
        let name = normalize_upload_filename(&file.name).map_err(|error| match error {
            AppError::Validation(message, fields) => AppError::validation(
                message,
                serde_json::json!({
                    "files": {
                        index.to_string(): fields,
                    }
                }),
            ),
            other => other,
        })?;
        let size_bytes = normalize_upload_size_bytes(file.size_bytes).map_err(|error| match error {
            AppError::Validation(message, fields) => AppError::validation(
                message,
                serde_json::json!({
                    "files": {
                        index.to_string(): fields,
                    }
                }),
            ),
            other => other,
        })?;
        let content_hash =
            upload_validation::normalize_content_hash(&file.content_hash).map_err(|error| match error {
                AppError::Validation(message, fields) => AppError::validation(
                    message,
                    serde_json::json!({
                        "files": {
                            index.to_string(): fields,
                        }
                    }),
                ),
                other => other,
            })?;
        candidates.push(listing::UploadCheckCandidate {
            name,
            size_bytes: size_bytes as i64,
            content_hash,
        });
    }

    let normalized = listing::normalize_upload_check_candidates(candidates);
    if normalized.is_empty() {
        return Err(AppError::BadRequest(
            "at least one valid upload candidate is required".into(),
        ));
    }

    let duplicates =
        listing::check_upload_content_hash_duplicates(&state.pool, &claims.sub, &normalized).await?;
    let recycle_matches =
        listing::check_upload_recycle_matches(&state.pool, &claims.sub, &normalized).await?;
    Ok(Json(CheckUploadNamesResponse {
        duplicates,
        recycle_matches,
    }))
}

// Human: Fetch one file row for preview polling and detail views.
// Agent: READS files WHERE id + user_id; RETURNS FileDto with HLS fields.
pub async fn get_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let file: Option<FileDto> = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files \
         WHERE id = $1 AND user_id = $2 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let file = file.ok_or(AppError::NotFound)?;
    Ok(Json(serde_json::json!({ "file": file })))
}

// Human: Discard an entire multipart body without storing it — used when rejecting before upload work.
// Agent: READS every field to EOF; IGNORES parse errors so the HTTP connection can close cleanly.
async fn drain_multipart(multipart: &mut Multipart) {
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let _ = field.bytes().await;
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

// Human: Uploaded bytes spooled under a per-file temp work directory before storage PUT or HLS ingest.
// Agent: is_video=true skips Nebular PUT for source; false reads spool for object storage upload.
enum ReceivedUploadBody {
    DiskSpool {
        work_dir: PathBuf,
        tmp_path: PathBuf,
        size_bytes: u64,
        is_video: bool,
    },
}

// Human: Guard against deleting the OS temp root when removing upload scratch directories.
fn is_deletable_upload_work_dir(path: &std::path::Path) -> bool {
    let temp_root = std::env::temp_dir();
    path.starts_with(&temp_root) && path != temp_root.as_path()
}

// Human: Remove an ownly_upload_* directory after a non-media blob is persisted to Nebular.
async fn cleanup_upload_work_dir(work_dir: &std::path::Path) {
    if is_deletable_upload_work_dir(work_dir) {
        let _ = tokio::fs::remove_dir_all(work_dir).await;
    }
}

// Human: Read a spooled upload file and PUT it to object storage with transient-error retries.
// Agent: CALLS put_with_retry; RE-READS spool each attempt; ERRORS on disk read or Nebular failure.
async fn storage_put_spooled_file(
    storage: &Arc<dyn crate::storage::Storage>,
    storage_key: &str,
    mime: &str,
    tmp_path: &std::path::Path,
) -> Result<(), AppError> {
    let path = tmp_path.to_path_buf();
    let mime = mime.to_string();
    let key = storage_key.to_string();
    crate::storage::put_with_retry(storage.as_ref(), &key, &mime, || {
        let path = path.clone();
        async move {
            tokio::fs::read(&path)
                .await
                .map_err(|error| anyhow::anyhow!("read upload spool: {error}"))
        }
    })
    .await
    .map_err(|error| AppError::Storage(error.to_string()))
}

// Human: Stream one multipart file field to disk with a rolling size cap check.
// Agent: WRITES chunks via AsyncWriteExt; RETURNS total bytes; ERRORS when max_bytes exceeded.
async fn stream_multipart_field_to_path(
    mut field: axum::extract::multipart::Field<'_>,
    dest: &std::path::Path,
    max_bytes: u64,
) -> Result<u64, AppError> {
    let mut file = tokio::fs::File::create(dest).await.map_err(|error| {
        AppError::Internal(anyhow::anyhow!("create upload temp file: {error}"))
    })?;
    let mut size_bytes: u64 = 0;

    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|error| AppError::BadRequest(error.to_string()))?
    {
        size_bytes += chunk.len() as u64;
        if size_bytes > max_bytes {
            return Err(AppError::BadRequest(
                "file exceeds maximum upload size".into(),
            ));
        }
        file.write_all(&chunk).await.map_err(|error| {
            AppError::Internal(anyhow::anyhow!("write upload temp file: {error}"))
        })?;
    }

    Ok(size_bytes)
}

// Human: Guess whether a multipart part should use the video spool path before reading bytes.
// Agent: READS filename extension only; IGNORES spoofed Content-Type so HTML cannot hijack HLS ingest.
fn multipart_part_is_video(filename: &str, _content_type: &str) -> bool {
    mime_guess::from_path(filename)
        .first_or_octet_stream()
        .type_()
        .as_str()
        == "video"
}

// Human: Accept multipart uploads and persist bytes to object storage with metadata in Postgres.
// Agent: WRITES storage PUT + files INSERT; RATE LIMITED upload_rl; AUDIT files.upload; LOGS phase timings.
pub async fn upload_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Extension(request_id): Extension<request_tracking::RequestId>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    let upload_started = Instant::now();
    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        max_upload_bytes = state.max_upload_bytes,
        "files.upload started"
    );

    // Human: Reject over quota but still drain the multipart body so the client gets a clean 429.
    // Agent: READS all multipart fields when rate limited; AVOIDS ERR_CONNECTION_ABORTED mid-body.
    if let Err(e) = rate_limit::enforce(&state.upload_rl, &claims.sub) {
        drain_multipart(&mut multipart).await;
        return Err(e);
    }

    let file_id = Uuid::new_v4().to_string();
    let mut filename = String::from("untitled");
    let mut folder_id: Option<String> = None;
    let mut received_body: Option<ReceivedUploadBody> = None;
    let mut content_type = String::from("application/octet-stream");

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        match field.name() {
            Some("file") => {
                filename = field
                    .file_name()
                    .map(str::to_string)
                    .unwrap_or_else(|| filename.clone());
                content_type = field
                    .content_type()
                    .map(str::to_string)
                    .unwrap_or(content_type.clone());
                let multipart_read_started = Instant::now();
                tracing::info!(
                    request_id = %request_id.0,
                    user_id = %claims.sub,
                    filename = %filename,
                    content_type = %content_type,
                    "files.upload receiving multipart body"
                );

                let is_video = multipart_part_is_video(&filename, &content_type);
                let work_dir = std::env::temp_dir().join(format!("ownly_upload_{file_id}"));
                tokio::fs::create_dir_all(&work_dir).await.map_err(|error| {
                    AppError::Internal(anyhow::anyhow!("create upload work dir: {error}"))
                })?;
                let tmp_path = work_dir.join("source");
                let size_bytes = stream_multipart_field_to_path(
                    field,
                    &tmp_path,
                    state.max_upload_bytes,
                )
                .await?;
                received_body = Some(ReceivedUploadBody::DiskSpool {
                    work_dir,
                    tmp_path,
                    size_bytes,
                    is_video,
                });
                tracing::info!(
                    request_id = %request_id.0,
                    user_id = %claims.sub,
                    filename = %filename,
                    size_bytes,
                    is_video,
                    multipart_read_ms = multipart_read_started.elapsed().as_millis() as u64,
                    spooled_to_disk = true,
                    "files.upload spooled to temp file"
                );
                let multipart_ms = multipart_read_started.elapsed().as_millis() as u64;
                if multipart_ms > 30_000 {
                    tracing::warn!(
                        request_id = %request_id.0,
                        filename = %filename,
                        size_bytes,
                        multipart_read_ms = multipart_ms,
                        "files.upload multipart read was slow — check nginx proxy buffering or client link"
                    );
                }
            }
            Some("folder_id") => {
                let value = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                if !value.trim().is_empty() {
                    folder_id = Some(value);
                }
            }
            _ => {}
        }
    }

    let received_body =
        received_body.ok_or_else(|| AppError::BadRequest("file is required".into()))?;

    // Human: Strip client-supplied path segments before persisting the display name.
    // Agent: CALLS normalize_upload_filename; REJECTS traversal/control chars; ALLOWS .html documents.
    let filename = normalize_upload_filename(&filename)?;

    // Human: Reject uploads into folders the caller does not own.
    // Agent: READS folders via ensure_folder_owned before storage PUT.
    if let Some(ref target_folder_id) = folder_id {
        ensure_folder_owned(&state.pool, &claims.sub, target_folder_id).await?;
    }

    let storage_key = format!("users/{}/files/{}", claims.sub, file_id);

    let guessed_mime = mime_guess::from_path(&filename)
        .first_or_octet_stream()
        .to_string();
    // Human: Prefer filename-based MIME when clients spoof video/* on non-video uploads.
    // Agent: PREVENTS text/html and other documents from inheriting a forged Content-Type header.
    let mime = if content_type.is_empty() {
        guessed_mime
    } else if content_type.starts_with("video/") && !guessed_mime.starts_with("video/") {
        guessed_mime
    } else {
        content_type
    };

    // Human: Reconcile image Content-Type with magic bytes before storage PUT (WebP-as-GIF uploads).
    // Agent: READS tmp_path header; CALLS gif_preview::reconcile_upload_image_mime for non-video spools.
    let mime = match &received_body {
        ReceivedUploadBody::DiskSpool {
            tmp_path,
            is_video: false,
            ..
        } => {
            if let Ok(head) = crate::files::gif_preview::read_file_magic_head(tmp_path).await {
                crate::files::gif_preview::reconcile_upload_image_mime(&head, &mime)
            } else {
                mime
            }
        }
        _ => mime,
    };

    let ReceivedUploadBody::DiskSpool {
        ref tmp_path,
        size_bytes,
        ..
    } = &received_body;
    if *size_bytes == 0 {
        return Err(AppError::BadRequest("file is required".into()));
    }

    // Human: Persist the SHA-256 digest of uploaded bytes for content-based duplicate detection.
    // Agent: READS spooled tmp_path; WRITES content_hash on every files INSERT below.
    let content_hash = crate::files::content_hash::hash_file_sha256(tmp_path).await?;

    let storage_put_started = Instant::now();
    let db_started = Instant::now();

    let file: FileDto = match received_body {
        ReceivedUploadBody::DiskSpool {
            work_dir: _work_dir,
            tmp_path,
            size_bytes,
            is_video: true,
        } => {
            if size_bytes == 0 {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(AppError::BadRequest("file is required".into()));
            }

            tracing::info!(
                request_id = %request_id.0,
                file_id = %file_id,
                storage_key = %storage_key,
                size_bytes,
                is_video = true,
                "files.upload persisting video metadata"
            );

            // Human: Reserve a node with enough capacity before HLS worker writes segments.
            // Agent: CALLS placement::reserve_node_for_upload; WRITES files.storage_node_id.
            let storage_node_id = crate::storage::placement::reserve_node_for_upload(
                &state.pool,
                &storage_key,
                size_bytes,
            )
            .await?;

            let _: FileDto = sqlx::query_as(&format!(
                "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
                 storage_node_id, duration_seconds, hls_encode_status, conversion_progress, \
                 video_thumbnail_status) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'queued', 0, 'queued') \
                 RETURNING {FILE_COLUMNS}"
            ))
            .bind(&file_id)
            .bind(&claims.sub)
            .bind(&folder_id)
            .bind(&filename)
            .bind(&storage_key)
            .bind(&mime)
            .bind(size_bytes as i64)
            .bind(&content_hash)
            .bind(&storage_node_id)
            .fetch_one(&state.pool)
            .await?;

            tracing::info!(
                request_id = %request_id.0,
                file_id = %file_id,
                "files.upload HLS ingest queued (duration probed in background worker)"
            );

            let payload = HlsEncodePayload {
                file_id: file_id.clone(),
                storage_key: storage_key.clone(),
                tmp_video: tmp_path.to_string_lossy().to_string(),
                duration_seconds: 0,
            };

            jobs::enqueue_job(
                &state.pool,
                &claims.sub,
                JobKind::HlsEncode,
                &filename,
                Some("file"),
                Some(&file_id),
                serde_json::to_value(payload)
                    .map_err(|e| AppError::Internal(anyhow::anyhow!("encode job payload: {e}")))?,
            )
            .await?;

            let thumbnail_payload = VideoThumbnailPayload {
                file_id: file_id.clone(),
                storage_key: storage_key.clone(),
                tmp_video: Some(tmp_path.to_string_lossy().to_string()),
            };

            jobs::enqueue_job(
                &state.pool,
                &claims.sub,
                JobKind::VideoThumbnail,
                &filename,
                Some("file"),
                Some(&file_id),
                serde_json::to_value(thumbnail_payload).map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("thumbnail job payload: {e}"))
                })?,
            )
            .await?;

            sqlx::query_as(&format!(
                "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2"
            ))
            .bind(&file_id)
            .bind(&claims.sub)
            .fetch_one(&state.pool)
            .await?
        }
        ReceivedUploadBody::DiskSpool {
            work_dir,
            tmp_path,
            size_bytes,
            is_video: false,
        } => {
            if size_bytes == 0 {
                cleanup_upload_work_dir(&work_dir).await;
                return Err(AppError::BadRequest("file is required".into()));
            }
            let is_audio = mime.starts_with("audio/");
            let is_image = mime.starts_with("image/");

            tracing::info!(
                request_id = %request_id.0,
                file_id = %file_id,
                storage_key = %storage_key,
                size_bytes,
                is_video = false,
                is_audio,
                is_image,
                "files.upload object storage PUT starting"
            );

            if let Err(error) = storage_put_spooled_file(
                &state.storage,
                &storage_key,
                &mime,
                &tmp_path,
            )
            .await
            {
                cleanup_upload_work_dir(&work_dir).await;
                tracing::error!(
                    request_id = %request_id.0,
                    file_id = %file_id,
                    storage_key = %storage_key,
                    size_bytes,
                    storage_put_ms = storage_put_started.elapsed().as_millis() as u64,
                    error = %error,
                    "files.upload object storage PUT failed"
                );
                return Err(error);
            }

            let storage_put_ms = storage_put_started.elapsed().as_millis() as u64;
            tracing::info!(
                request_id = %request_id.0,
                file_id = %file_id,
                storage_key = %storage_key,
                size_bytes,
                storage_put_ms,
                "files.upload object storage PUT complete"
            );

            if is_audio {
                let file: FileDto = sqlx::query_as(&format!(
                    "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
                     audio_encode_status, conversion_progress) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0) \
                     RETURNING {FILE_COLUMNS}"
                ))
                .bind(&file_id)
                .bind(&claims.sub)
                .bind(&folder_id)
                .bind(&filename)
                .bind(&storage_key)
                .bind(&mime)
                .bind(size_bytes as i64)
                .bind(&content_hash)
                .fetch_one(&state.pool)
                .await?;

                tracing::info!(
                    request_id = %request_id.0,
                    file_id = %file_id,
                    "files.upload audio waveform analysis queued"
                );

                let payload = AudioWaveformPayload {
                    file_id: file_id.clone(),
                    storage_key: storage_key.clone(),
                    tmp_audio: Some(tmp_path.to_string_lossy().to_string()),
                };

                jobs::enqueue_job(
                    &state.pool,
                    &claims.sub,
                    JobKind::AudioWaveform,
                    &filename,
                    Some("file"),
                    Some(&file_id),
                    serde_json::to_value(payload).map_err(|e| {
                        AppError::Internal(anyhow::anyhow!("audio waveform job payload: {e}"))
                    })?,
                )
                .await?;

                file
            } else if is_image {
                let file: FileDto = sqlx::query_as(&format!(
                    "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
                     image_thumbnail_status) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued') \
                     RETURNING {FILE_COLUMNS}"
                ))
                .bind(&file_id)
                .bind(&claims.sub)
                .bind(&folder_id)
                .bind(&filename)
                .bind(&storage_key)
                .bind(&mime)
                .bind(size_bytes as i64)
                .bind(&content_hash)
                .fetch_one(&state.pool)
                .await?;

                tracing::info!(
                    request_id = %request_id.0,
                    file_id = %file_id,
                    "files.upload image grid thumbnail queued"
                );

                let payload = ImageThumbnailPayload {
                    file_id: file_id.clone(),
                    storage_key: storage_key.clone(),
                    tmp_source: Some(tmp_path.to_string_lossy().to_string()),
                };

                jobs::enqueue_job(
                    &state.pool,
                    &claims.sub,
                    JobKind::ImageThumbnail,
                    &filename,
                    Some("file"),
                    Some(&file_id),
                    serde_json::to_value(payload).map_err(|e| {
                        AppError::Internal(anyhow::anyhow!("image thumbnail job payload: {e}"))
                    })?,
                )
                .await?;

                file
            } else {
                let file: FileDto = sqlx::query_as(&format!(
                    "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {FILE_COLUMNS}"
                ))
                .bind(&file_id)
                .bind(&claims.sub)
                .bind(&folder_id)
                .bind(&filename)
                .bind(&storage_key)
                .bind(&mime)
                .bind(size_bytes as i64)
                .bind(&content_hash)
                .fetch_one(&state.pool)
                .await?;
                cleanup_upload_work_dir(&work_dir).await;
                file
            }
        }
    };
    tracing::info!(
        request_id = %request_id.0,
        file_id = %file_id,
        db_insert_ms = db_started.elapsed().as_millis() as u64,
        "files.upload database insert complete"
    );

    // Human: Attach PUT-time placement cache to the new files row (non-video uploads).
    // Agent: READS storage_blob_placements; UPDATES files.storage_node_id when still NULL.
    crate::storage::placement::link_file_to_placement(&state.pool, &file_id, &storage_key).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.upload",
        Some("file"),
        Some(&file_id),
        Some(serde_json::json!({ "name": filename, "size_bytes": file.size_bytes })),
        &headers,
    )
    .await
    .ok();

    tracing::info!(
        request_id = %request_id.0,
        user_id = %claims.sub,
        file_id = %file_id,
        filename = %filename,
        size_bytes = file.size_bytes,
        total_ms = upload_started.elapsed().as_millis() as u64,
        "files.upload complete"
    );

    Ok(Json(UploadResponse { file }))
}

// Human: Stream file bytes through the API for inline viewing or download.
// Agent: READS files by id+user; CALLS storage.get_stream; SETS Content-Type/Disposition headers.
pub async fn download_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<DownloadFileRow> = sqlx::query_as(
        "SELECT storage_key, name, mime_type, hls_ready, download_export_ready, hls_encode_status, \
         download_export_size_bytes, audio_waveform_ready, audio_encode_status FROM files \
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (
        storage_key,
        name,
        mime_type,
        hls_ready,
        export_ready,
        hls_encode_status,
        export_size,
        audio_waveform_ready,
        audio_encode_status,
    ) = row.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    let object_key = if is_hls_stored_video(&mime_type, hls_ready) {
        if !export_cache_is_valid(export_ready, export_size) {
            return Err(AppError::Conflict(
                "video export is not ready — poll /export and retry".into(),
            ));
        }
        format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}")
    } else {
        storage_key.clone()
    };

    let (stream, _len, content_type) = state
        .storage
        .get_stream(&object_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let body = Body::from_stream(stream);
    let download_name = if is_hls_stored_video(&mime_type, hls_ready) {
        mp4_download_name(&name)
    } else {
        name.clone()
    };
    let disposition = format!("attachment; filename=\"{}\"", download_name.replace('"', ""));

    let resolved_type = if is_hls_stored_video(&mime_type, hls_ready) {
        "video/mp4".to_string()
    } else {
        mime_type.unwrap_or(content_type)
    };

    // Human: Clients (especially URLSession) need Content-Length to read the full object when proxying storage.
    // Agent: SETS Content-Length from storage metadata when known; avoids truncated MP4 downloads on iOS.
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, resolved_type)
        .header(header::CONTENT_DISPOSITION, disposition);
    if _len > 0 {
        builder = builder.header(header::CONTENT_LENGTH, _len);
    }

    builder
        .body(body)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("download response: {e}")))
}

// Human: Return a time-limited presigned URL for direct client download from object storage.
// Agent: READS files; CALLS storage.presigned_url; NO byte proxy.
pub async fn download_url(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<DownloadUrlResponse>, AppError> {
    let row: Option<DownloadUrlRow> = sqlx::query_as(
        "SELECT storage_key, mime_type, hls_ready, download_export_ready, hls_encode_status, \
         download_export_size_bytes, audio_waveform_ready, audio_encode_status FROM files \
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (
        storage_key,
        mime_type,
        hls_ready,
        export_ready,
        hls_encode_status,
        export_size,
        audio_waveform_ready,
        audio_encode_status,
    ) = row.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    let object_key = if is_hls_stored_video(&mime_type, hls_ready) {
        if !export_cache_is_valid(export_ready, export_size) {
            return Err(AppError::Conflict(
                "video export is not ready — poll /export and retry".into(),
            ));
        }
        format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}")
    } else {
        storage_key
    };

    let url = state
        .storage
        .presigned_url(&object_key, state.url_expiry_seconds)
        .map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(Json(DownloadUrlResponse {
        url,
        expires_in_seconds: state.url_expiry_seconds,
    }))
}

// Human: Return a same-origin stream URL for in-browser preview (audio/images) without presigned object-storage hosts.
// Agent: GET protected; CALLS stream_ticket::generate_ticket; RETURNS relative /files/{id}/stream?ticket= URL.
pub async fn preview_url(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<DownloadUrlResponse>, AppError> {
    type PreviewUrlRow = (Option<String>, bool, Option<String>, bool, Option<String>);
    let row: Option<PreviewUrlRow> = sqlx::query_as(
        "SELECT mime_type, hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status \
         FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status) =
        row.ok_or(AppError::NotFound)?;
    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    let ticket = crate::stream_ticket::generate_ticket(
        &id,
        &claims.sub,
        &state.signing_secret,
        state.url_expiry_seconds,
    );
    let encoded = crate::hls::handlers::encode_query_component(&ticket);
    Ok(Json(DownloadUrlResponse {
        url: format!("/api/v1/files/{id}/stream?ticket={encoded}"),
        expires_in_seconds: state.url_expiry_seconds,
    }))
}

// Human: Move a file into another folder or back to the drive root.
// Agent: PATCH files.folder_id; VALIDATES folder ownership; AUDIT files.move.
pub async fn move_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MoveFileRequest>,
) -> Result<Json<MoveFileResponse>, AppError> {
    let current: Option<MoveFileCurrentRow> = sqlx::query_as(
        "SELECT folder_id, name, mime_type, hls_ready, hls_encode_status, audio_waveform_ready, \
         audio_encode_status FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (
        current_folder_id,
        name,
        mime_type,
        hls_ready,
        hls_encode_status,
        audio_waveform_ready,
        audio_encode_status,
    ) = current.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    let target_folder_id = body
        .folder_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if current_folder_id.as_deref() == target_folder_id.as_deref() {
        return Err(AppError::BadRequest(
            "file is already in this folder".into(),
        ));
    }

    if let Some(ref folder_id) = target_folder_id {
        ensure_folder_owned(&state.pool, &claims.sub, folder_id).await?;
    }

    let file: FileDto = sqlx::query_as(&format!(
        "UPDATE files SET folder_id = $1, updated_at = NOW() \
         WHERE id = $2 AND user_id = $3 RETURNING {FILE_COLUMNS}"
    ))
    .bind(&target_folder_id)
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.move",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({
            "name": name,
            "from_folder_id": current_folder_id,
            "to_folder_id": target_folder_id,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(MoveFileResponse { file }))
}

// Human: Duplicate a file into another folder or the drive root with independent storage blobs.
// Agent: POST files.copy; COPIES storage artifacts; INSERTS new row; AUDIT files.copy.
pub async fn copy_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CopyFileRequest>,
) -> Result<Json<CopyFileResponse>, AppError> {
    let source: Option<CopyFileSourceRow> = sqlx::query_as(
        "SELECT storage_key, segment_count, name, mime_type, size_bytes, content_hash, hls_ready, \
         hls_encode_status, hls_encode_error, conversion_progress, duration_seconds, \
         audio_waveform_ready, audio_encode_status, audio_waveform_key, \
         video_thumbnail_ready, video_thumbnail_status, video_thumbnail_manifest_key, \
         video_thumbnail_selected_index \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let source = source.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(
        &source.mime_type,
        source.hls_ready,
        &source.hls_encode_status,
        source.audio_waveform_ready,
        &source.audio_encode_status,
    )?;

    let target_folder_id = body
        .folder_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if let Some(ref folder_id) = target_folder_id {
        ensure_folder_owned(&state.pool, &claims.sub, folder_id).await?;
    }

    let new_file_id = Uuid::new_v4().to_string();
    let new_storage_key = format!("users/{}/files/{}", claims.sub, new_file_id);
    let copy_name =
        unique_name_in_folder(&state.pool, &claims.sub, &target_folder_id, &source.name).await?;

    copy_storage_artifacts(
        &state,
        &source.storage_key,
        &new_storage_key,
        source.segment_count,
    )
    .await?;

    let new_waveform_key = source
        .audio_waveform_key
        .as_ref()
        .map(|_| crate::audio::waveform_storage_key(&new_storage_key));
    let new_thumbnail_manifest_key = source
        .video_thumbnail_manifest_key
        .as_ref()
        .map(|_| crate::video::thumbnail_manifest_storage_key(&new_storage_key));

    let file: FileDto = sqlx::query_as(&format!(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
         duration_seconds, hls_ready, hls_encode_status, hls_encode_error, conversion_progress, \
         segment_count, audio_waveform_ready, audio_encode_status, audio_waveform_key, \
         video_thumbnail_ready, video_thumbnail_status, video_thumbnail_manifest_key, \
         video_thumbnail_selected_index) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) \
         RETURNING {FILE_COLUMNS}"
    ))
    .bind(&new_file_id)
    .bind(&claims.sub)
    .bind(&target_folder_id)
    .bind(&copy_name)
    .bind(&new_storage_key)
    .bind(&source.mime_type)
    .bind(source.size_bytes)
    .bind(&source.content_hash)
    .bind(source.duration_seconds)
    .bind(source.hls_ready)
    .bind(&source.hls_encode_status)
    .bind(&source.hls_encode_error)
    .bind(source.conversion_progress)
    .bind(source.segment_count)
    .bind(source.audio_waveform_ready)
    .bind(&source.audio_encode_status)
    .bind(&new_waveform_key)
    .bind(source.video_thumbnail_ready)
    .bind(&source.video_thumbnail_status)
    .bind(&new_thumbnail_manifest_key)
    .bind(source.video_thumbnail_selected_index)
    .fetch_one(&state.pool)
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.copy",
        Some("file"),
        Some(&new_file_id),
        Some(serde_json::json!({
            "name": copy_name,
            "source_file_id": id,
            "to_folder_id": target_folder_id,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(CopyFileResponse { file }))
}

// Human: Cancel server-side HLS ingest for a video still being transcoded after upload.
// Agent: POST /api/v1/files/:id/cancel-ingest; WRITES job cancelled + file hls_encode_status; AUDIT files.ingest.cancel.
pub async fn cancel_video_ingest(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, bool, String, Option<i32>)> = sqlx::query_as(
        "SELECT mime_type, hls_ready, storage_key, segment_count FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (mime_type, hls_ready, storage_key, segment_count) = row.ok_or(AppError::NotFound)?;
    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
    {
        return Err(AppError::BadRequest(
            "only video files can cancel ingest".into(),
        ));
    }
    if hls_ready {
        return Err(AppError::Conflict(
            "video ingest already finished".into(),
        ));
    }

    let cancelled = jobs::cancel_hls_encode_for_file(&state.pool, &claims.sub, &id).await?;
    let _ = jobs::cancel_video_thumbnail_for_file(&state.pool, &claims.sub, &id).await;

    if cancelled {
        purge_file_storage(state.storage.clone(), &storage_key, segment_count).await;
    }

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "files.ingest.cancel",
        Some("file"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": cancelled })))
}

// Human: Move a file to the recycle bin, or permanently delete when ?permanent=true.
// Agent: DEFAULT soft-deletes (files.trash); permanent CALLS delete_owned_file_row + storage purge.
pub async fn delete_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<DeleteQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
        let row: Option<(Option<String>, bool, Option<String>, Option<chrono::DateTime<chrono::Utc>>, bool, Option<String>)> =
            sqlx::query_as(
            "SELECT mime_type, hls_ready, hls_encode_status, deleted_at, audio_waveform_ready, \
             audio_encode_status FROM files WHERE id = $1 AND user_id = $2",
        )
        .bind(&id)
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;

    let Some((mime_type, hls_ready, hls_encode_status, deleted_at, audio_waveform_ready, audio_encode_status)) =
        row
    else {
        // Human: DELETE is idempotent — stale UI rows may reference files already purged.
        // Agent: RETURNS ok without audit when row missing (retry after partial delete).
        return Ok(Json(serde_json::json!({ "ok": true })));
    };

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    if query.permanent {
        let deleted =
            delete_owned_file_row(&state, &state.pool, &claims.sub, &id).await?;

        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "files.delete.permanent",
            Some("file"),
            Some(&id),
            Some(serde_json::json!({ "name": deleted.name })),
            &headers,
        )
        .await
        .ok();
    } else if deleted_at.is_some() {
        return Ok(Json(serde_json::json!({ "ok": true })));
    } else {
        let name = recycle_bin::soft_delete_owned_file(&state.pool, &claims.sub, &id).await?;

        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "files.trash",
            Some("file"),
            Some(&id),
            Some(serde_json::json!({ "name": name })),
            &headers,
        )
        .await
        .ok();
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Return instance branding and storage summary for the drive dashboard header.
// Agent: READS app_settings instance_name + quota; READS user file stats.
pub async fn dashboard_summary(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let instance_name: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'instance_name'")
            .fetch_optional(&state.pool)
            .await?;

    // Human: SUM(bigint) returns NUMERIC in Postgres — cast to BIGINT so sqlx can decode into i64.
    // Agent: READS files for user; RETURNS (file_count, used_bytes) as i64 pair for dashboard JSON.
    let stats: (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(size_bytes), 0)::BIGINT FROM files WHERE user_id = $1",
    )
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    let quota_bytes =
        crate::quota::resolve_user_quota_bytes(&state.pool, &claims.sub).await?;

    // Human: Network-wide free space for upload preflight — same probe as RouterStorage placement.
    // Agent: READS storage_nodes + Nebular metrics; SUM remaining; MIN with user quota for effective_remaining_bytes.
    let nodes = crate::storage::placement::load_node_snapshots_cached(&state.pool).await?;
    let network_remaining_bytes =
        crate::storage::placement::aggregate_network_remaining_bytes(&nodes);
    let effective_remaining_bytes = crate::storage::placement::effective_remaining_bytes(
        stats.1,
        quota_bytes,
        network_remaining_bytes,
    );

    Ok(Json(serde_json::json!({
        "instance_name": instance_name.map(|(n,)| n).unwrap_or_else(|| "Ownly".into()),
        "file_count": stats.0,
        "used_bytes": stats.1,
        "quota_bytes": quota_bytes,
        "network_remaining_bytes": network_remaining_bytes,
        "effective_remaining_bytes": if effective_remaining_bytes == i64::MAX {
            serde_json::Value::Null
        } else {
            serde_json::Value::from(effective_remaining_bytes)
        },
    })))
}
