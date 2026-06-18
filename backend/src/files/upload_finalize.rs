// Human: Finalize a spooled upload temp file into Postgres + object storage (shared by simple and chunked uploads).
// Agent: READS tmp_path; WRITES files row + jobs; AUDIT files.upload; CALLS upload_spool helpers.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::http::HeaderMap;

use crate::{
    audit,
    error::AppError,
    files::{
        handlers::{FileDto, FILE_COLUMNS},
        upload_spool::{cleanup_upload_work_dir, storage_put_spooled_file, upload_is_video},
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
/// Agent: PASSED from multipart upload or resumable session complete handler.
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

    let content_hash =
        crate::files::content_hash::hash_file_sha256(&input.tmp_path).await?;

    let is_video = upload_is_video(&input.filename, &input.mime);
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
        let is_audio = input.mime.starts_with("audio/");
        let is_image = input.mime.starts_with("image/");

        tracing::info!(
            request_id = %request_id.0,
            file_id = %input.file_id,
            storage_key = %input.storage_key,
            size_bytes = input.size_bytes,
            is_video = false,
            is_audio,
            is_image,
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

        let file = if is_audio {
            let file: FileDto = sqlx::query_as(&format!(
                "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
                 audio_encode_status, conversion_progress) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0) \
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
            .fetch_one(&state.pool)
            .await?;

            let payload = AudioWaveformPayload {
                file_id: input.file_id.clone(),
                storage_key: input.storage_key.clone(),
                tmp_audio: Some(input.tmp_path.to_string_lossy().to_string()),
            };

            jobs::enqueue_job(
                &state.pool,
                &input.user_id,
                JobKind::AudioWaveform,
                &input.filename,
                Some("file"),
                Some(&input.file_id),
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
            .bind(&input.file_id)
            .bind(&input.user_id)
            .bind(&input.folder_id)
            .bind(&input.filename)
            .bind(&input.storage_key)
            .bind(&input.mime)
            .bind(input.size_bytes as i64)
            .bind(&content_hash)
            .fetch_one(&state.pool)
            .await?;

            let payload = ImageThumbnailPayload {
                file_id: input.file_id.clone(),
                storage_key: input.storage_key.clone(),
                tmp_source: Some(input.tmp_path.to_string_lossy().to_string()),
            };

            jobs::enqueue_job(
                &state.pool,
                &input.user_id,
                JobKind::ImageThumbnail,
                &input.filename,
                Some("file"),
                Some(&input.file_id),
                serde_json::to_value(payload).map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("image thumbnail job payload: {e}"))
                })?,
            )
            .await?;

            file
        } else if crate::document::mime::qualifies_for_document_grid_thumbnail(
            &input.mime,
            &input.filename,
        ) {
            let file: FileDto = sqlx::query_as(&format!(
                "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash, \
                 document_thumbnail_status) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued') \
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
            .fetch_one(&state.pool)
            .await?;

            let payload = DocumentThumbnailPayload {
                file_id: input.file_id.clone(),
                storage_key: input.storage_key.clone(),
                mime_type: input.mime.clone(),
                filename: input.filename.clone(),
                tmp_source: Some(input.tmp_path.to_string_lossy().to_string()),
            };

            jobs::enqueue_job(
                &state.pool,
                &input.user_id,
                JobKind::DocumentThumbnail,
                &input.filename,
                Some("file"),
                Some(&input.file_id),
                serde_json::to_value(payload).map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("document thumbnail job payload: {e}"))
                })?,
            )
            .await?;

            file
        } else {
            let file: FileDto = sqlx::query_as(&format!(
                "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {FILE_COLUMNS}"
            ))
            .bind(&input.file_id)
            .bind(&input.user_id)
            .bind(&input.folder_id)
            .bind(&input.filename)
            .bind(&input.storage_key)
            .bind(&input.mime)
            .bind(input.size_bytes as i64)
            .bind(&content_hash)
            .fetch_one(&state.pool)
            .await?;
            cleanup_upload_work_dir(&input.work_dir).await;
            file
        };

        file
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

    audit::write_audit(
        &state.pool,
        Some(&input.user_id),
        "files.upload",
        Some("file"),
        Some(&input.file_id),
        Some(serde_json::json!({
            "name": input.filename,
            "size_bytes": file.size_bytes,
            "resumable": input.resumable
        })),
        headers,
    )
    .await
    .ok();

    Ok(file)
}
