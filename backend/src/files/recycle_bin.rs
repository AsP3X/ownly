// Human: Recycle bin — soft delete, restore, manual empty, and 30-day automatic purge.
// Agent: WRITES files.deleted_at / folders.deleted_at; CALLS delete_owned_file_row on permanent purge.

use std::sync::Arc;

use axum::{
    extract::State,
    http::HeaderMap,
    Extension, Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::delete_job::{self, BulkDeletionPreviewResponse},
    files::file_delete::delete_owned_file_row,
    AppState,
};

/// Human: Items in recycle bin are purged permanently after this many days.
/// Agent: USED by list expiry_at and background purge_expired_recycle_bin.
pub const RECYCLE_BIN_RETENTION_DAYS: i64 = 30;

/// Human: SQL fragment restricting queries to active (non-deleted) file rows.
/// Agent: APPEND to WHERE clauses on drive listings and file lookups.
pub const ACTIVE_FILES_SQL: &str = "deleted_at IS NULL";

/// Human: Active-file filter when `files` is aliased as `f` in JOIN listings.
/// Agent: USE as a whole predicate in dynamic SQL; do not split `f.` from [`ACTIVE_FILES_SQL`].
pub const F_ACTIVE_FILES_SQL: &str = "f.deleted_at IS NULL";

/// Human: SQL fragment restricting queries to active (non-deleted) folder rows.
/// Agent: APPEND to WHERE clauses on folder listings and tree walks.
pub const ACTIVE_FOLDERS_SQL: &str = "deleted_at IS NULL";

/// Human: Active-folder filter when `folders` is aliased as `fo` in JOIN listings.
/// Agent: USE as a whole predicate in dynamic SQL; do not split `fo.` from [`ACTIVE_FOLDERS_SQL`].
pub const FO_ACTIVE_FOLDERS_SQL: &str = "fo.deleted_at IS NULL";

#[derive(Debug, Serialize)]
pub struct RecycleBinFileItem {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub deleted_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct RecycleBinFolderItem {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub file_count: i64,
    pub deleted_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct RecycleBinResponse {
    pub files: Vec<RecycleBinFileItem>,
    pub folders: Vec<RecycleBinFolderItem>,
    pub total_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct RestoreRecycleBinRequest {
    pub file_ids: Vec<String>,
    pub folder_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    pub permanent: bool,
}

// Human: Compute when a soft-deleted row will be auto-purged.
// Agent: RETURNS deleted_at + RECYCLE_BIN_RETENTION_DAYS.
fn expires_at(deleted_at: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc> {
    deleted_at + Duration::days(RECYCLE_BIN_RETENTION_DAYS)
}

// Human: Revoke active public links when a file or folder enters the recycle bin.
// Agent: UPDATE public_shares SET revoked_at WHERE resource matches and not already revoked.
async fn revoke_shares_for_resource(
    pool: &sqlx::PgPool,
    user_id: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE public_shares SET revoked_at = now() \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .bind(resource_type)
    .bind(resource_id)
    .execute(pool)
    .await?;
    Ok(())
}

// Human: Mark one owned file as deleted without touching object storage blobs.
// Agent: UPDATE files SET deleted_at; REVOKES file shares; RETURNS name for audit.
pub async fn soft_delete_owned_file(
    pool: &sqlx::PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<String, AppError> {
    let row: Option<(String, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT name, deleted_at FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some((name, deleted_at)) = row else {
        return Err(AppError::NotFound);
    };

    if deleted_at.is_some() {
        return Ok(name);
    }

    sqlx::query(
        "UPDATE files SET deleted_at = now(), updated_at = now() \
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    revoke_shares_for_resource(pool, user_id, "file", file_id)
        .await
        .ok();

    Ok(name)
}

// Human: Soft-delete a folder and every nested subfolder and file in one transaction.
// Agent: BFS folders; UPDATE deleted_at on subtree; REVOKES folder share once at root.
pub async fn soft_delete_owned_folder(
    pool: &sqlx::PgPool,
    user_id: &str,
    folder_id: &str,
) -> Result<String, AppError> {
    let row: Option<(String, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT name, deleted_at FROM folders WHERE id = $1 AND user_id = $2",
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some((name, deleted_at)) = row else {
        return Err(AppError::NotFound);
    };

    if deleted_at.is_some() {
        return Ok(name);
    }

    let mut folder_ids = vec![folder_id.to_string()];
    let mut queue = vec![folder_id.to_string()];

    while let Some(current_id) = queue.pop() {
        let children: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM folders WHERE user_id = $1 AND parent_id = $2 AND deleted_at IS NULL",
        )
        .bind(user_id)
        .bind(&current_id)
        .fetch_all(pool)
        .await?;

        for (child_id,) in children {
            queue.push(child_id.clone());
            folder_ids.push(child_id);
        }
    }

    for id in &folder_ids {
        sqlx::query(
            "UPDATE folders SET deleted_at = now(), updated_at = now() \
             WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        "UPDATE files SET deleted_at = now(), updated_at = now() \
         WHERE user_id = $1 AND folder_id = ANY($2) AND deleted_at IS NULL",
    )
    .bind(user_id)
    .bind(&folder_ids)
    .execute(pool)
    .await?;

    revoke_shares_for_resource(pool, user_id, "folder", folder_id)
        .await
        .ok();

    Ok(name)
}

// Human: Collect every soft-deleted file and folder id in a trashed folder subtree.
// Agent: BFS trashed subfolders; READS files WHERE folder_id IN subtree; USED for permanent purge.
pub async fn collect_trashed_folder_subtree(
    pool: &sqlx::PgPool,
    user_id: &str,
    root_folder_id: &str,
) -> Result<(Vec<String>, Vec<String>), AppError> {
    let mut folder_ids = vec![root_folder_id.to_string()];
    let mut queue = vec![root_folder_id.to_string()];

    while let Some(folder_id) = queue.pop() {
        let children: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM folders WHERE user_id = $1 AND parent_id = $2 AND deleted_at IS NOT NULL",
        )
        .bind(user_id)
        .bind(&folder_id)
        .fetch_all(pool)
        .await?;
        for (child_id,) in children {
            queue.push(child_id.clone());
            folder_ids.push(child_id);
        }
    }

    let file_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM files WHERE user_id = $1 AND folder_id = ANY($2) AND deleted_at IS NOT NULL",
    )
    .bind(user_id)
    .bind(&folder_ids)
    .fetch_all(pool)
    .await?;

    Ok((file_ids.into_iter().map(|(id,)| id).collect(), folder_ids))
}

// Human: List top-level recycle bin entries — not nested items from a deleted folder tree.
// Agent: GET handler; READS files/folders WHERE deleted_at IS NOT NULL and parent not deleted.
pub async fn list_recycle_bin(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<RecycleBinResponse>, AppError> {
    let files: Vec<(String, String, Option<String>, i64, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT f.id, f.name, f.mime_type, f.size_bytes, f.folder_id, fo.name, f.deleted_at \
             FROM files f \
             LEFT JOIN folders fo ON fo.id = f.folder_id AND fo.user_id = f.user_id \
             WHERE f.user_id = $1 AND f.deleted_at IS NOT NULL \
               AND (f.folder_id IS NULL OR fo.deleted_at IS NULL) \
             ORDER BY f.deleted_at DESC",
        )
        .bind(&claims.sub)
        .fetch_all(&state.pool)
        .await?;

    let folders: Vec<(String, String, Option<String>, i64, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT fo.id, fo.name, fo.parent_id, \
             (SELECT COUNT(*) FROM files fi WHERE fi.user_id = fo.user_id AND fi.folder_id = fo.id), \
             fo.deleted_at \
             FROM folders fo \
             WHERE fo.user_id = $1 AND fo.deleted_at IS NOT NULL \
               AND NOT EXISTS ( \
                 SELECT 1 FROM folders parent \
                 WHERE parent.id = fo.parent_id \
                   AND parent.user_id = fo.user_id \
                   AND parent.deleted_at IS NOT NULL \
               ) \
             ORDER BY fo.deleted_at DESC",
        )
        .bind(&claims.sub)
        .fetch_all(&state.pool)
        .await?;

    let file_items: Vec<RecycleBinFileItem> = files
        .into_iter()
        .map(
            |(id, name, mime_type, size_bytes, folder_id, folder_name, deleted_at)| {
                RecycleBinFileItem {
                    id,
                    name,
                    mime_type,
                    size_bytes,
                    folder_id,
                    folder_name,
                    expires_at: expires_at(deleted_at),
                    deleted_at,
                }
            },
        )
        .collect();

    let folder_items: Vec<RecycleBinFolderItem> = folders
        .into_iter()
        .map(|(id, name, parent_id, file_count, deleted_at)| RecycleBinFolderItem {
            id,
            name,
            parent_id,
            file_count,
            expires_at: expires_at(deleted_at),
            deleted_at,
        })
        .collect();

    let total_count = (file_items.len() + folder_items.len()) as i64;

    Ok(Json(RecycleBinResponse {
        files: file_items,
        folders: folder_items,
        total_count,
    }))
}

// Human: Preview total blob purge scope for every file currently in the recycle bin.
// Agent: GET /recycle-bin/deletion-preview; READS all trashed file ids; NO storage mutations.
pub async fn recycle_bin_deletion_preview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<BulkDeletionPreviewResponse>, AppError> {
    let file_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM files WHERE user_id = $1 AND deleted_at IS NOT NULL ORDER BY name ASC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;

    let file_ids: Vec<String> = file_ids.into_iter().map(|(id,)| id).collect();
    if file_ids.is_empty() {
        return Ok(Json(BulkDeletionPreviewResponse {
            file_count: 0,
            storage_object_count: 0,
            files: Vec::new(),
        }));
    }

    let preview =
        delete_job::preview_files_for_permanent_delete(&state.pool, &claims.sub, file_ids).await?;
    Ok(Json(preview))
}

// Human: Restore soft-deleted files back to the drive when the original folder still exists.
// Agent: POST /recycle-bin/restore; CLEARS deleted_at; ERRORS Conflict when parent folder is gone.
pub async fn restore_recycle_bin_items(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<RestoreRecycleBinRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut restored_files = 0u32;
    let mut restored_folders = 0u32;

    for file_id in &body.file_ids {
        let row: Option<(Option<String>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
            "SELECT folder_id, deleted_at FROM files WHERE id = $1 AND user_id = $2",
        )
        .bind(file_id)
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;

        let Some((folder_id, deleted_at)) = row else {
            continue;
        };
        if deleted_at.is_none() {
            continue;
        }

        if let Some(parent_id) = &folder_id {
            let parent_active: Option<(i64,)> = sqlx::query_as(
                "SELECT 1 FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
            )
            .bind(parent_id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
            if parent_active.is_none() {
                return Err(AppError::Conflict(
                    "cannot restore file — original folder is in the recycle bin".into(),
                ));
            }
        }

        sqlx::query(
            "UPDATE files SET deleted_at = NULL, updated_at = now() \
             WHERE id = $1 AND user_id = $2",
        )
        .bind(file_id)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

        restored_files = restored_files.saturating_add(1);
        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "files.restore",
            Some("file"),
            Some(file_id),
            None,
            &headers,
        )
        .await
        .ok();
    }

    for folder_id in &body.folder_ids {
        let row: Option<(Option<chrono::DateTime<chrono::Utc>>, Option<String>)> = sqlx::query_as(
            "SELECT deleted_at, parent_id FROM folders WHERE id = $1 AND user_id = $2",
        )
        .bind(folder_id)
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;

        let Some((deleted_at, parent_id)) = row else {
            continue;
        };
        if deleted_at.is_none() {
            continue;
        }

        if let Some(parent) = &parent_id {
            let parent_active: Option<(i64,)> = sqlx::query_as(
                "SELECT 1 FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
            )
            .bind(parent)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
            if parent_active.is_none() {
                return Err(AppError::Conflict(
                    "cannot restore folder — parent folder is in the recycle bin".into(),
                ));
            }

            let name_conflict: Option<(i64,)> = sqlx::query_as(
                "SELECT 1 FROM folders WHERE user_id = $1 AND parent_id = $2 AND name = \
                 (SELECT name FROM folders WHERE id = $3) AND deleted_at IS NULL LIMIT 1",
            )
            .bind(&claims.sub)
            .bind(parent)
            .bind(folder_id)
            .fetch_optional(&state.pool)
            .await?;
            if name_conflict.is_some() {
                return Err(AppError::Conflict(
                    "a folder with this name already exists in the destination".into(),
                ));
            }
        }

        let mut folder_ids = vec![folder_id.clone()];
        let mut queue = vec![folder_id.clone()];
        while let Some(current_id) = queue.pop() {
            let children: Vec<(String,)> = sqlx::query_as(
                "SELECT id FROM folders WHERE user_id = $1 AND parent_id = $2 AND deleted_at IS NOT NULL",
            )
            .bind(&claims.sub)
            .bind(&current_id)
            .fetch_all(&state.pool)
            .await?;
            for (child_id,) in children {
                queue.push(child_id.clone());
                folder_ids.push(child_id);
            }
        }

        for id in &folder_ids {
            sqlx::query(
                "UPDATE folders SET deleted_at = NULL, updated_at = now() \
                 WHERE id = $1 AND user_id = $2",
            )
            .bind(id)
            .bind(&claims.sub)
            .execute(&state.pool)
            .await?;
        }

        sqlx::query(
            "UPDATE files SET deleted_at = NULL, updated_at = now() \
             WHERE user_id = $1 AND folder_id = ANY($2) AND deleted_at IS NOT NULL",
        )
        .bind(&claims.sub)
        .bind(&folder_ids)
        .execute(&state.pool)
        .await?;

        restored_folders = restored_folders.saturating_add(1);
        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "folders.restore",
            Some("folder"),
            Some(folder_id),
            None,
            &headers,
        )
        .await
        .ok();
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "restored_files": restored_files,
        "restored_folders": restored_folders,
    })))
}

// Human: Permanently delete every item currently in the caller's recycle bin.
// Agent: DELETE /recycle-bin; CALLS delete_owned_file_row for each file; DELETE folder rows.
pub async fn empty_recycle_bin(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let purged = purge_user_recycle_bin(&state, &claims.sub, &headers).await?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "purged_files": purged.files,
        "purged_folders": purged.folders,
    })))
}

#[derive(Debug, Default)]
struct PurgeCounts {
    files: u32,
    folders: u32,
}

// Human: Permanently remove all soft-deleted rows for one user (manual empty recycle bin).
// Agent: SELECT deleted files; delete_owned_file_row each; DELETE soft-deleted folder rows.
async fn purge_user_recycle_bin(
    state: &Arc<AppState>,
    user_id: &str,
    headers: &HeaderMap,
) -> Result<PurgeCounts, AppError> {
    let file_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM files WHERE user_id = $1 AND deleted_at IS NOT NULL",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut counts = PurgeCounts::default();

    for (file_id,) in file_ids {
        match delete_owned_file_row(state, &state.pool, user_id, &file_id).await {
            Ok(deleted) => {
                counts.files = counts.files.saturating_add(1);
                audit::write_audit(
                    &state.pool,
                    Some(user_id),
                    "files.delete.permanent",
                    Some("file"),
                    Some(&file_id),
                    Some(serde_json::json!({
                        "name": deleted.name,
                        "via": "recycle_bin.empty",
                    })),
                    headers,
                )
                .await
                .ok();
            }
            Err(error) => {
                tracing::warn!(file_id = %file_id, %error, "recycle bin purge skipped file");
            }
        }
    }

    let folder_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM folders WHERE user_id = $1 AND deleted_at IS NOT NULL",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    for (folder_id,) in folder_ids {
        sqlx::query("DELETE FROM folders WHERE id = $1 AND user_id = $2")
            .bind(&folder_id)
            .bind(user_id)
            .execute(&state.pool)
            .await?;
        counts.folders = counts.folders.saturating_add(1);
        audit::write_audit(
            &state.pool,
            Some(user_id),
            "folders.delete.permanent",
            Some("folder"),
            Some(&folder_id),
            Some(serde_json::json!({ "via": "recycle_bin.empty" })),
            headers,
        )
        .await
        .ok();
    }

    audit::write_audit(
        &state.pool,
        Some(user_id),
        "recycle_bin.empty",
        Some("recycle_bin"),
        None,
        Some(serde_json::json!({
            "purged_files": counts.files,
            "purged_folders": counts.folders,
        })),
        headers,
    )
    .await
    .ok();

    Ok(counts)
}

// Human: Background sweeper — permanently delete recycle bin items older than retention window.
// Agent: READS files WHERE deleted_at < cutoff; CALLS delete_owned_file_row; DELETE stale folders.
pub async fn purge_expired_recycle_bin(state: &Arc<AppState>) -> Result<u32, AppError> {
    let cutoff = Utc::now() - Duration::days(RECYCLE_BIN_RETENTION_DAYS);

    let expired_files: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, user_id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < $1",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;

    let mut purged = 0u32;
    for (file_id, user_id) in expired_files {
        if delete_owned_file_row(state, &state.pool, &user_id, &file_id)
            .await
            .is_ok()
        {
            purged = purged.saturating_add(1);
            audit::write_audit(
                &state.pool,
                Some(&user_id),
                "files.delete.permanent",
                Some("file"),
                Some(&file_id),
                Some(serde_json::json!({ "via": "recycle_bin.expired" })),
                &HeaderMap::new(),
            )
            .await
            .ok();
        }
    }

    let expired_folders: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, user_id FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < $1",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;

    for (folder_id, user_id) in expired_folders {
        if sqlx::query("DELETE FROM folders WHERE id = $1 AND user_id = $2")
            .bind(&folder_id)
            .bind(&user_id)
            .execute(&state.pool)
            .await
            .is_ok()
        {
            purged = purged.saturating_add(1);
            audit::write_audit(
                &state.pool,
                Some(&user_id),
                "folders.delete.permanent",
                Some("folder"),
                Some(&folder_id),
                Some(serde_json::json!({ "via": "recycle_bin.expired" })),
                &HeaderMap::new(),
            )
            .await
            .ok();
        }
    }

    Ok(purged)
}

// Human: Spawn a periodic task that purges recycle bin items past the retention window.
// Agent: CALLED from run(); LOOPS purge_expired_recycle_bin every 6 hours.
pub fn start_recycle_bin_purger(state: Arc<AppState>) {
    tokio::spawn(async move {
        let interval = std::time::Duration::from_secs(6 * 60 * 60);
        loop {
            match purge_expired_recycle_bin(&state).await {
                Ok(count) if count > 0 => {
                    tracing::info!(purged = count, "recycle bin expired purge completed");
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(%error, "recycle bin expired purge failed");
                }
            }
            tokio::time::sleep(interval).await;
        }
    });
}
