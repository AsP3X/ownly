// Human: Shared file deletion — remove DB row and storage blobs including HLS artifacts.
// Agent: READS files row; DELETE files; CALLS storage.delete; USED by single-file and folder cascade handlers.

use std::sync::Arc;

use crate::{error::AppError, storage::Storage, AppState};

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

/// Human: Sidecar keys always attempted during purge (playlist, key, export, legacy root).
/// Agent: ADD segment_count for HLS bundles; RETURNS total storage object attempts per file.
pub const STORAGE_SIDECAR_OBJECT_COUNT: u32 = 6;

#[derive(Debug, Clone)]
pub struct OwnedFileRow {
    pub id: String,
    pub name: String,
    pub storage_key: String,
    pub segment_count: Option<i32>,
}

// Human: Count storage delete attempts for one file row (matches delete_storage_artifacts).
// Agent: READS segment_count; RETURNS 4 fixed sidecars + max(segments, 0).
pub fn storage_object_count(segment_count: Option<i32>) -> u32 {
    STORAGE_SIDECAR_OBJECT_COUNT.saturating_add(segment_count.unwrap_or(0).max(0) as u32)
}

// Human: Known object keys for a file row when Nebular list is unavailable.
// Agent: RETURNS sidecars + numbered segments when segment_count is Some; USED as list fallback.
pub fn storage_keys_for_file(storage_key: &str, segment_count: Option<i32>) -> Vec<String> {
    let mut keys = vec![
        format!("{storage_key}/stream.m3u8"),
        format!("{storage_key}/key.bin"),
        format!("{storage_key}/init.mp4"),
        format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}"),
        format!("{storage_key}/{}", crate::audio::WAVEFORM_OBJECT_SUFFIX),
        storage_key.to_string(),
    ];
    if let Some(count) = segment_count {
        for i in 0..count.max(0) {
            keys.push(format!(
                "{storage_key}/segments/{i:04}.{}",
                crate::hls::playlist::HLS_SEGMENT_EXTENSION
            ));
            keys.push(format!("{storage_key}/segments/{i:04}.ts"));
        }
    }
    keys
}

// Human: Resolve every Nebular key to delete for a file — prefers prefix listing for partial HLS uploads.
// Agent: CALLS list_keys_with_prefix on `{storage_key}/`; FALLBACK to storage_keys_for_file when list empty.
async fn collect_storage_keys(
    storage: &Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
) -> Vec<String> {
    let prefix = format!("{storage_key}/");
    if let Ok(listed) = storage.list_keys_with_prefix(&prefix).await {
        if !listed.is_empty() {
            let mut keys = listed;
            if !keys.iter().any(|key| key == storage_key) {
                keys.push(storage_key.to_string());
            }
            return keys;
        }
    }

    storage_keys_for_file(storage_key, segment_count)
}

// Human: Best-effort purge of every object associated with a storage key (cancel, delete, failed ingest).
// Agent: READS keys via collect_storage_keys; CALLS storage.delete for each; IGNORES individual delete errors.
pub async fn purge_file_storage(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
) {
    purge_file_storage_with_progress(storage, storage_key, segment_count, |_, _| {}).await;
}

// Human: Same as purge_file_storage but reports blob purge progress for delete job polling.
// Agent: INCREMENTS deleted count after each delete attempt; CALLS on_blob_deleted(deleted, total).
pub async fn purge_file_storage_with_progress<F>(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    mut on_blob_deleted: F,
)
where
    F: FnMut(u32, u32),
{
    let keys = collect_storage_keys(&storage, storage_key, segment_count).await;
    let total = keys.len() as u32;
    let mut deleted = 0u32;

    for key in keys {
        let _ = storage.delete(&key).await;
        deleted = deleted.saturating_add(1);
        on_blob_deleted(deleted, total);
    }
}

// Human: Delete one user-owned file row and best-effort purge its object storage keys.
// Agent: DELETE files WHERE id+user_id; REMOVES root blob + HLS sidecar objects; RETURNS row metadata.
pub async fn delete_owned_file_row(
    state: &Arc<AppState>,
    pool: &sqlx::PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<OwnedFileRow, AppError> {
    delete_owned_file_row_with_progress(state, pool, user_id, file_id, |_, _| {}).await
}

// Human: Same as delete_owned_file_row but reports blob purge progress for delete job polling.
// Agent: CALLS purge_file_storage_with_progress; INVOKES callback after each storage.delete attempt.
pub async fn delete_owned_file_row_with_progress<F>(
    state: &Arc<AppState>,
    pool: &sqlx::PgPool,
    user_id: &str,
    file_id: &str,
    on_blob_deleted: F,
) -> Result<OwnedFileRow, AppError>
where
    F: FnMut(u32, u32),
{
    let row: Option<(String, String, Option<i32>)> = sqlx::query_as(
        "SELECT storage_key, name, segment_count FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let (storage_key, name, segment_count) = row.ok_or(AppError::NotFound)?;

    sqlx::query("DELETE FROM files WHERE id = $1 AND user_id = $2")
        .bind(file_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    purge_file_storage_with_progress(
        state.storage.clone(),
        &storage_key,
        segment_count,
        on_blob_deleted,
    )
    .await;

    Ok(OwnedFileRow {
        id: file_id.to_string(),
        name,
        storage_key,
        segment_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::memory::MemoryStorage;

    #[test]
    fn storage_object_count_matches_delete_attempts() {
        assert_eq!(storage_object_count(None), 5);
        assert_eq!(storage_object_count(Some(0)), 5);
        assert_eq!(storage_object_count(Some(12)), 17);
    }

    #[tokio::test]
    async fn purge_file_storage_lists_partial_hls_prefix_objects() {
        let storage = Arc::new(MemoryStorage::new()) as Arc<dyn Storage>;
        storage
            .put(
                "users/u1/files/f1/segments/0000.ts",
                "video/mp2t",
                vec![1, 2, 3],
            )
            .await
            .expect("put segment");
        storage
            .put(
                "users/u1/files/f1/stream.m3u8",
                "application/vnd.apple.mpegurl",
                vec![4],
            )
            .await
            .expect("put playlist");

        purge_file_storage(storage.clone(), "users/u1/files/f1", None).await;

        assert!(
            !storage
                .exists("users/u1/files/f1/segments/0000.ts")
                .await
                .expect("exists segment")
        );
        assert!(
            !storage
                .exists("users/u1/files/f1/stream.m3u8")
                .await
                .expect("exists playlist")
        );
    }
}
