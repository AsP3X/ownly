// Human: Copy-on-write content history — every content write archives the bytes it replaces.
// Agent: WRITES new blob at users/{uid}/revisions/{uuid}; NEVER PUTs over an existing key (dedup siblings stay intact).

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Response},
    Extension, Json,
};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    admin::console::read_setting,
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        content_hash::hash_bytes_sha256,
        handlers::{FileDto, FILE_COLUMNS},
        recycle_bin::ACTIVE_FILES_SQL,
    },
    storage::put_with_retry,
    AppState,
};

/// Human: app_settings key holding how many prior revisions to keep per file.
pub const MAX_VERSIONS_PER_FILE_KEY: &str = "file_version_max_per_file";
/// Human: Default retention when the setting is unset or unparseable.
pub const MAX_VERSIONS_PER_FILE_DEFAULT: i64 = 25;

// Human: Effective per-file retention ceiling; 0 means keep every revision.
// Agent: READS app_settings; a corrupt value degrades to the default, never fails a save.
pub async fn max_versions_per_file(pool: &PgPool) -> i64 {
    read_setting(pool, MAX_VERSIONS_PER_FILE_KEY)
        .await
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .unwrap_or(MAX_VERSIONS_PER_FILE_DEFAULT)
}

// Human: Blob key for a newly written revision — deliberately NOT under users/{uid}/files/{fid}.
// Agent: file_delete purges by prefix; a revision under a file prefix would be collateral on a sibling's delete.
//        file_id_from_storage_key also only matches `.../files/...`, so routing falls through to placements.
pub fn revision_storage_key(user_id: &str) -> String {
    format!("users/{user_id}/revisions/{}", Uuid::new_v4())
}

// Human: True for keys in the revision namespace (single objects, no HLS/thumbnail sidecars).
// Agent: USED by purge to pick storage.delete over prefix listing.
pub fn is_revision_storage_key(key: &str) -> bool {
    let segments: Vec<&str> = key.split('/').collect();
    segments.len() == 4 && segments[0] == "users" && segments[2] == "revisions"
}

/// Human: Which write produced the revision that replaced this one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionOrigin {
    User,
    PublicShare,
    Restore,
}

impl VersionOrigin {
    fn as_str(self) -> &'static str {
        match self {
            VersionOrigin::User => "user",
            VersionOrigin::PublicShare => "public_share",
            VersionOrigin::Restore => "restore",
        }
    }
}

/// Human: The live content state of a file, loaded before it is superseded.
#[derive(Debug, Clone, sqlx::FromRow)]
struct LiveContentRow {
    user_id: String,
    storage_key: String,
    size_bytes: i64,
    content_hash: Option<String>,
    mime_type: Option<String>,
    revision: i32,
}

/// Human: One archived revision as returned by the history API.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileVersionDto {
    pub id: String,
    pub file_id: String,
    pub revision: i32,
    pub size_bytes: i64,
    pub mime_type: Option<String>,
    pub created_by: Option<String>,
    /// Human: Resolved from users — NULL for anonymous public-link edits or a since-deleted account.
    pub created_by_email: Option<String>,
    pub created_via: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Human: Inputs for one content write, shared by the authenticated and public-share paths.
pub struct ContentWrite<'a> {
    pub file_id: &'a str,
    pub bytes: Vec<u8>,
    pub content_type: &'a str,
    /// Human: NULL for anonymous public-link editors — recorded as such on the archived revision.
    pub actor_id: Option<&'a str>,
    pub origin: VersionOrigin,
}

/// Human: Outcome of a content write — `archived` is false when the bytes were unchanged.
pub struct ContentWriteResult {
    pub file: FileDto,
    pub archived: bool,
    pub revision: i32,
}

// Human: Replace a file's bytes without ever mutating the blob it currently points at.
// Agent: PUTS a fresh revision key; INSERTS file_versions for the old state; UPDATES storage_key/size/hash/revision.
//        Identical bytes are a no-op so editor autosave does not spam history.
pub async fn write_file_content(
    state: &Arc<AppState>,
    write: ContentWrite<'_>,
) -> Result<ContentWriteResult, AppError> {
    if write.bytes.is_empty() {
        return Err(AppError::BadRequest("content body must not be empty".into()));
    }

    let live: LiveContentRow = sqlx::query_as(
        "SELECT user_id, storage_key, size_bytes, content_hash, mime_type, revision \
         FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(write.file_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let new_size = write.bytes.len() as i64;
    let new_hash = hash_bytes_sha256(&write.bytes);

    // Human: Unchanged content — skip the blob write and the history entry entirely.
    // Agent: REQUIRES a known prior hash; legacy rows with NULL content_hash archive once, then match.
    if live.content_hash.as_deref() == Some(new_hash.as_str()) && live.size_bytes == new_size {
        let file = load_file_dto(&state.pool, write.file_id).await?;
        return Ok(ContentWriteResult {
            file,
            archived: false,
            revision: live.revision,
        });
    }

    // Human: Version blobs are charged to the owner — the new copy is additional stored bytes.
    crate::quota::ensure_within_quota(&state.pool, &live.user_id, new_size).await?;

    let new_key = revision_storage_key(&live.user_id);
    let data = write.bytes;
    put_with_retry(state.storage.as_ref(), &new_key, write.content_type, || {
        let data = data.clone();
        async move { Ok(data) }
    })
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("storage put failed: {e}")))?;

    let next_revision = live.revision.saturating_add(1);
    let mut tx = state.pool.begin().await?;

    sqlx::query(
        "INSERT INTO file_versions \
         (id, file_id, user_id, revision, storage_key, size_bytes, content_hash, mime_type, \
          created_by, created_via) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(write.file_id)
    .bind(&live.user_id)
    .bind(live.revision)
    .bind(&live.storage_key)
    .bind(live.size_bytes)
    .bind(&live.content_hash)
    .bind(&live.mime_type)
    .bind(write.actor_id)
    .bind(write.origin.as_str())
    .execute(&mut *tx)
    .await?;

    // Human: content_hash must move with the bytes — a stale hash makes a later upload dedup onto edited content.
    let updated = sqlx::query(
        "UPDATE files \
         SET storage_key = $2, size_bytes = $3, content_hash = $4, revision = $5, updated_at = NOW() \
         WHERE id = $1 AND deleted_at IS NULL AND revision = $6",
    )
    .bind(write.file_id)
    .bind(&new_key)
    .bind(new_size)
    .bind(&new_hash)
    .bind(next_revision)
    .bind(live.revision)
    .execute(&mut *tx)
    .await?;

    // Human: Lost the race against a concurrent save — roll back and let the client retry with fresh bytes.
    // Agent: The orphan blob at new_key is cleaned up before returning.
    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        let _ = state.storage.delete(&new_key).await;
        return Err(AppError::Conflict(
            "file was modified by another save — reload and try again".into(),
        ));
    }

    tx.commit().await?;

    prune_versions(state, write.file_id).await;
    invalidate_previews(&state.pool, write.file_id).await;

    let file = load_file_dto(&state.pool, write.file_id).await?;
    Ok(ContentWriteResult {
        file,
        archived: true,
        revision: next_revision,
    })
}

// Human: Point a file back at an archived revision, keeping the current bytes as a new history entry.
// Agent: NO blob copy — the archived blob is immutable and simply becomes referenced twice (refcount handles purge).
pub async fn restore_version(
    state: &Arc<AppState>,
    file_id: &str,
    version_id: &str,
    actor_id: &str,
) -> Result<FileDto, AppError> {
    let live: LiveContentRow = sqlx::query_as(
        "SELECT user_id, storage_key, size_bytes, content_hash, mime_type, revision \
         FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let target: (String, i64, Option<String>) = sqlx::query_as(
        "SELECT storage_key, size_bytes, content_hash FROM file_versions \
         WHERE id = $1 AND file_id = $2",
    )
    .bind(version_id)
    .bind(file_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let (target_key, target_size, target_hash) = target;

    crate::quota::ensure_within_quota(&state.pool, &live.user_id, target_size).await?;

    let next_revision = live.revision.saturating_add(1);
    let mut tx = state.pool.begin().await?;

    sqlx::query(
        "INSERT INTO file_versions \
         (id, file_id, user_id, revision, storage_key, size_bytes, content_hash, mime_type, \
          created_by, created_via) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'restore')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(file_id)
    .bind(&live.user_id)
    .bind(live.revision)
    .bind(&live.storage_key)
    .bind(live.size_bytes)
    .bind(&live.content_hash)
    .bind(&live.mime_type)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;

    let updated = sqlx::query(
        "UPDATE files \
         SET storage_key = $2, size_bytes = $3, content_hash = $4, revision = $5, updated_at = NOW() \
         WHERE id = $1 AND deleted_at IS NULL AND revision = $6",
    )
    .bind(file_id)
    .bind(&target_key)
    .bind(target_size)
    .bind(&target_hash)
    .bind(next_revision)
    .bind(live.revision)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(AppError::Conflict(
            "file was modified by another save — reload and try again".into(),
        ));
    }

    tx.commit().await?;

    prune_versions(state, file_id).await;
    invalidate_previews(&state.pool, file_id).await;

    load_file_dto(&state.pool, file_id).await
}

// Human: Drop the oldest revisions beyond the retention ceiling and purge blobs nothing else references.
// Agent: BEST EFFORT — a pruning failure must never fail the save that triggered it.
pub async fn prune_versions(state: &Arc<AppState>, file_id: &str) {
    let cap = max_versions_per_file(&state.pool).await;
    if cap <= 0 {
        return;
    }

    let doomed: Vec<(String, String)> = match sqlx::query_as(
        "SELECT id, storage_key FROM file_versions \
         WHERE file_id = $1 \
         ORDER BY revision DESC \
         OFFSET $2",
    )
    .bind(file_id)
    .bind(cap)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%file_id, %error, "version retention query failed");
            return;
        }
    };

    if doomed.is_empty() {
        return;
    }

    let ids: Vec<String> = doomed.iter().map(|(id, _)| id.clone()).collect();
    if let Err(error) = sqlx::query("DELETE FROM file_versions WHERE id = ANY($1)")
        .bind(&ids)
        .execute(&state.pool)
        .await
    {
        tracing::warn!(%file_id, %error, "version retention delete failed");
        return;
    }

    let keys: Vec<String> = doomed.into_iter().map(|(_, key)| key).collect();
    purge_unreferenced_version_blobs(state.storage.clone(), &state.pool, &keys).await;
}

// Human: Delete revision blobs that no files row and no surviving version row still points at.
// Agent: MUST run after the owning rows are deleted; shared keys (dedup, restore) are skipped.
pub async fn purge_unreferenced_version_blobs(
    storage: Arc<dyn crate::storage::Storage>,
    pool: &PgPool,
    keys: &[String],
) {
    if keys.is_empty() {
        return;
    }
    let still_referenced =
        match crate::files::content_hash::storage_keys_still_referenced(pool, keys).await {
            Ok(set) => set,
            // Human: On lookup failure keep every blob — an orphan costs disk, a wrong delete costs data.
            Err(error) => {
                tracing::warn!(%error, "version blob refcount failed; skipping purge");
                return;
            }
        };

    for key in keys {
        if still_referenced.contains(key) {
            continue;
        }
        if is_revision_storage_key(key) {
            let _ = storage.delete(key).await;
        } else {
            // Human: Pre-versioning blobs still live under users/{uid}/files/{fid} with sidecars.
            crate::files::file_delete::purge_file_storage(storage.clone(), key, None).await;
        }
    }
}

// Human: Every revision blob belonging to a file — collected before the row is deleted (FK cascades).
// Agent: CALLED by file_delete so archived bytes do not outlive the file.
pub async fn version_storage_keys_for_file(
    pool: &PgPool,
    file_id: &str,
) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT storage_key FROM file_versions WHERE file_id = $1")
            .bind(file_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(key,)| key).collect())
}

// Human: Same for a batch of files — one query for bulk delete paths.
pub async fn version_storage_keys_for_files(
    pool: &PgPool,
    file_ids: &[String],
) -> Result<Vec<String>, AppError> {
    if file_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT storage_key FROM file_versions WHERE file_id = ANY($1)")
            .bind(file_ids)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(key,)| key).collect())
}

// Human: Bytes held by archived revisions for one user — counted against quota alongside live files.
pub async fn user_version_bytes(pool: &PgPool, user_id: &str) -> Result<i64, AppError> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM file_versions WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(bytes,)| bytes).unwrap_or(0))
}

// Human: A content edit invalidates any rendered preview built from the previous bytes.
// Agent: RESETS thumbnail flags so the existing regeneration workers rebuild against the new storage_key.
async fn invalidate_previews(pool: &PgPool, file_id: &str) {
    let _ = sqlx::query(
        "UPDATE files SET \
           document_thumbnail_ready = false, \
           document_thumbnail_status = CASE WHEN document_thumbnail_status IS NULL THEN NULL \
                                            ELSE 'queued' END, \
           document_thumbnail_error = NULL \
         WHERE id = $1",
    )
    .bind(file_id)
    .execute(pool)
    .await;
}

async fn load_file_dto(pool: &PgPool, file_id: &str) -> Result<FileDto, AppError> {
    sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(file_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

#[derive(Debug, Serialize)]
pub struct FileVersionListResponse {
    pub versions: Vec<FileVersionDto>,
    /// Human: Revision number of the live bytes — always one past the newest history entry.
    pub current_revision: i32,
    pub retention_limit: i64,
}

// Human: GET /api/v1/files/{id}/versions — newest archived revision first.
// Agent: REQUIRES ContentRead; JOINS users for display names.
pub async fn list_file_versions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<FileVersionListResponse>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let current: (i32,) = sqlx::query_as(
        &format!("SELECT revision FROM files WHERE id = $1 AND {ACTIVE_FILES_SQL}"),
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let versions: Vec<FileVersionDto> = sqlx::query_as(
        "SELECT v.id, v.file_id, v.revision, v.size_bytes, v.mime_type, v.created_by, \
                u.email AS created_by_email, v.created_via, v.created_at \
         FROM file_versions v \
         LEFT JOIN users u ON u.id = v.created_by \
         WHERE v.file_id = $1 \
         ORDER BY v.revision DESC",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(FileVersionListResponse {
        versions,
        current_revision: current.0,
        retention_limit: max_versions_per_file(&state.pool).await,
    }))
}

#[derive(Debug, Serialize)]
pub struct RestoreVersionResponse {
    pub file: FileDto,
}

// Human: POST /api/v1/files/{id}/versions/{version_id}/restore — make an archived revision current.
// Agent: REQUIRES ContentWrite; ARCHIVES the current bytes first so restore is itself undoable.
pub async fn post_restore_file_version(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path((id, version_id)): Path<(String, String)>,
) -> Result<Json<RestoreVersionResponse>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentWrite,
    )
    .await?;

    let file = restore_version(&state, &id, &version_id, &claims.sub).await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "files.version_restore",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({
            "version_id": version_id,
            "revision": file.revision,
        })),
        &headers,
    )
    .await;

    Ok(Json(RestoreVersionResponse { file }))
}

// Human: GET /api/v1/files/{id}/versions/{version_id}/content — download the archived bytes.
// Agent: REQUIRES ContentRead; STREAMS the immutable revision blob with an attachment disposition.
pub async fn get_file_version_content(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((id, version_id)): Path<(String, String)>,
) -> Result<Response<Body>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let row: Option<(String, Option<String>, i32)> = sqlx::query_as(
        "SELECT storage_key, mime_type, revision FROM file_versions \
         WHERE id = $1 AND file_id = $2",
    )
    .bind(&version_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let (storage_key, mime_type, revision) = row.ok_or(AppError::NotFound)?;

    let name: (String,) = sqlx::query_as("SELECT name FROM files WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;

    let (stream, len, content_type) = state
        .storage
        .get_stream(&storage_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let download_name = versioned_download_name(&name.0, revision);
    let disposition = format!("attachment; filename=\"{}\"", download_name.replace('"', ""));

    Response::builder()
        .header(header::CONTENT_TYPE, mime_type.unwrap_or(content_type))
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::CONTENT_LENGTH, len)
        .body(Body::from_stream(stream))
        .map_err(|e| AppError::Internal(anyhow::anyhow!("version download response: {e}")))
}

// Human: `report.pdf` at revision 3 downloads as `report (v3).pdf` so it does not collide with the live file.
pub fn versioned_download_name(name: &str, revision: i32) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem} (v{revision}).{ext}"),
        _ => format!("{name} (v{revision})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Human: REGRESSION — revision keys must not sit under any file's purge prefix.
    // Agent: ASSERTS the namespace segment is `revisions`, which base_file_storage_key ignores.
    #[test]
    fn revision_keys_live_outside_the_files_namespace() {
        let key = revision_storage_key("user-1");
        assert!(key.starts_with("users/user-1/revisions/"));
        assert!(is_revision_storage_key(&key));

        // Human: The placement helpers must not mistake a revision blob for a file artifact.
        assert_eq!(crate::storage::placement::base_file_storage_key(&key), None);
        assert_eq!(crate::storage::placement::file_id_from_storage_key(&key), None);

        // Human: And it must never be treated as a sidecar of a file that is being purged.
        let file_key = "users/user-1/files/file-1";
        assert!(!crate::storage::placement::is_derived_storage_key(
            &key, file_key
        ));
    }

    #[test]
    fn revision_key_detection_rejects_file_and_sidecar_keys() {
        assert!(!is_revision_storage_key("users/u1/files/f1"));
        assert!(!is_revision_storage_key("users/u1/files/f1/stream.m3u8"));
        assert!(!is_revision_storage_key("users/u1/revisions/abc/extra"));
        assert!(is_revision_storage_key("users/u1/revisions/abc"));
    }

    #[test]
    fn versioned_download_names_keep_the_extension() {
        assert_eq!(versioned_download_name("report.pdf", 3), "report (v3).pdf");
        assert_eq!(versioned_download_name("notes", 1), "notes (v1)");
        assert_eq!(
            versioned_download_name("archive.tar.gz", 2),
            "archive.tar (v2).gz"
        );
        // Human: Dotfiles have no stem — do not produce " (v1).bashrc".
        assert_eq!(versioned_download_name(".bashrc", 1), ".bashrc (v1)");
    }

    #[test]
    fn version_origins_match_the_migration_check_constraint() {
        assert_eq!(VersionOrigin::User.as_str(), "user");
        assert_eq!(VersionOrigin::PublicShare.as_str(), "public_share");
        assert_eq!(VersionOrigin::Restore.as_str(), "restore");
    }
}
