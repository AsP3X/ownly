// Human: Shared file deletion — remove DB row and storage blobs including HLS artifacts.
// Agent: READS files row; DELETE files; CALLS storage.delete/delete_prefix; USED by delete jobs and handlers.

use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

use futures_util::stream::{self, StreamExt};
use sqlx::PgPool;

use crate::{
    error::AppError,
    files::delete_config::{DELETE_BLOB_CONCURRENCY, DELETE_FILE_CONCURRENCY},
    storage::Storage,
    AppState,
};

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

/// Human: Sidecar keys always attempted during purge (playlist, key, export, legacy root).
/// Agent: ADD segment_count for HLS bundles; RETURNS total storage object attempts per file.
pub const STORAGE_SIDECAR_OBJECT_COUNT: u32 = 14;

#[derive(Debug, Clone)]
pub struct OwnedFileRow {
    pub id: String,
    pub name: String,
    pub storage_key: String,
    pub segment_count: Option<i32>,
}

/// Human: File metadata needed to purge storage after the DB row is already gone.
/// Agent: LOADED by delete jobs; CONTAINS mime_type for prefix-list skip heuristics.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FilePurgeRow {
    pub id: String,
    pub name: String,
    pub storage_key: String,
    pub segment_count: Option<i32>,
    pub mime_type: Option<String>,
}

// Human: Count storage delete attempts for one file row (matches delete_storage_artifacts).
// Agent: READS segment_count; RETURNS 4 fixed sidecars + max(segments, 0).
pub fn storage_object_count(segment_count: Option<i32>) -> u32 {
    STORAGE_SIDECAR_OBJECT_COUNT.saturating_add(segment_count.unwrap_or(0).max(0) as u32)
}

// Human: Skip Nebular LIST for finished image uploads — sidecar keys are deterministic.
// Agent: TRUE when mime is image/* and there are no HLS segments to discover.
pub fn should_skip_prefix_listing(mime_type: &Option<String>, segment_count: Option<i32>) -> bool {
    let has_segments = segment_count.is_some_and(|count| count > 0);
    if has_segments {
        return false;
    }
    mime_type
        .as_deref()
        .is_some_and(|mime| mime.to_ascii_lowercase().starts_with("image/"))
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
        format!("{storage_key}/{}", crate::video::THUMBNAIL_MANIFEST_SUFFIX),
        crate::image::grid_thumbnail_storage_key(storage_key),
        crate::files::gif_preview::gif_preview_object_key(storage_key),
        crate::files::gif_preview::gif_preview_meta_object_key(storage_key),
        storage_key.to_string(),
    ];
    for index in 0..crate::video::thumbnail::THUMBNAIL_OPTION_COUNT {
        keys.push(crate::video::thumbnail_option_storage_key(
            storage_key,
            index as u32,
        ));
    }
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
// Agent: SKIPS list for simple images; CALLS list_keys_with_prefix otherwise; FALLBACK to storage_keys_for_file.
async fn collect_storage_keys(
    storage: &Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    mime_type: &Option<String>,
) -> Vec<String> {
    if should_skip_prefix_listing(mime_type, segment_count) {
        return storage_keys_for_file(storage_key, segment_count);
    }

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

// Human: Delete many object keys concurrently and bump an optional shared progress counter.
// Agent: USES DELETE_BLOB_CONCURRENCY; IGNORES individual delete errors (best-effort purge).
async fn delete_keys_parallel(
    storage: Arc<dyn Storage>,
    keys: Vec<String>,
    progress: Option<Arc<AtomicU32>>,
) {
    stream::iter(keys)
        .for_each_concurrent(DELETE_BLOB_CONCURRENCY, |key| {
            let storage = storage.clone();
            let progress = progress.clone();
            async move {
                let _ = storage.delete(&key).await;
                if let Some(counter) = progress {
                    counter.fetch_add(1, Ordering::Relaxed);
                }
            }
        })
        .await;
}

// Human: Purge every object under a file prefix — prefers Nebular bulk DELETE when available.
// Agent: CALLS storage.delete_prefix; FALLBACK collect_storage_keys + parallel per-key delete.
async fn purge_storage_keys(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    mime_type: &Option<String>,
    progress: Option<Arc<AtomicU32>>,
) {
    let prefix = format!("{storage_key}/");
    if let Ok(deleted) = storage.delete_prefix(&prefix).await {
        if deleted > 0 {
            let _ = storage.delete(storage_key).await;
            if let Some(counter) = progress {
                counter.fetch_add(deleted.saturating_add(1), Ordering::Relaxed);
            }
            return;
        }
    }

    let keys = collect_storage_keys(&storage, storage_key, segment_count, mime_type).await;
    delete_keys_parallel(storage, keys, progress).await;
}

// Human: Best-effort purge of every object associated with a storage key (cancel, delete, failed ingest).
// Agent: READS keys via collect_storage_keys; CALLS parallel storage.delete; IGNORES individual errors.
pub async fn purge_file_storage(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
) {
    purge_file_storage_with_mime(storage, storage_key, segment_count, None, None).await;
}

// Human: Same as purge_file_storage but reports blob purge progress for delete job polling.
// Agent: INCREMENTS optional AtomicU32 after each delete attempt; CALLS on_blob_deleted(deleted, total).
pub async fn purge_file_storage_with_progress<F>(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    mut on_blob_deleted: F,
) where
    F: FnMut(u32, u32),
{
    let counter = Arc::new(AtomicU32::new(0));
    let reporter = counter.clone();
    let expected = storage_object_count(segment_count);
    purge_storage_keys(
        storage,
        storage_key,
        segment_count,
        &None,
        Some(counter),
    )
    .await;
    let deleted = reporter.load(Ordering::Relaxed);
    let total = deleted.max(expected);
    on_blob_deleted(total.min(deleted.max(1)), total);
}

// Human: Purge storage for one file row with mime-aware key resolution and atomic progress.
// Agent: CALLS purge_storage_keys; USED by deferred delete jobs after DB rows are removed.
pub async fn purge_file_storage_with_mime(
    storage: Arc<dyn Storage>,
    storage_key: &str,
    segment_count: Option<i32>,
    mime_type: Option<&str>,
    progress: Option<Arc<AtomicU32>>,
) {
    let mime = mime_type.map(|value| value.to_string());
    purge_storage_keys(storage, storage_key, segment_count, &mime, progress).await;
}

// Human: Load purge metadata for owned files before batch DB delete.
// Agent: SELECT id, name, storage_key, segment_count, mime_type; ERRORS when any id is missing.
pub async fn load_owned_files_for_purge(
    pool: &PgPool,
    user_id: &str,
    file_ids: &[String],
) -> Result<Vec<FilePurgeRow>, AppError> {
    let rows: Vec<FilePurgeRow> = sqlx::query_as(
        "SELECT id, name, storage_key, segment_count, mime_type FROM files \
         WHERE user_id = $1 AND id = ANY($2) ORDER BY name ASC",
    )
    .bind(user_id)
    .bind(file_ids)
    .fetch_all(pool)
    .await?;

    if rows.len() != file_ids.len() {
        return Err(AppError::NotFound);
    }

    Ok(rows)
}

// Human: Remove many owned file rows in one statement (deferred purge — DB first, blobs after).
// Agent: DELETE files WHERE user_id AND id = ANY; RETURNS rows loaded before delete for storage purge.
pub async fn batch_delete_owned_file_rows(
    pool: &PgPool,
    user_id: &str,
    file_ids: &[String],
) -> Result<Vec<FilePurgeRow>, AppError> {
    let rows = load_owned_files_for_purge(pool, user_id, file_ids).await?;
    sqlx::query("DELETE FROM files WHERE user_id = $1 AND id = ANY($2)")
        .bind(user_id)
        .bind(file_ids)
        .execute(pool)
        .await?;
    Ok(rows)
}

// Human: Purge storage for many files concurrently after their DB rows are already deleted.
// Agent: for_each_concurrent DELETE_FILE_CONCURRENCY; UPDATES shared blob progress counter.
pub async fn parallel_purge_file_rows(
    storage: Arc<dyn Storage>,
    rows: Vec<FilePurgeRow>,
    progress: Option<Arc<AtomicU32>>,
) {
    stream::iter(rows)
        .for_each_concurrent(DELETE_FILE_CONCURRENCY, |row| {
            let storage = storage.clone();
            let progress = progress.clone();
            async move {
                purge_file_storage_with_mime(
                    storage,
                    &row.storage_key,
                    row.segment_count,
                    row.mime_type.as_deref(),
                    progress,
                )
                .await;
            }
        })
        .await;
}

// Human: Delete one user-owned file row and best-effort purge its object storage keys.
// Agent: DELETE files WHERE id+user_id; REMOVES root blob + HLS sidecar objects; RETURNS row metadata.
pub async fn delete_owned_file_row(
    state: &Arc<AppState>,
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<OwnedFileRow, AppError> {
    delete_owned_file_row_with_progress(state, pool, user_id, file_id, |_, _| {}).await
}

// Human: Same as delete_owned_file_row but reports blob purge progress for delete job polling.
// Agent: CALLS purge_storage_keys; INVOKES callback after purge completes.
pub async fn delete_owned_file_row_with_progress<F>(
    state: &Arc<AppState>,
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
    mut on_blob_deleted: F,
) -> Result<OwnedFileRow, AppError>
where
    F: FnMut(u32, u32),
{
    let row: Option<(String, String, Option<i32>, Option<String>)> = sqlx::query_as(
        "SELECT storage_key, name, segment_count, mime_type FROM files \
         WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let (storage_key, name, segment_count, mime_type) = row.ok_or(AppError::NotFound)?;

    sqlx::query("DELETE FROM files WHERE id = $1 AND user_id = $2")
        .bind(file_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    let counter = Arc::new(AtomicU32::new(0));
    let reporter = counter.clone();
    let expected = storage_object_count(segment_count);
    purge_storage_keys(
        state.storage.clone(),
        &storage_key,
        segment_count,
        &mime_type,
        Some(counter),
    )
    .await;
    let deleted = reporter.load(Ordering::Relaxed);
    let total = deleted.max(expected);
    on_blob_deleted(total.min(deleted.max(1)), total);

    Ok(OwnedFileRow {
        id: file_id.to_string(),
        name,
        storage_key,
        segment_count,
    })
}

// Human: Permanent-delete many owned files — batch DB removal then parallel blob purge.
// Agent: CALLS batch_delete_owned_file_rows + parallel_purge_file_rows; RETURNS purged row metadata.
pub async fn permanent_delete_owned_files(
    state: &Arc<AppState>,
    pool: &PgPool,
    user_id: &str,
    file_ids: &[String],
    progress: Option<Arc<AtomicU32>>,
) -> Result<Vec<FilePurgeRow>, AppError> {
    let rows = batch_delete_owned_file_rows(pool, user_id, file_ids).await?;
    parallel_purge_file_rows(state.storage.clone(), rows.clone(), progress).await;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::memory::MemoryStorage;

    #[test]
    fn storage_object_count_matches_delete_attempts() {
        assert_eq!(storage_object_count(None), 12);
        assert_eq!(storage_object_count(Some(0)), 12);
        assert_eq!(storage_object_count(Some(12)), 24);
    }

    #[test]
    fn skip_prefix_listing_for_images_without_segments() {
        assert!(should_skip_prefix_listing(
            &Some("image/jpeg".into()),
            None
        ));
        assert!(!should_skip_prefix_listing(
            &Some("video/mp4".into()),
            None
        ));
        assert!(!should_skip_prefix_listing(
            &Some("image/png".into()),
            Some(4)
        ));
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

    #[tokio::test]
    async fn parallel_purge_removes_image_sidecars_without_listing() {
        let storage = Arc::new(MemoryStorage::new()) as Arc<dyn Storage>;
        let key = "users/u1/files/img1";
        storage
            .put(key, "image/jpeg", vec![1, 2])
            .await
            .expect("put root");
        storage
            .put(
                &crate::image::grid_thumbnail_storage_key(key),
                "image/jpeg",
                vec![3],
            )
            .await
            .expect("put thumb");

        let rows = vec![FilePurgeRow {
            id: "f1".into(),
            name: "photo.jpg".into(),
            storage_key: key.into(),
            segment_count: None,
            mime_type: Some("image/jpeg".into()),
        }];
        parallel_purge_file_rows(storage.clone(), rows, None).await;

        assert!(!storage.exists(key).await.expect("exists root"));
    }
}
