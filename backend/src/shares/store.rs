// Human: DB helpers for public share links — resolve tokens and enforce file/folder scope.
// Agent: READS public_shares + files/folders; RETURNS ShareRecord; SCOPE checks prevent lateral access.

use sqlx::PgPool;

use crate::{
    auth::handlers::verify_password,
    error::AppError,
    files::{
        handlers::{FileDto, FILE_COLUMNS},
        processing::ensure_file_not_processing,
        recycle_bin::{ACTIVE_FILES_SQL, ACTIVE_FOLDERS_SQL},
    },
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
    pub password_hash: Option<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub block_download: bool,
}

#[derive(Debug, Clone)]
pub struct SharedFileRow {
    pub storage_key: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub hls_ready: bool,
    pub download_export_ready: bool,
    pub hls_encode_status: Option<String>,
    pub audio_waveform_ready: bool,
    pub audio_encode_status: Option<String>,
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
    bool,
    Option<String>,
);

// Human: Columns loaded for every active share row used by token resolution and owner APIs.
// Agent: INCLUDES protection fields; password_hash stays server-side only on ShareRecord.
pub const SHARE_RECORD_COLUMNS: &str = "id, token, user_id, resource_type, resource_id, revoked_at, created_at, \
    password_hash, expires_at, block_download";

// Human: True when a share row carries an expiration timestamp in the past.
// Agent: CALLED before serving public content; TREATS expired links like revoked links.
pub fn share_is_expired(share: &ShareRecord) -> bool {
    share
        .expires_at
        .is_some_and(|expires_at| expires_at <= chrono::Utc::now())
}

// Human: Validate an optional share password header against the stored hash.
// Agent: RETURNS Ok when no password is configured; ERRORS Unauthorized when missing or wrong.
pub fn verify_share_password(
    share: &ShareRecord,
    provided_password: Option<&str>,
) -> Result<(), AppError> {
    let Some(stored_hash) = share.password_hash.as_deref() else {
        return Ok(());
    };

    let Some(password) = provided_password.filter(|value| !value.is_empty()) else {
        return Err(AppError::Forbidden(
            "this link requires a password".into(),
        ));
    };

    if !verify_password(password, stored_hash).unwrap_or(false) {
        return Err(AppError::Forbidden("incorrect share password".into()));
    }

    Ok(())
}

// Human: Reject download routes when the owner enabled preview-only sharing.
// Agent: CALLED from public_share_download; ALLOWS stream/preview endpoints to keep working.
pub fn ensure_share_download_allowed(share: &ShareRecord) -> Result<(), AppError> {
    if share.block_download {
        return Err(AppError::Forbidden(
            "downloads are disabled for this link".into(),
        ));
    }
    Ok(())
}
// Agent: USES OsRng via crypto::fill_random_bytes; RETURNS 64-char hex string.
pub fn generate_share_token() -> String {
    let mut bytes = [0u8; 32];
    crate::crypto::fill_random_bytes(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod token_tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn share_token_has_expected_length_and_format() {
        let token = generate_share_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn share_tokens_are_unique() {
        let tokens: HashSet<String> = (0..100).map(|_| generate_share_token()).collect();
        assert_eq!(tokens.len(), 100);
    }
}

// Human: Load an active share row by token or reject revoked / missing links.
// Agent: READS public_shares WHERE token AND revoked_at IS NULL; RETURNS NotFound when inactive.
pub async fn resolve_active_share(pool: &PgPool, token: &str) -> Result<ShareRecord, AppError> {
    let share: Option<ShareRecord> = sqlx::query_as(&format!(
        "SELECT {SHARE_RECORD_COLUMNS} \
         FROM public_shares \
         WHERE token = $1 AND revoked_at IS NULL",
    ))
    .bind(token)
    .fetch_optional(pool)
    .await?;

    let share = share.ok_or(AppError::NotFound)?;
    if share_is_expired(&share) {
        return Err(AppError::NotFound);
    }
    Ok(share)
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
        let row: Option<(Option<String>,)> = sqlx::query_as(&format!(
            "SELECT parent_id FROM folders WHERE id = $1 AND user_id = $2 AND {ACTIVE_FOLDERS_SQL}",
        ))
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

    let row: Option<ShareScopedFileRow> = sqlx::query_as(&format!(
        "SELECT id, storage_key, name, mime_type, folder_id, hls_ready, download_export_ready, \
         hls_encode_status, audio_waveform_ready, audio_encode_status \
         FROM files WHERE id = $1 AND user_id = $2 AND {ACTIVE_FILES_SQL}",
    ))
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
        audio_waveform_ready,
        audio_encode_status,
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
        audio_waveform_ready,
        audio_encode_status,
    })
}

// Human: Verify caller may share a file (owner or content.share grant).
// Agent: CALLS authz ContentShare on File(id); RETURNS NotFound when row missing.
pub async fn ensure_file_owned_for_share(
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
) -> Result<(), AppError> {
    crate::files::access::ensure_file_access(
        pool,
        user_id,
        file_id,
        crate::authz::Permission::ContentShare,
    )
    .await
}

// Human: Verify caller may share a folder (owner or content.share grant).
// Agent: CALLS authz ContentShare on Folder(id).
pub async fn ensure_folder_owned_for_share(
    pool: &PgPool,
    user_id: &str,
    folder_id: &str,
) -> Result<(), AppError> {
    crate::files::access::ensure_folder_access(
        pool,
        user_id,
        folder_id,
        crate::authz::Permission::ContentShare,
    )
    .await
}

// Human: Reuse the drive file DTO columns when listing public folder contents.
// Agent: SELECT FILE_COLUMNS so FileDto FromRow stays aligned with authenticated list handlers.
pub async fn list_share_folder_files(
    pool: &PgPool,
    share: &ShareRecord,
    folder_id: &str,
) -> Result<Vec<FileDto>, AppError> {
    let files: Vec<FileDto> = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files \
         WHERE user_id = $1 AND folder_id = $2 AND {ACTIVE_FILES_SQL} \
         ORDER BY name ASC"
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
    ensure_file_not_processing(
        &row.mime_type,
        row.hls_ready,
        &row.hls_encode_status,
        row.audio_waveform_ready,
        &row.audio_encode_status,
    )
}

#[derive(Debug, Clone)]
pub struct PublicShareTreeStats {
    pub file_count: i64,
    pub folder_count: i64,
    pub total_bytes: i64,
}

// Human: Load the share owner's email for the public sidebar (no user id exposed).
// Agent: READS users.email WHERE id = share.user_id; RETURNS NotFound when owner missing.
pub async fn sharer_email(pool: &PgPool, owner_user_id: &str) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE id = $1")
        .bind(owner_user_id)
        .fetch_optional(pool)
        .await?;
    row.map(|(email,)| email).ok_or(AppError::NotFound)
}

// Human: Aggregate file/folder counts and byte sum across an entire folder-type share tree.
// Agent: RECURSIVE folder CTE + files.size_bytes SUM; FILE shares return a single-file snapshot.
pub async fn compute_share_tree_stats(
    pool: &PgPool,
    share: &ShareRecord,
) -> Result<PublicShareTreeStats, AppError> {
    if share.resource_type == "file" {
        let row: Option<(i64,)> = sqlx::query_as(&format!(
            "SELECT size_bytes FROM files WHERE id = $1 AND user_id = $2 AND {ACTIVE_FILES_SQL}",
        ))
        .bind(&share.resource_id)
        .bind(&share.user_id)
        .fetch_optional(pool)
        .await?;
        let size_bytes = row.ok_or(AppError::NotFound)?.0;
        return Ok(PublicShareTreeStats {
            file_count: 1,
            folder_count: 0,
            total_bytes: size_bytes,
        });
    }

    let stats: Option<(i64, i64, i64)> = sqlx::query_as(&format!(
        "WITH RECURSIVE subtree AS ( \
            SELECT id FROM folders WHERE id = $1 AND user_id = $2 AND {ACTIVE_FOLDERS_SQL} \
            UNION ALL \
            SELECT f.id FROM folders f \
            INNER JOIN subtree s ON f.parent_id = s.id \
            WHERE f.user_id = $2 AND f.{ACTIVE_FOLDERS_SQL} \
        ) \
        SELECT \
            (SELECT COUNT(*)::bigint FROM files \
             WHERE user_id = $2 AND folder_id IN (SELECT id FROM subtree) AND {ACTIVE_FILES_SQL}), \
            (SELECT COUNT(*)::bigint FROM folders \
             WHERE user_id = $2 AND id IN (SELECT id FROM subtree) AND id <> $1 AND {ACTIVE_FOLDERS_SQL}), \
            (SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM files \
             WHERE user_id = $2 AND folder_id IN (SELECT id FROM subtree) AND {ACTIVE_FILES_SQL})",
    ))
    .bind(&share.resource_id)
    .bind(&share.user_id)
    .fetch_optional(pool)
    .await?;

    let (file_count, folder_count, total_bytes) = stats.ok_or(AppError::NotFound)?;
    Ok(PublicShareTreeStats {
        file_count,
        folder_count,
        total_bytes,
    })
}

// Human: Flat list of every file reachable through a share link (for search, zip, save-to-library).
// Agent: SELECT FILE_COLUMNS via recursive subtree; MUST match FileDto fields (video_width, thumbnails).
pub async fn list_all_files_in_share(
    pool: &PgPool,
    share: &ShareRecord,
) -> Result<Vec<FileDto>, AppError> {
    if share.resource_type == "file" {
        let file: Option<FileDto> = sqlx::query_as(&format!(
            "SELECT {FILE_COLUMNS} FROM files \
             WHERE id = $1 AND user_id = $2 AND {ACTIVE_FILES_SQL}"
        ))
        .bind(&share.resource_id)
        .bind(&share.user_id)
        .fetch_optional(pool)
        .await?;
        return Ok(file.into_iter().collect());
    }

    let files: Vec<FileDto> = sqlx::query_as(&format!(
        "WITH RECURSIVE subtree AS ( \
            SELECT id FROM folders WHERE id = $1 AND user_id = $2 AND {ACTIVE_FOLDERS_SQL} \
            UNION ALL \
            SELECT f.id FROM folders f \
            INNER JOIN subtree s ON f.parent_id = s.id \
            WHERE f.user_id = $2 AND f.{ACTIVE_FOLDERS_SQL} \
        ) \
        SELECT {FILE_COLUMNS} FROM files \
        WHERE user_id = $2 AND folder_id IN (SELECT id FROM subtree) AND {ACTIVE_FILES_SQL} \
        ORDER BY name ASC"
    ))
    .bind(&share.resource_id)
    .bind(&share.user_id)
    .fetch_all(pool)
    .await?;

    Ok(files)
}

// Human: Every folder row inside a folder-type share subtree (for save/download selection expansion).
// Agent: RECURSIVE CTE matching list_all_files_in_share; INCLUDES the shared root folder.
pub async fn list_all_folders_in_share(
    pool: &PgPool,
    share: &ShareRecord,
) -> Result<Vec<crate::files::folders::FolderDto>, AppError> {
    if share.resource_type == "file" {
        return Ok(Vec::new());
    }

    let folders: Vec<crate::files::folders::FolderDto> = sqlx::query_as(&format!(
        "WITH RECURSIVE subtree AS ( \
            SELECT id, name, parent_id, created_at, updated_at FROM folders \
            WHERE id = $1 AND user_id = $2 AND {ACTIVE_FOLDERS_SQL} \
            UNION ALL \
            SELECT f.id, f.name, f.parent_id, f.created_at, f.updated_at FROM folders f \
            INNER JOIN subtree s ON f.parent_id = s.id \
            WHERE f.user_id = $2 AND f.{ACTIVE_FOLDERS_SQL} \
        ) \
        SELECT id, name, parent_id, created_at, updated_at FROM subtree ORDER BY name ASC",
    ))
    .bind(&share.resource_id)
    .bind(&share.user_id)
    .fetch_all(pool)
    .await?;

    Ok(folders)
}

// Human: Ensure every requested id belongs to this share before zip/save/download-all.
// Agent: FILE share requires exact id; FOLDER share checks subtree membership per file row.
pub async fn ensure_file_ids_in_share(
    pool: &PgPool,
    share: &ShareRecord,
    file_ids: &[String],
) -> Result<(), AppError> {
    for file_id in file_ids {
        load_file_in_share_scope(pool, share, file_id).await?;
    }
    Ok(())
}
