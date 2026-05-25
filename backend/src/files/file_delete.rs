// Human: Shared file deletion — remove DB row and storage blobs including HLS artifacts.
// Agent: READS files row; DELETE files; CALLS storage.delete; USED by single-file and folder cascade handlers.

use std::sync::Arc;

use crate::{error::AppError, AppState};

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

/// Human: Sidecar keys always attempted during purge (playlist, key, export, legacy root).
/// Agent: ADD segment_count for HLS bundles; RETURNS total storage object attempts per file.
pub const STORAGE_SIDECAR_OBJECT_COUNT: u32 = 4;

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
// Agent: CALLS delete_storage_artifacts_with_progress; INVOKES callback after each storage.delete attempt.
pub async fn delete_owned_file_row_with_progress<F>(
    state: &Arc<AppState>,
    pool: &sqlx::PgPool,
    user_id: &str,
    file_id: &str,
    mut on_blob_deleted: F,
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

    delete_storage_artifacts_with_progress(state, &storage_key, segment_count, &mut on_blob_deleted)
        .await;

    Ok(OwnedFileRow {
        id: file_id.to_string(),
        name,
        storage_key,
        segment_count,
    })
}

// Agent: INCREMENTS deleted count after each delete attempt; CALLS on_blob_deleted(deleted, total).
async fn delete_storage_artifacts_with_progress<F>(
    state: &Arc<AppState>,
    storage_key: &str,
    segment_count: Option<i32>,
    on_blob_deleted: &mut F,
)
where
    F: FnMut(u32, u32),
{
    let total = storage_object_count(segment_count);
    let mut deleted = 0u32;

    let bump = |deleted: &mut u32, on_blob_deleted: &mut F| {
        *deleted = deleted.saturating_add(1);
        on_blob_deleted(*deleted, total);
    };

    let _ = state
        .storage
        .delete(&format!("{storage_key}/stream.m3u8"))
        .await;
    bump(&mut deleted, on_blob_deleted);

    let _ = state.storage.delete(&format!("{storage_key}/key.bin")).await;
    bump(&mut deleted, on_blob_deleted);

    let _ = state
        .storage
        .delete(&format!("{storage_key}/{EXPORT_OBJECT_SUFFIX}"))
        .await;
    bump(&mut deleted, on_blob_deleted);

    if let Some(count) = segment_count {
        for i in 0..count.max(0) {
            let name = format!("{i:04}.ts");
            let _ = state
                .storage
                .delete(&format!("{storage_key}/segments/{name}"))
                .await;
            bump(&mut deleted, on_blob_deleted);
        }
    }

    // Human: Legacy uploads may still have a blob at the root storage key.
    // Agent: BEST-EFFORT DELETE root key after HLS cleanup.
    let _ = state.storage.delete(storage_key).await;
    bump(&mut deleted, on_blob_deleted);
}
