// Human: DB helpers for public share links — resolve tokens and enforce file/folder scope.
// Agent: READS public_shares + files/folders; RETURNS ShareRecord; SCOPE checks prevent lateral access.

use rand::RngCore;
use sqlx::PgPool;

use crate::{
    error::AppError,
    files::{folders::ensure_folder_owned, handlers::FileDto, processing::ensure_file_not_processing},
};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ShareRecord {
    pub id: String,
    pub token: String,
    pub user_id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub struct SharedFileRow {
    pub storage_key: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub hls_ready: bool,
    pub download_export_ready: bool,
    pub hls_encode_status: Option<String>,
}

type ShareScopedFileRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    bool,
    bool,
    Option<String>,
);

// Human: Generate a high-entropy URL token (256 bits hex) for unguessable public links.
// Agent: USES rand thread_rng; RETURNS 64-char hex string.
pub fn generate_share_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

// Human: Load an active share row by token or reject revoked / missing links.
// Agent: READS public_shares WHERE token AND revoked_at IS NULL; RETURNS NotFound when inactive.
pub async fn resolve_active_share(pool: &PgPool, token: &str) -> Result<ShareRecord, AppError> {
    let share: Option<ShareRecord> = sqlx::query_as(
        "SELECT id, token, user_id, resource_type, resource_id, revoked_at, created_at \
         FROM public_shares \
         WHERE token = $1 AND revoked_at IS NULL",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    share.ok_or(AppError::NotFound)
}

// Human: Walk parent_id chain to confirm a folder lives inside the shared folder subtree.
// Agent: BFS upward; RETURNS true when folder_id equals root_id or is a descendant.
pub async fn folder_is_under_root(
    pool: &PgPool,
    user_id: &str,
    folder_id: &str,
    root_id: &str,
) -> Result<bool, AppError> {
    if folder_id == root_id {
        return Ok(true);
    }

    let mut current = folder_id.to_string();
    loop {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT parent_id FROM folders WHERE id = $1 AND user_id = $2",
        )
        .bind(&current)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        let Some((parent_id,)) = row else {
            return Ok(false);
        };

        let Some(parent) = parent_id else {
            return Ok(false);
        };

        if parent == root_id {
            return Ok(true);
        }
        current = parent;
    }
}

// Human: Ensure a browse target folder is allowed for a folder-type share link.
// Agent: NULL means shared root; non-null must be under share.resource_id.
pub async fn ensure_browse_folder_in_share(
    pool: &PgPool,
    share: &ShareRecord,
    browse_folder_id: Option<&str>,
) -> Result<(), AppError> {
    if share.resource_type != "folder" {
        return Err(AppError::BadRequest(
            "this share link is for a single file".into(),
        ));
    }

    match browse_folder_id {
        None => Ok(()),
        Some(folder_id) => {
            if !folder_is_under_root(pool, &share.user_id, folder_id, &share.resource_id).await? {
                return Err(AppError::NotFound);
            }
            Ok(())
        }
    }
}

// Human: Confirm a file id is reachable through this share before serving bytes or metadata.
// Agent: READS files row; FILE share requires exact id match; FOLDER share requires subtree membership.
pub async fn load_file_in_share_scope(
    pool: &PgPool,
    share: &ShareRecord,
    file_id: &str,
) -> Result<SharedFileRow, AppError> {
    if share.resource_type == "file" && file_id != share.resource_id {
        return Err(AppError::NotFound);
    }

    let row: Option<ShareScopedFileRow> = sqlx::query_as(
        "SELECT id, storage_key, name, mime_type, folder_id, hls_ready, download_export_ready, hls_encode_status \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(&share.user_id)
    .fetch_optional(pool)
    .await?;

    let (
        _id,
        storage_key,
        name,
        mime_type,
        folder_id,
        hls_ready,
        download_export_ready,
        hls_encode_status,
    ) = row.ok_or(AppError::NotFound)?;

    if share.resource_type == "folder" {
        let Some(parent_folder) = folder_id.as_deref() else {
            return Err(AppError::NotFound);
        };
        if !folder_is_under_root(pool, &share.user_id, parent_folder, &share.resource_id).await? {
            return Err(AppError::NotFound);
        }
    }

    Ok(SharedFileRow {
        storage_key,
        name,
        mime_type,
        hls_ready,
        download_export_ready,
        hls_encode_status,
    })
}

// Human: Verify the owner still owns a file before creating a file share link.
// Agent: READS files WHERE id + user_id; RETURNS NotFound when missing.
pub async fn ensure_file_owned_for_share(
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<(), AppError> {
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM files WHERE id = $1 AND user_id = $2")
            .bind(file_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// Human: Verify the owner still owns a folder before creating a folder share link.
// Agent: DELEGATES to folders::ensure_folder_owned.
pub async fn ensure_folder_owned_for_share(
    pool: &PgPool,
    user_id: &str,
    folder_id: &str,
) -> Result<(), AppError> {
    ensure_folder_owned(pool, user_id, folder_id).await
}

// Human: Reuse the drive file DTO columns when listing public folder contents.
// Agent: READS FILE_COLUMNS subset via share-scoped folder_id filter.
pub async fn list_share_folder_files(
    pool: &PgPool,
    share: &ShareRecord,
    folder_id: &str,
) -> Result<Vec<FileDto>, AppError> {
    const FILE_COLUMNS: &str = "id, name, mime_type, size_bytes, folder_id, created_at, updated_at, \
        hls_ready, hls_encode_status, hls_encode_error, conversion_progress, duration_seconds";

    let files: Vec<FileDto> = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE user_id = $1 AND folder_id = $2 ORDER BY name ASC"
    ))
    .bind(&share.user_id)
    .bind(folder_id)
    .fetch_all(pool)
    .await?;

    Ok(files)
}

// Human: Guard download/stream paths against in-progress transcodes on shared files.
// Agent: WRAPS processing::ensure_file_not_processing for SharedFileRow fields.
pub fn ensure_shared_file_ready(row: &SharedFileRow) -> Result<(), AppError> {
    ensure_file_not_processing(&row.mime_type, row.hls_ready, &row.hls_encode_status)
}
