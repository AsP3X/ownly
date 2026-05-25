// Human: Folder hierarchy — list, create, and delete user-owned folders for drive organization.
// Agent: READS/WRITES folders table; VALIDATES parent ownership; AUDIT folders.create/delete.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit, auth::handlers::Claims, error::AppError, AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FolderDto {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct FolderListResponse {
    pub folders: Vec<FolderDto>,
}

#[derive(Debug, Deserialize)]
pub struct FolderListQuery {
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateFolderResponse {
    pub folder: FolderDto,
}

// Human: Normalize and validate a folder name before insert.
// Agent: TRIMS whitespace; REJECTS empty, slash characters, and names over 255 chars.
fn normalize_folder_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("folder name is required".into()));
    }
    if trimmed.len() > 255 {
        return Err(AppError::BadRequest("folder name is too long".into()));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::BadRequest(
            "folder name cannot contain path separators".into(),
        ));
    }
    Ok(trimmed.to_string())
}

// Human: Ensure a folder id belongs to the authenticated user before linking uploads or children.
// Agent: READS folders WHERE id + user_id; RETURNS NotFound when missing.
pub async fn ensure_folder_owned(
    pool: &sqlx::PgPool,
    user_id: &str,
    folder_id: &str,
) -> Result<(), AppError> {
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM folders WHERE id = $1 AND user_id = $2")
            .bind(folder_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// Human: List folders at the root or under a specific parent folder.
// Agent: READS folders WHERE user_id AND parent_id filter; ORDER BY name.
pub async fn list_folders(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<FolderListQuery>,
) -> Result<Json<FolderListResponse>, AppError> {
    if let Some(parent_id) = query.parent_id.as_deref() {
        ensure_folder_owned(&state.pool, &claims.sub, parent_id).await?;
    }

    let folders: Vec<FolderDto> = sqlx::query_as(
        "SELECT id, name, parent_id, created_at, updated_at \
         FROM folders \
         WHERE user_id = $1 AND (($2::text IS NULL AND parent_id IS NULL) OR parent_id = $2) \
         ORDER BY name ASC",
    )
    .bind(&claims.sub)
    .bind(&query.parent_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(FolderListResponse { folders }))
}

// Human: Create a folder at the root or inside an existing parent folder.
// Agent: WRITES folders INSERT; AUDIT folders.create; MAPS unique violation to Conflict.
pub async fn create_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateFolderRequest>,
) -> Result<Json<CreateFolderResponse>, AppError> {
    let name = normalize_folder_name(&body.name)?;

    if let Some(parent_id) = body.parent_id.as_deref() {
        ensure_folder_owned(&state.pool, &claims.sub, parent_id).await?;
    }

    let folder_id = Uuid::new_v4().to_string();
    let folder: FolderDto = match sqlx::query_as(
        "INSERT INTO folders (id, user_id, parent_id, name) \
         VALUES ($1, $2, $3, $4) \
         RETURNING id, name, parent_id, created_at, updated_at",
    )
    .bind(&folder_id)
    .bind(&claims.sub)
    .bind(&body.parent_id)
    .bind(&name)
    .fetch_one(&state.pool)
    .await
    {
        Ok(folder) => folder,
        Err(sqlx::Error::Database(db_err)) if db_err.code() == Some("23505".into()) => {
            return Err(AppError::Conflict(
                "a folder with this name already exists here".into(),
            ));
        }
        Err(error) => return Err(error.into()),
    };

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "folders.create",
        Some("folder"),
        Some(&folder_id),
        Some(serde_json::json!({ "name": name, "parent_id": body.parent_id })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(CreateFolderResponse { folder }))
}

// Human: Delete a folder and its nested subfolders; files inside become root-level.
// Agent: DELETE folders row (CASCADE children); AUDIT folders.delete; files.folder_id SET NULL per FK.
pub async fn delete_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT name FROM folders WHERE id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    let (name,) = row.ok_or(AppError::NotFound)?;

    sqlx::query("DELETE FROM folders WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "folders.delete",
        Some("folder"),
        Some(&id),
        Some(serde_json::json!({ "name": name })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}
