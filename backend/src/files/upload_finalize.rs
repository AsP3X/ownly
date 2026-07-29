// Human: Finalize an uploaded blob into Postgres + object storage (spool or staged parts; shared by simple + chunked).
// Agent: HASHES content; DEDUPS per-user via content_hash; WRITES files row + jobs; AUDIT files.upload.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::http::HeaderMap;

use crate::{
    audit,
    error::AppError,
    files::{
        content_hash::{find_dedup_source, DedupSource},
        handlers::{FileDto, FILE_COLUMNS},
        upload_spool::{cleanup_upload_work_dir, storage_put_spooled_file, upload_is_video},
        upload_staging::{
            cleanup_staging_prefix, hash_and_put_final_from_staged_parts, staging_part_keys,
        },
    },
    jobs::{
        self,
        model::{
            AudioWaveformPayload, DocumentThumbnailPayload, HlsEncodePayload, ImageThumbnailPayload,
            VideoThumbnailPayload,
        },
        JobKind,
    },
    request_tracking,
    AppState,
};

/// Human: Inputs required to register one uploaded blob after bytes land on disk.
/// Agent: PASSED from multipart upload or resumable video session complete handler.
pub struct SpooledUploadInput {
    pub file_id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub filename: String,
    pub storage_key: String,
    pub mime: String,
    pub work_dir: PathBuf,
    pub tmp_path: PathBuf,
    pub size_bytes: u64,
    /// Human: When true, audit context notes the resumable chunked upload path.
    pub resumable: bool,
}

/// Human: Inputs for non-video resumable uploads whose parts already live in object storage staging.
/// Agent: PASSED from uploads::complete_session when upload_is_video is false.
pub struct StagedUploadInput {
    pub file_id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub filename: String,
    pub storage_key: String,
    pub mime: String,
    pub session_id: String,
    pub total_parts: i32,
    pub size_bytes: u64,
    pub resumable: bool,
    /// Human: Client-supplied hash from session create — enables early dedup without reading parts.
    pub known_content_hash: Option<String>,
}

/// Human: Instant per-user dedup when content_hash already matches an active library file (no part bytes).
/// Agent: PASSED from complete_session when parts were skipped; SHARES storage_key via insert_deduped_file.
pub struct InstantDedupInput {
    pub file_id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub filename: String,
    pub mime: String,
    pub size_bytes: u64,
    pub content_hash: String,
    pub resumable: bool,
    pub staged: bool,
}

// Human: Hash spool, PUT to Nebular (or queue HLS), insert files row, enqueue derivative jobs, audit.
// Agent: CALLS quota::ensure_within_quota; RETURNS FileDto; WRITES audit files.upload.
pub async fn finalize_spooled_upload(
    state: &Arc<AppState>,
    request_id: &request_tracking::RequestId,
    headers: &HeaderMap,
    input: SpooledUploadInput,
) -> Result<FileDto, AppError> {
    if input.size_bytes == 0 {
        cleanup_upload_work_dir(&input.work_dir).await;
        return Err(AppError::BadRequest("file is required".into()));
    }

    crate::quota::ensure_within_quota(&state.pool, &input.user_id, input.size_bytes as i64).await?;

    let content_hash = crate::files::content_hash::hash_file_sha256(&input.tmp_path).await?;
    let is_video = upload_is_video(&input.filename, &input.mime);

    if let Some(source) = find_dedup_source(
        &state.pool,
        &input.user_id,
        &content_hash,
        input.size_bytes as i64,
        is_video,
    )
    .await?
    {
        let file = insert_deduped_file(state, &input.file_id, &input.user_id, &input.folder_id, &input.filename, &input.mime, &content_hash, &source).await?;
        cleanup_upload_work_dir(&input.work_dir).await;
        write_upload_audit(
            state,
            headers,
            &input.user_id,
            &input.file_id,
            &input.filename,
            file.size_bytes,
            input.resumable,
            true,
            Some(&source.id),
            false,
        )
        .await;
        tracing::info!(
            request_id = %request_id.0,
            file_id = %input.file_id,
            source_file_id = %source.id,
            storage_key = %source.storage_key,
            "files.upload deduped to existing storage_key"
        );
        return Ok(file);
    }

    finalize_new_blob_from_spool(state, request_id, headers, input, content_hash, is_video).await
}

// Human: Register a new library row that shares an existing blob when the client hash matches.
// Agent: NO part reads; REQUIRES find_dedup_source hit for same user+size; AUDIT files.upload deduped.
pub async fn finalize_instant_dedup_upload(
    state: &Arc<AppState>,
    request_id: &request_tracking::RequestId,
    headers: &HeaderMap,
    input: InstantDedupInput,
) -> Result<FileDto, AppError> {
    if input.size_bytes == 0 {
        return Err(AppError::BadRequest("file is required".into()));
    }

    crate::quota::ensure_within_quota(&state.pool, &input.user_id, input.size_bytes as i64).await?;

    let is_video = upload_is_video(&input.filename, &input.mime);
    let source = find_dedup_source(
        &state.pool,
        &input.user_id,
        &input.content_hash,
        input.size_bytes as i64,
        is_video,
    )
    .await?
    .ok_or_else(|| {
        AppError::Conflict(
            "instant dedup is not available — content is not already in your library".into(),
        )
    })?;

    let file = insert_deduped_file(
        state,
        &input.file_id,
        &input.user_id,
        &input.folder_id,
        &input.filename,
        &input.mime,
        &input.content_hash,
        &source,
    )
    .await?;

    write_upload_audit(
        state,
        headers,
        &input.user_id,
        &input.file_id,
        &input.filename,
        file.size_bytes,
        input.resumable,
        true,
        Some(&source.id),
        input.staged,
    )
    .await;

    tracing::info!(
        request_id = %request_id.0,
        file_id = %input.file_id,
        source_file_id = %source.id,
        storage_key = %source.storage_key,
        instant = true,
        "files.upload instant deduped to existing storage_key"
    );

    Ok(file)
}

// Human: Finalize non-video resumable parts already stored under upload-staging/{session}/.
// Agent: EARLY dedup via known_content_hash; ELSE single-pass hash+PUT; CLEANS staging; ENQUEUES jobs.
pub async fn finalize_staged_upload(
    state: &Arc<AppState>,
    request_id: &request_tracking::RequestId,
    headers: &HeaderMap,
    input: StagedUploadInput,
) -> Result<FileDto, AppError> {
    if input.size_bytes == 0 {
        cleanup_staging_prefix(&state.storage, &input.session_id).await;
        return Err(AppError::BadRequest("file is required".into()));
    }

    crate::quota::ensure_within_quota(&state.pool, &input.user_id, input.size_bytes as i64).await?;

    let is_video = upload_is_video(&input.filename, &input.mime);
    if is_video {
        cleanup_staging_prefix(&state.storage, &input.session_id).await;
        return Err(AppError::Internal(anyhow::anyhow!(
            "staged finalize is not valid for video uploads"
        )));
    }

    // Human: Skip all object reads when the session already carries a matching library hash.
    if let Some(ref known_hash) = input.known_content_hash {
        if let Some(source) = find_dedup_source(
            &state.pool,
            &input.user_id,
            known_hash,
            input.size_bytes as i64,
            false,
        )
        .await?
        {
            let file = insert_deduped_file(
                state,
                &input.file_id,
                &input.user_id,
                &input.folder_id,
                &input.filename,
                &input.mime,
                known_hash,
                &source,
            )
            .await?;
            cleanup_staging_prefix(&state.storage, &input.session_id).await;
            write_upload_audit(
                state,
                headers,
                &input.user_id,
                &input.file_id,
                &input.filename,
                file.size_bytes,
                input.resumable,
                true,
                Some(&source.id),
                true,
            )
            .await;
            tracing::info!(
                request_id = %request_id.0,
                file_id = %input.file_id,
                source_file_id = %source.id,
                storage_key = %source.storage_key,
                "files.upload staged deduped to existing storage_key (known hash)"
            );
            return Ok(file);
        }
    }

    let part_keys = staging_part_keys(&input.session_id, input.total_parts);
    let storage_put_started = Instant::now();
    tracing::info!(
        request_id = %request_id.0,
        file_id = %input.file_id,
        storage_key = %input.storage_key,
        size_bytes = input.size_bytes,
        "files.upload staged object storage PUT starting (single-pass hash)"
    );

    let content_hash = match hash_and_put_final_from_staged_parts(
        &state.storage,
        &input.storage_key,
        &input.mime,
        &part_keys,
        input.size_bytes,
    )
    .await
    {
        Ok(hash) => hash,
        Err(error) => {
            tracing::error!(
                request_id = %request_id.0,
                file_id = %input.file_id,
                storage_key = %input.storage_key,
                storage_put_ms = storage_put_started.elapsed().as_millis() as u64,
                error = %error,
                "files.upload staged object storage PUT failed"
            );
            return Err(error);
        }
    };

    // Human: Rare race — another concurrent upload finished the same bytes first; drop our PUT orphan.
    if let Some(source) = find_dedup_source(
        &state.pool,
        &input.user_id,
        &content_hash,
        input.size_bytes as i64,
        false,
    )
    .await?
    {
        let _ = state.storage.delete(&input.storage_key).await;
        let file = insert_deduped_file(
            state,
            &input.file_id,
            &input.user_id,
            &input.folder_id,
            &input.filename,
            &input.mime,
            &content_hash,
            &source,
        )
        .await?;
        cleanup_staging_prefix(&state.storage, &input.session_id).await;
        write_upload_audit(
            state,
            headers,
            &input.user_id,
            &input.file_id,
            &input.filename,
            file.size_bytes,
            input.resumable,
            true,
            Some(&source.id),
            true,
        )
        .await;
        return Ok(file);
    }

    tracing::info!(
        request_id = %request_id.0,
        file_id = %input.file_id,
        storage_key = %input.storage_key,
        storage_put_ms = storage_put_started.elapsed().as_millis() as u64,
        "files.upload staged object storage PUT complete"
    );

    let file = insert_non_video_file_and_jobs(
        state,
        &input.file_id,
        &input.user_id,
        &input.folder_id,
        &input.filename,
        &input.storage_key,
        &input.mime,
        input.size_bytes,
        &content_hash,
        None,
    )
    .await?;

    cleanup_staging_prefix(&state.storage, &input.session_id).await;

    crate::storage::placement::link_file_to_placement(
        &state.pool,
        &input.file_id,
        &input.storage_key,
    )
    .await?;

    write_upload_audit(
        state,
        headers,
        &input.user_id,
        &input.file_id,
        &input.filename,
        file.size_bytes,
        input.resumable,
        false,
        None,
        true,
    )
    .await;

    Ok(file)
}

async fn finalize_new_blob_from_spool(
    state: &Arc<AppState>,
    request_id: &request_tracking::RequestId,
    headers: &HeaderMap,
    input: SpooledUploadInput,
    content_hash: String,
    is_video: bool,
) -> Result<FileDto, AppError> {
    let storage_put_started = Instant::now();
    let db_started = Instant::now();

    let file: FileDto = if is_video {
        tracing::info!(
            request_id = %request_id.0,
            file_id = %input.file_id,
            storage_key = %input.storage_key,
            size_bytes = input.size_bytes,
            is_video = true,
            "files.upload persisting video metadata"
        );

        let storage_node_id = crate::storage::placement::reserve_node_for_upload(
            &state.pool,
            &input.storage_key,
            input.size_bytes,
        )
        .await?;

        let _: FileDto = sqlx::query_as(&format!(
            "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
             storage_node_id, duration_seconds, hls_encode_status, conversion_progress, \
             video_thumbnail_status) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'queued', 0, 'queued') \
             RETURNING {FILE_COLUMNS}"
        ))
        .bind(&input.file_id)
        .bind(&input.user_id)
        .bind(&input.folder_id)
        .bind(&input.filename)
        .bind(&input.storage_key)
        .bind(&input.mime)
        .bind(input.size_bytes as i64)
        .bind(&content_hash)
        .bind(&storage_node_id)
        .fetch_one(&state.pool)
        .await?;

        let payload = HlsEncodePayload {
            file_id: input.file_id.clone(),
            storage_key: input.storage_key.clone(),
            tmp_video: input.tmp_path.to_string_lossy().to_string(),
            duration_seconds: 0,
        };

        jobs::enqueue_job(
            &state.pool,
            &input.user_id,
            JobKind::HlsEncode,
            &input.filename,
            Some("file"),
            Some(&input.file_id),
            serde_json::to_value(payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("encode job payload: {e}")))?,
        )
        .await?;

        let thumbnail_payload = VideoThumbnailPayload {
            file_id: input.file_id.clone(),
            storage_key: input.storage_key.clone(),
            tmp_video: Some(input.tmp_path.to_string_lossy().to_string()),
        };

        jobs::enqueue_job(
            &state.pool,
            &input.user_id,
            JobKind::VideoThumbnail,
            &input.filename,
            Some("file"),
            Some(&input.file_id),
            serde_json::to_value(thumbnail_payload).map_err(|e| {
                AppError::Internal(anyhow::anyhow!("thumbnail job payload: {e}"))
            })?,
        )
        .await?;

        sqlx::query_as(&format!(
            "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2"
        ))
        .bind(&input.file_id)
        .bind(&input.user_id)
        .fetch_one(&state.pool)
        .await?
    } else {
        tracing::info!(
            request_id = %request_id.0,
            file_id = %input.file_id,
            storage_key = %input.storage_key,
            size_bytes = input.size_bytes,
            is_video = false,
            "files.upload object storage PUT starting"
        );

        if let Err(error) = storage_put_spooled_file(
            &state.storage,
            &input.storage_key,
            &input.mime,
            &input.tmp_path,
        )
        .await
        {
            cleanup_upload_work_dir(&input.work_dir).await;
            tracing::error!(
                request_id = %request_id.0,
                file_id = %input.file_id,
                storage_key = %input.storage_key,
                size_bytes = input.size_bytes,
                storage_put_ms = storage_put_started.elapsed().as_millis() as u64,
                error = %error,
                "files.upload object storage PUT failed"
            );
            return Err(error);
        }

        tracing::info!(
            request_id = %request_id.0,
            file_id = %input.file_id,
            storage_key = %input.storage_key,
            size_bytes = input.size_bytes,
            storage_put_ms = storage_put_started.elapsed().as_millis() as u64,
            "files.upload object storage PUT complete"
        );

        insert_non_video_file_and_jobs(
            state,
            &input.file_id,
            &input.user_id,
            &input.folder_id,
            &input.filename,
            &input.storage_key,
            &input.mime,
            input.size_bytes,
            &content_hash,
            Some(&input.tmp_path),
        )
        .await?
    };

    tracing::info!(
        request_id = %request_id.0,
        file_id = %input.file_id,
        db_insert_ms = db_started.elapsed().as_millis() as u64,
        "files.upload database insert complete"
    );

    crate::storage::placement::link_file_to_placement(
        &state.pool,
        &input.file_id,
        &input.storage_key,
    )
    .await?;

    write_upload_audit(
        state,
        headers,
        &input.user_id,
        &input.file_id,
        &input.filename,
        file.size_bytes,
        input.resumable,
        false,
        None,
        false,
    )
    .await;

    Ok(file)
}

// Human: Insert a new files row that reuses another row's storage_key and derivative readiness.
// Agent: SKIPS Nebular PUT; COPIES HLS/thumbnail/waveform fields; RELINKS placement from source node.
#[allow(clippy::too_many_arguments)]
async fn insert_deduped_file(
    state: &Arc<AppState>,
    file_id: &str,
    user_id: &str,
    folder_id: &Option<String>,
    filename: &str,
    mime: &str,
    content_hash: &str,
    source: &DedupSource,
) -> Result<FileDto, AppError> {
    let audio_waveform_key = source.audio_waveform_key.as_ref().map(|_| {
        crate::audio::waveform_storage_key(&source.storage_key)
    });
    let video_thumbnail_manifest_key = source.video_thumbnail_manifest_key.as_ref().map(|_| {
        crate::video::thumbnail_manifest_storage_key(&source.storage_key)
    });

    let file: FileDto = sqlx::query_as(&format!(
        "INSERT INTO files (\
           id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
           storage_node_id, segment_count, \
           duration_seconds, video_width, video_height, \
           hls_ready, hls_encode_status, hls_encode_error, conversion_progress, \
           audio_waveform_ready, audio_encode_status, audio_encode_error, audio_waveform_key, \
           video_thumbnail_ready, video_thumbnail_status, video_thumbnail_error, \
           video_thumbnail_progress, video_thumbnail_selected_index, video_thumbnail_manifest_key, \
           image_thumbnail_ready, image_thumbnail_status, image_thumbnail_error, \
           document_thumbnail_ready, document_thumbnail_status, document_thumbnail_error, \
           download_export_ready\
         ) VALUES (\
           $1, $2, $3, $4, $5, $6, $7, $8, \
           $9, $10, \
           $11, $12, $13, \
           $14, $15, $16, $17, \
           $18, $19, $20, $21, \
           $22, $23, $24, \
           $25, $26, $27, \
           $28, $29, $30, \
           $31, $32, $33, \
           $34\
         ) RETURNING {FILE_COLUMNS}"
    ))
    .bind(file_id)
    .bind(user_id)
    .bind(folder_id)
    .bind(filename)
    .bind(&source.storage_key)
    .bind(mime)
    .bind(source.size_bytes)
    .bind(content_hash)
    .bind(&source.storage_node_id)
    .bind(source.segment_count)
    .bind(source.duration_seconds)
    .bind(source.video_width)
    .bind(source.video_height)
    .bind(source.hls_ready)
    .bind(&source.hls_encode_status)
    .bind(&source.hls_encode_error)
    .bind(source.conversion_progress)
    .bind(source.audio_waveform_ready)
    .bind(&source.audio_encode_status)
    .bind(&source.audio_encode_error)
    .bind(&audio_waveform_key)
    .bind(source.video_thumbnail_ready)
    .bind(&source.video_thumbnail_status)
    .bind(&source.video_thumbnail_error)
    .bind(source.video_thumbnail_progress)
    .bind(source.video_thumbnail_selected_index)
    .bind(&video_thumbnail_manifest_key)
    .bind(source.image_thumbnail_ready)
    .bind(&source.image_thumbnail_status)
    .bind(&source.image_thumbnail_error)
    .bind(source.document_thumbnail_ready)
    .bind(&source.document_thumbnail_status)
    .bind(&source.document_thumbnail_error)
    .bind(source.download_export_ready)
    .fetch_one(&state.pool)
    .await?;

    crate::storage::placement::link_file_to_placement(&state.pool, file_id, &source.storage_key)
        .await?;

    Ok(file)
}

// Human: Insert non-video files row and enqueue derivative jobs (tmp path optional when blob already in storage).
// Agent: BRANCHES audio/image/document/generic; CLEANS local work dir only when no post-upload job needs spool.
#[allow(clippy::too_many_arguments)]
async fn insert_non_video_file_and_jobs(
    state: &Arc<AppState>,
    file_id: &str,
    user_id: &str,
    folder_id: &Option<String>,
    filename: &str,
    storage_key: &str,
    mime: &str,
    size_bytes: u64,
    content_hash: &str,
    tmp_path: Option<&std::path::Path>,
) -> Result<FileDto, AppError> {
    let is_audio = mime.starts_with("audio/");
    let is_image = mime.starts_with("image/");
    let work_dir_for_cleanup = tmp_path.and_then(|path| path.parent().map(|p| p.to_path_buf()));

    if is_audio {
        let file: FileDto = sqlx::query_as(&format!(
            "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
             audio_encode_status, conversion_progress) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0) \
             RETURNING {FILE_COLUMNS}"
        ))
        .bind(file_id)
        .bind(user_id)
        .bind(folder_id)
        .bind(filename)
        .bind(storage_key)
        .bind(mime)
        .bind(size_bytes as i64)
        .bind(content_hash)
        .fetch_one(&state.pool)
        .await?;

        let payload = AudioWaveformPayload {
            file_id: file_id.to_string(),
            storage_key: storage_key.to_string(),
            tmp_audio: tmp_path.map(|p| p.to_string_lossy().to_string()),
        };

        jobs::enqueue_job(
            &state.pool,
            user_id,
            JobKind::AudioWaveform,
            filename,
            Some("file"),
            Some(file_id),
            serde_json::to_value(payload).map_err(|e| {
                AppError::Internal(anyhow::anyhow!("audio waveform job payload: {e}"))
            })?,
        )
        .await?;

        return Ok(file);
    }

    if is_image {
        let file: FileDto = sqlx::query_as(&format!(
            "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
             image_thumbnail_status) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued') \
             RETURNING {FILE_COLUMNS}"
        ))
        .bind(file_id)
        .bind(user_id)
        .bind(folder_id)
        .bind(filename)
        .bind(storage_key)
        .bind(mime)
        .bind(size_bytes as i64)
        .bind(content_hash)
        .fetch_one(&state.pool)
        .await?;

        let payload = ImageThumbnailPayload {
            file_id: file_id.to_string(),
            storage_key: storage_key.to_string(),
            tmp_source: tmp_path.map(|p| p.to_string_lossy().to_string()),
        };

        jobs::enqueue_job(
            &state.pool,
            user_id,
            JobKind::ImageThumbnail,
            filename,
            Some("file"),
            Some(file_id),
            serde_json::to_value(payload).map_err(|e| {
                AppError::Internal(anyhow::anyhow!("image thumbnail job payload: {e}"))
            })?,
        )
        .await?;

        return Ok(file);
    }

    if crate::document::mime::qualifies_for_document_grid_thumbnail(mime, filename) {
        let file: FileDto = sqlx::query_as(&format!(
            "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
             document_thumbnail_status) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued') \
             RETURNING {FILE_COLUMNS}"
        ))
        .bind(file_id)
        .bind(user_id)
        .bind(folder_id)
        .bind(filename)
        .bind(storage_key)
        .bind(mime)
        .bind(size_bytes as i64)
        .bind(content_hash)
        .fetch_one(&state.pool)
        .await?;

        let payload = DocumentThumbnailPayload {
            file_id: file_id.to_string(),
            storage_key: storage_key.to_string(),
            mime_type: mime.to_string(),
            filename: filename.to_string(),
            tmp_source: tmp_path.map(|p| p.to_string_lossy().to_string()),
        };

        jobs::enqueue_job(
            &state.pool,
            user_id,
            JobKind::DocumentThumbnail,
            filename,
            Some("file"),
            Some(file_id),
            serde_json::to_value(payload).map_err(|e| {
                AppError::Internal(anyhow::anyhow!("document thumbnail job payload: {e}"))
            })?,
        )
        .await?;

        return Ok(file);
    }

    let file: FileDto = sqlx::query_as(&format!(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {FILE_COLUMNS}"
    ))
    .bind(file_id)
    .bind(user_id)
    .bind(folder_id)
    .bind(filename)
    .bind(storage_key)
    .bind(mime)
    .bind(size_bytes as i64)
    .bind(content_hash)
    .fetch_one(&state.pool)
    .await?;

    if let Some(work_dir) = work_dir_for_cleanup {
        cleanup_upload_work_dir(&work_dir).await;
    }

    Ok(file)
}

#[allow(clippy::too_many_arguments)]
async fn write_upload_audit(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    user_id: &str,
    file_id: &str,
    filename: &str,
    size_bytes: i64,
    resumable: bool,
    deduped: bool,
    source_file_id: Option<&str>,
    staged: bool,
) {
    let mut context = serde_json::json!({
        "name": filename,
        "size_bytes": size_bytes,
        "resumable": resumable,
        "deduped": deduped,
        "staged": staged,
    });
    if let Some(source) = source_file_id {
        context["source_file_id"] = serde_json::json!(source);
    }

    audit::write_audit(
        &state.pool,
        Some(user_id),
        "files.upload",
        Some("file"),
        Some(file_id),
        Some(context),
        headers,
    )
    .await
    .ok();
}
