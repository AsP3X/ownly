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
pub struct RenameFolderRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct RenameFolderResponse {
    pub folder: FolderDto,
}

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

async fn ensure_unique_folder_name(
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

// Human: Rename a folder without moving it in the hierarchy.
// Agent: PATCH /folders/{id}; VALIDATES ContentWrite on folder; AUDIT folders.rename.
pub async fn rename_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<RenameFolderRequest>,
) -> Result<Json<RenameFolderResponse>, AppError> {
    crate::files::access::ensure_folder_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentWrite,
    )
    .await?;

    let name = folders::normalize_folder_name(&body.name)?;

    let current: Option<(Option<String>, String)> = sqlx::query_as(
        "SELECT parent_id, name FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (parent_id, previous_name) = current.ok_or(AppError::NotFound)?;

    if previous_name == name {
        let folder = fetch_folder_dto(&state.pool, &id, &claims.sub).await?;
        return Ok(Json(RenameFolderResponse { folder }));
    }

    ensure_unique_folder_name(&state.pool, &claims.sub, &parent_id, &name, &id).await?;

    sqlx::query(
        "UPDATE folders SET name = $1, updated_at = NOW() \
         WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL",
    )
    .bind(&name)
    .bind(&id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "folders.rename",
        Some("folder"),
        Some(&id),
        Some(serde_json::json!({
            "from_name": previous_name,
            "to_name": name,
            "parent_id": parent_id,
        })),
        &headers,
    )
    .await
    .ok();

    let folder = fetch_folder_dto(&state.pool, &id, &claims.sub).await?;
    Ok(Json(RenameFolderResponse { folder }))
}

// Human: Load one owned folder row after rename for the PATCH response envelope.
// Agent: READS folders WHERE id + user_id; RETURNS NotFound when missing.
async fn fetch_folder_dto(
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
