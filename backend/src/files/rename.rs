// Human: Rename files and folders — validate names, detect sibling collisions, audit mutations.
// Agent: PATCH /files/{id} name field; PATCH /folders/{id}; REQUIRES ContentWrite grant.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        folders::{self, FolderDto},
        handlers::{FileDto, FILE_COLUMNS},
        processing::ensure_file_not_processing,
        recycle_bin::ACTIVE_FILES_SQL,
        upload_validation::normalize_upload_filename,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct PatchFolderRequest {
    #[serde(default)]
    pub name: Option<String>,
    /// Human: When absent, parent is unchanged. When null, move to root. When set, move under that folder.
    /// Agent: Option<Option<String>> distinguishes JSON omit vs null vs string for PATCH /folders/{id}.
    #[serde(default)]
    #[serde(deserialize_with = "crate::patch_fields::deserialize_optional_nullable_string")]
    pub parent_id: Option<Option<String>>,
}

#[derive(Debug, Serialize)]
pub struct PatchFolderResponse {
    pub folder: FolderDto,
}

// Human: Backward-compatible aliases for rename-only PATCH bodies.
pub type RenameFolderRequest = PatchFolderRequest;
pub type RenameFolderResponse = PatchFolderResponse;

// Human: Ensure no other active sibling uses the same display name (case-insensitive).
// Agent: READS files or folders table; EXCLUDES current row id; RETURNS Conflict on collision.
async fn ensure_unique_file_name(
    pool: &sqlx::PgPool,
    user_id: &str,
    folder_id: &Option<String>,
    name: &str,
    exclude_id: &str,
) -> Result<(), AppError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM files
            WHERE user_id = $1
              AND id <> $4
              AND deleted_at IS NULL
              AND LOWER(name) = LOWER($3)
              AND (($2::text IS NULL AND folder_id IS NULL) OR folder_id = $2)
        )",
    )
    .bind(user_id)
    .bind(folder_id)
    .bind(name)
    .bind(exclude_id)
    .fetch_one(pool)
    .await?;

    if exists {
        return Err(AppError::Conflict(
            "a file with this name already exists in this folder".into(),
        ));
    }
    Ok(())
}

pub(crate) async fn ensure_unique_folder_name(
    pool: &sqlx::PgPool,
    user_id: &str,
    parent_id: &Option<String>,
    name: &str,
    exclude_id: &str,
) -> Result<(), AppError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM folders
            WHERE user_id = $1
              AND id <> $4
              AND deleted_at IS NULL
              AND LOWER(name) = LOWER($3)
              AND (($2::text IS NULL AND parent_id IS NULL) OR parent_id = $2)
        )",
    )
    .bind(user_id)
    .bind(parent_id)
    .bind(name)
    .bind(exclude_id)
    .fetch_one(pool)
    .await?;

    if exists {
        return Err(AppError::Conflict(
            "a folder with this name already exists here".into(),
        ));
    }
    Ok(())
}

// Human: Rename a library file in place without changing its folder.
// Agent: VALIDATES ContentWrite; UPDATES files.name; AUDIT files.rename.
pub async fn rename_file_in_place(
    pool: &sqlx::PgPool,
    headers: &HeaderMap,
    user_id: &str,
    file_id: &str,
    raw_name: &str,
) -> Result<FileDto, AppError> {
    let name = normalize_upload_filename(raw_name)?;

    let current: Option<(Option<String>, String, Option<String>, bool, Option<String>, bool, Option<String>)> =
        sqlx::query_as(
            "SELECT folder_id, name, mime_type, hls_ready, hls_encode_status, audio_waveform_ready, \
             audio_encode_status FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(file_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

    let (
        folder_id,
        previous_name,
        mime_type,
        hls_ready,
        hls_encode_status,
        audio_waveform_ready,
        audio_encode_status,
    ) = current.ok_or(AppError::NotFound)?;

    if previous_name == name {
        let file: FileDto = sqlx::query_as(&format!(
            "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2 AND {ACTIVE_FILES_SQL}"
        ))
        .bind(file_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        return Ok(file);
    }

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        audio_waveform_ready,
        &audio_encode_status,
    )?;

    ensure_unique_file_name(pool, user_id, &folder_id, &name, file_id).await?;

    let file: FileDto = sqlx::query_as(&format!(
        "UPDATE files SET name = $1, updated_at = NOW() \
         WHERE id = $2 AND user_id = $3 AND {ACTIVE_FILES_SQL} \
         RETURNING {FILE_COLUMNS}"
    ))
    .bind(&name)
    .bind(file_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    audit::write_audit(
        pool,
        Some(user_id),
        "files.rename",
        Some("file"),
        Some(file_id),
        Some(serde_json::json!({
            "from_name": previous_name,
            "to_name": name,
            "folder_id": folder_id,
        })),
        headers,
    )
    .await
    .ok();

    Ok(file)
}

// Human: Patch a folder — rename, move within the hierarchy, or both in one request.
// Agent: PATCH /folders/{id}; OPTIONAL name + parent_id; AUDIT folders.rename / folders.move.
pub async fn patch_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchFolderRequest>,
) -> Result<Json<PatchFolderResponse>, AppError> {
    crate::files::access::ensure_folder_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentWrite,
    )
    .await?;

    if body.name.is_none() && body.parent_id.is_none() {
        return Err(AppError::BadRequest(
            "provide name and/or parent_id to update the folder".into(),
        ));
    }

    if let Some(ref raw_name) = body.name {
        rename_folder_in_place(&state.pool, &headers, &claims.sub, &id, raw_name).await?;
        if body.parent_id.is_none() {
            let folder = fetch_folder_dto(&state.pool, &id, &claims.sub).await?;
            return Ok(Json(PatchFolderResponse { folder }));
        }
    }

    if let Some(parent_patch) = body.parent_id {
        let target_parent = parent_patch
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let folder = crate::files::folder_move::move_folder_in_place(
            &state.pool,
            &headers,
            &claims.sub,
            &id,
            target_parent,
        )
        .await?;
        return Ok(Json(PatchFolderResponse { folder }));
    }

    let folder = fetch_folder_dto(&state.pool, &id, &claims.sub).await?;
    Ok(Json(PatchFolderResponse { folder }))
}

// Human: Rename a folder without moving it in the hierarchy.
// Agent: CALLED from patch_folder when name is set; AUDIT folders.rename.
async fn rename_folder_in_place(
    pool: &sqlx::PgPool,
    headers: &HeaderMap,
    user_id: &str,
    folder_id: &str,
    raw_name: &str,
) -> Result<(), AppError> {
    let name = folders::normalize_folder_name(raw_name)?;

    let current: Option<(Option<String>, String)> = sqlx::query_as(
        "SELECT parent_id, name FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let (parent_id, previous_name) = current.ok_or(AppError::NotFound)?;

    if previous_name == name {
        return Ok(());
    }

    ensure_unique_folder_name(pool, user_id, &parent_id, &name, folder_id).await?;

    sqlx::query(
        "UPDATE folders SET name = $1, updated_at = NOW() \
         WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL",
    )
    .bind(&name)
    .bind(folder_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    audit::write_audit(
        pool,
        Some(user_id),
        "folders.rename",
        Some("folder"),
        Some(folder_id),
        Some(serde_json::json!({
            "from_name": previous_name,
            "to_name": name,
            "parent_id": parent_id,
        })),
        headers,
    )
    .await
    .ok();

    Ok(())
}

// Human: Load one owned folder row after patch for the PATCH response envelope.
// Agent: READS folders WHERE id + user_id; RETURNS NotFound when missing.
pub(crate) async fn fetch_folder_dto(
    pool: &sqlx::PgPool,
    folder_id: &str,
    user_id: &str,
) -> Result<FolderDto, AppError> {
    sqlx::query_as(
        "SELECT id, name, parent_id, created_at, updated_at FROM folders \
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod patch_folder_request_tests {
    use super::PatchFolderRequest;

    // Human: PATCH move-to-root sends JSON null for parent_id — must not deserialize as "field absent".
    // Agent: ASSERTS Option<Option<String>> tri-state; FAILURES here explain breadcrumb root-drop 400s.
    #[test]
    fn deserializes_null_parent_id_as_some_none() {
        let body: PatchFolderRequest =
            serde_json::from_str(r#"{"parent_id": null}"#).unwrap();
        assert_eq!(body.parent_id, Some(None));
    }

    #[test]
    fn deserializes_empty_body_as_none_parent_id() {
        let body: PatchFolderRequest = serde_json::from_str(r#"{}"#).unwrap();
        assert!(body.parent_id.is_none());
    }
}
