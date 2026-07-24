// Human: Compute SHA-256 digests and look up per-user content duplicates for upload finalize.
// Agent: READS spool paths / files rows; RETURNS hex digests + optional DedupSource for shared storage_key.

use std::path::Path;

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::io::AsyncReadExt;

use crate::error::AppError;

const HASH_READ_BUFFER_BYTES: usize = 1024 * 1024;

/// Human: An active file row that already holds the same bytes for this user (content_hash match).
/// Agent: USED by upload_finalize to skip Nebular PUT and share storage_key + derivatives.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DedupSource {
    pub id: String,
    pub storage_key: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub storage_node_id: Option<String>,
    pub segment_count: Option<i32>,
    pub hls_ready: bool,
    pub hls_encode_status: Option<String>,
    pub hls_encode_error: Option<String>,
    pub conversion_progress: i32,
    pub duration_seconds: Option<i32>,
    pub video_width: Option<i32>,
    pub video_height: Option<i32>,
    pub audio_waveform_ready: bool,
    pub audio_encode_status: Option<String>,
    pub audio_encode_error: Option<String>,
    pub audio_waveform_key: Option<String>,
    pub video_thumbnail_ready: bool,
    pub video_thumbnail_status: Option<String>,
    pub video_thumbnail_error: Option<String>,
    pub video_thumbnail_progress: i32,
    pub video_thumbnail_selected_index: i32,
    pub video_thumbnail_manifest_key: Option<String>,
    pub image_thumbnail_ready: bool,
    pub image_thumbnail_status: Option<String>,
    pub image_thumbnail_error: Option<String>,
    pub document_thumbnail_ready: bool,
    pub document_thumbnail_status: Option<String>,
    pub document_thumbnail_error: Option<String>,
    pub download_export_ready: bool,
}

// Human: Stream a spooled upload file through SHA-256 without loading it entirely into RAM.
// Agent: READS path via tokio::fs::File; RETURNS 64-char lowercase hex digest.
pub async fn hash_file_sha256(path: &Path) -> Result<String, AppError> {
    let mut file = tokio::fs::File::open(path).await.map_err(|error| {
        AppError::Internal(anyhow::anyhow!("open upload spool for hashing: {error}"))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_READ_BUFFER_BYTES];

    loop {
        let read_bytes = file.read(&mut buffer).await.map_err(|error| {
            AppError::Internal(anyhow::anyhow!("read upload spool for hashing: {error}"))
        })?;
        if read_bytes == 0 {
            break;
        }
        hasher.update(&buffer[..read_bytes]);
    }

    Ok(hex::encode(hasher.finalize()))
}

// Human: Find an active same-user file with identical content_hash and size for per-user dedup.
// Agent: READS files WHERE deleted_at IS NULL; RETURNS oldest match; video only when hls_ready.
pub async fn find_dedup_source(
    pool: &PgPool,
    user_id: &str,
    content_hash: &str,
    size_bytes: i64,
    is_video: bool,
) -> Result<Option<DedupSource>, AppError> {
    if content_hash.is_empty() {
        return Ok(None);
    }

    let source: Option<DedupSource> = sqlx::query_as(
        "SELECT id, storage_key, mime_type, size_bytes, storage_node_id, segment_count, \
         hls_ready, hls_encode_status, hls_encode_error, conversion_progress, duration_seconds, \
         video_width, video_height, \
         audio_waveform_ready, audio_encode_status, audio_encode_error, audio_waveform_key, \
         video_thumbnail_ready, video_thumbnail_status, video_thumbnail_error, \
         video_thumbnail_progress, video_thumbnail_selected_index, video_thumbnail_manifest_key, \
         image_thumbnail_ready, image_thumbnail_status, image_thumbnail_error, \
         document_thumbnail_ready, document_thumbnail_status, document_thumbnail_error, \
         download_export_ready \
         FROM files \
         WHERE user_id = $1 AND content_hash = $2 AND size_bytes = $3 AND deleted_at IS NULL \
         ORDER BY created_at ASC \
         LIMIT 1",
    )
    .bind(user_id)
    .bind(content_hash)
    .bind(size_bytes)
    .fetch_optional(pool)
    .await?;

    let Some(source) = source else {
        return Ok(None);
    };

    // Human: Video HLS encodes write into storage_key — only share after the source bundle is ready.
    if is_video && !source.hls_ready {
        return Ok(None);
    }

    Ok(Some(source))
}

// Human: Find a soft-deleted same-user file with matching hash — offer restore instead of re-upload.
// Agent: READS files WHERE deleted_at IS NOT NULL; RETURNS oldest trash id; USED by create_session.
pub async fn find_trashed_dedup_file_id(
    pool: &PgPool,
    user_id: &str,
    content_hash: &str,
    size_bytes: i64,
) -> Result<Option<String>, AppError> {
    if content_hash.is_empty() {
        return Ok(None);
    }
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM files \
         WHERE user_id = $1 AND content_hash = $2 AND size_bytes = $3 AND deleted_at IS NOT NULL \
         ORDER BY deleted_at DESC \
         LIMIT 1",
    )
    .bind(user_id)
    .bind(content_hash)
    .bind(size_bytes)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

// Human: True when any files row still references this storage_key (including recycle bin).
// Agent: USED before purge_file_storage so shared-blob dedup copies keep the object alive.
pub async fn storage_key_still_referenced(pool: &PgPool, storage_key: &str) -> Result<bool, AppError> {
    let row: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM files WHERE storage_key = $1 LIMIT 1",
    )
    .bind(storage_key)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

#[cfg(test)]
mod tests {
    use super::hash_file_sha256;
    use sha2::{Digest, Sha256};
    use std::io::Write;

    // Human: REGRESSION — hashing must match a known SHA-256 digest for fixed bytes.
    // Agent: WRITES temp file; ASSERTS hash_file_sha256 equals manual digest.
    #[tokio::test]
    async fn hash_file_sha256_matches_expected_digest() {
        let mut temp = tempfile::NamedTempFile::new().expect("temp file");
        temp.write_all(b"ownly-content-hash-test")
            .expect("write temp");
        temp.flush().expect("flush temp");

        let expected = hex::encode(Sha256::digest(b"ownly-content-hash-test"));
        let actual = hash_file_sha256(temp.path())
            .await
            .expect("hash temp file");

        assert_eq!(actual, expected);
    }
}
