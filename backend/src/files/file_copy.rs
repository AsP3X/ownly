// Human: Duplicate a file's storage blobs and metadata into a new library row.
// Agent: READS source storage_key; WRITES new storage_key prefix; COPIES HLS sidecars + segments.

use std::collections::HashSet;
use std::sync::Arc;

use futures_util::StreamExt;

use crate::{error::AppError, files::file_delete::storage_keys_for_file, AppState};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CopyFileSourceRow {
    pub storage_key: String,
    pub segment_count: Option<i32>,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub hls_ready: bool,
    pub hls_encode_status: Option<String>,
    pub hls_encode_error: Option<String>,
    pub conversion_progress: i32,
    pub duration_seconds: Option<i32>,
    pub audio_waveform_ready: bool,
    pub audio_encode_status: Option<String>,
    pub audio_waveform_key: Option<String>,
}

// Human: Copy every storage object associated with a file row into a new key prefix.
// Agent: BEST-EFFORT skip missing keys (matches delete semantics); STREAMS source then PUT dest.
pub async fn copy_storage_artifacts(
    state: &Arc<AppState>,
    source_key: &str,
    dest_key: &str,
    segment_count: Option<i32>,
) -> Result<(), AppError> {
    let keys = storage_keys_for_file(source_key, segment_count);
    for key in keys {
        let dest = key.replacen(source_key, dest_key, 1);
        copy_storage_object(state, &key, &dest).await?;
    }
    Ok(())
}

async fn copy_storage_object(
    state: &Arc<AppState>,
    source_key: &str,
    dest_key: &str,
) -> Result<(), AppError> {
    let exists = state
        .storage
        .exists(source_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if !exists {
        return Ok(());
    }

    let (mut stream, _, content_type) = state
        .storage
        .get_stream(source_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Storage(e.to_string()))?;
        data.extend_from_slice(&chunk);
    }

    state
        .storage
        .put(dest_key, &content_type, data)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(())
}

// Human: Pick a display name that does not collide with siblings in the target folder.
// Agent: READS existing names; APPENDS " (N)" before extension when needed.
pub async fn unique_name_in_folder(
    pool: &sqlx::PgPool,
    user_id: &str,
    folder_id: &Option<String>,
    base_name: &str,
) -> Result<String, sqlx::Error> {
    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM files WHERE user_id = $1 \
         AND (($2::text IS NULL AND folder_id IS NULL) OR folder_id = $2)",
    )
    .bind(user_id)
    .bind(folder_id)
    .fetch_all(pool)
    .await?;

    let taken: HashSet<String> = existing.into_iter().collect();
    if !taken.contains(base_name) {
        return Ok(base_name.to_string());
    }

    let mut index = 2u32;
    loop {
        let candidate = disambiguate_filename(base_name, index);
        if !taken.contains(&candidate) {
            return Ok(candidate);
        }
        index = index.saturating_add(1);
    }
}

fn disambiguate_filename(name: &str, index: u32) -> String {
    if let Some((stem, ext)) = name.rsplit_once('.') {
        if !ext.contains('/') && !ext.contains('\\') {
            return format!("{stem} ({index}).{ext}");
        }
    }
    format!("{name} ({index})")
}
