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
    audit, auth::handlers::Claims, error::AppError,
    files::file_delete::{permanent_delete_owned_files, storage_object_count},
    files::listing::{self, ListFoldersParams},
    files::recycle_bin::{self, DeleteQuery, ACTIVE_FILES_SQL, ACTIVE_FOLDERS_SQL},
    AppState,
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
    pub folders: Vec<listing::FolderListItem>,
    pub folder_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
pub struct FolderListQuery {
    pub parent_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
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

#[derive(Debug, Clone)]
struct FolderContentFile {
    id: String,
    mime_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FolderContentTypeCount {
    pub kind: String,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct FolderDeletionPreviewResponse {
    pub file_count: u32,
    pub subfolder_count: u32,
    pub content_types: Vec<FolderContentTypeCount>,
    pub file_ids: Vec<String>,
    pub storage_object_count: u32,
}

// Human: Map a stored mime type to a drive filter bucket for deletion preview summaries.
// Agent: MATCHES frontend fileMatchesTypeFilter groupings; RETURNS kind key + display label.
fn mime_content_kind(mime_type: &Option<String>) -> (&'static str, &'static str) {
    let mime = mime_type.as_deref().unwrap_or("").to_lowercase();
    if mime.starts_with("video/") {
        return ("video", "Videos");
    }
    if mime.starts_with("audio/") {
        return ("audio", "Audio");
    }
    if mime.starts_with("image/") {
        return ("images", "Images");
    }
    if mime.contains("sheet") || mime.contains("excel") || mime.contains("csv") {
        return ("spreadsheets", "Spreadsheets");
    }
    if mime.contains("presentation") || mime.contains("powerpoint") {
        return ("presentations", "Presentations");
    }
    if mime.starts_with("text/")
        || mime.contains("pdf")
        || mime.contains("word")
        || mime.contains("document")
        || mime.contains("json")
        || mime.contains("xml")
    {
        return ("documents", "Documents");
    }
    ("other", "Other files")
}

const CONTENT_KIND_ORDER: &[&str] = &[
    "documents",
    "spreadsheets",
    "presentations",
    "images",
    "video",
    "audio",
    "other",
];

// Human: Walk a folder subtree and collect every nested file plus descendant folder count.
// Agent: BFS folders table; READS files per folder; RETURNS file rows and subfolder_count.
async fn collect_folder_contents(
    pool: &sqlx::PgPool,
    user_id: &str,
    root_folder_id: &str,
) -> Result<(Vec<FolderContentFile>, u32), AppError> {
    let mut files = Vec::new();
    let mut subfolder_count = 0u32;
    let mut queue = vec![root_folder_id.to_string()];

    while let Some(folder_id) = queue.pop() {
        let subfolders: Vec<(String,)> = sqlx::query_as(&format!(
            "SELECT id FROM folders WHERE user_id = $1 AND parent_id = $2 AND {ACTIVE_FOLDERS_SQL}",
        ))
        .bind(user_id)
        .bind(&folder_id)
        .fetch_all(pool)
        .await?;

        subfolder_count += subfolders.len() as u32;
        for (child_id,) in subfolders {
            queue.push(child_id);
        }

        let rows: Vec<(String, Option<String>)> = sqlx::query_as(&format!(
            "SELECT id, mime_type FROM files \
             WHERE user_id = $1 AND folder_id = $2 AND {ACTIVE_FILES_SQL}",
        ))
        .bind(user_id)
        .bind(&folder_id)
        .fetch_all(pool)
        .await?;

        for (id, mime_type) in rows {
            files.push(FolderContentFile { id, mime_type });
        }
    }

    Ok((files, subfolder_count))
}

// Human: Resolve preview file rows for an active or trashed folder subtree.
// Agent: READS deleted_at on root folder; USES trashed subtree walk when already in recycle bin.
async fn folder_files_for_deletion_preview(
    pool: &sqlx::PgPool,
    user_id: &str,
    folder_id: &str,
) -> Result<(Vec<FolderContentFile>, u32, u32), AppError> {
    // Human: Trashed folders use recycle-bin subtree walk; active folders use live BFS.
    // Agent: READS deleted_at as Option — NULL means active folder, not missing row.
    let deleted_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT deleted_at FROM folders WHERE id = $1 AND user_id = $2",
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if deleted_at.is_some() {
        let (file_ids, folder_ids) =
            recycle_bin::collect_trashed_folder_subtree(pool, user_id, folder_id).await?;
        let subfolder_count = folder_ids.len().saturating_sub(1) as u32;
        if file_ids.is_empty() {
            return Ok((Vec::new(), subfolder_count, 0));
        }

        let rows: Vec<(String, Option<String>, Option<i32>)> = sqlx::query_as(
            "SELECT id, mime_type, segment_count FROM files WHERE user_id = $1 AND id = ANY($2)",
        )
        .bind(user_id)
        .bind(&file_ids)
        .fetch_all(pool)
        .await?;

        let storage_object_count = rows
            .iter()
            .map(|(_, _, segment_count)| storage_object_count(*segment_count))
            .sum();

        let files = rows
            .into_iter()
            .map(|(id, mime_type, _)| FolderContentFile { id, mime_type })
            .collect();

        return Ok((files, subfolder_count, storage_object_count));
    }

    let (files, subfolder_count) = collect_folder_contents(pool, user_id, folder_id).await?;
    let file_ids: Vec<String> = files.iter().map(|file| file.id.clone()).collect();
    let storage_object_count = if file_ids.is_empty() {
        0
    } else {
        let rows: Vec<(Option<i32>,)> = sqlx::query_as(
            "SELECT segment_count FROM files WHERE user_id = $1 AND id = ANY($2)",
        )
        .bind(user_id)
        .bind(&file_ids)
        .fetch_all(pool)
        .await?;
        rows.iter()
            .map(|(segment_count,)| storage_object_count(*segment_count))
            .sum()
    };

    Ok((files, subfolder_count, storage_object_count))
}

// Human: Aggregate nested file mime types into labeled counts for the delete confirmation UI.
// Agent: READS collect_folder_contents; RETURNS ordered FolderContentTypeCount list.
fn summarize_content_types(files: &[FolderContentFile]) -> Vec<FolderContentTypeCount> {
    let mut counts: std::collections::HashMap<&'static str, (u32, &'static str)> =
        std::collections::HashMap::new();

    for file in files {
        let (kind, label) = mime_content_kind(&file.mime_type);
        counts
            .entry(kind)
            .and_modify(|(count, _)| *count += 1)
            .or_insert((1, label));
    }

    CONTENT_KIND_ORDER
        .iter()
        .filter_map(|kind| {
            counts.get(*kind).map(|(count, label)| FolderContentTypeCount {
                kind: (*kind).to_string(),
                label: (*label).to_string(),
                count: *count,
            })
        })
        .collect()
}

// Human: Preview what deleting a folder would remove — file type counts and nested folders.
// Agent: GET /folders/:id/deletion-preview; READS subtree; NO storage mutations.
pub async fn folder_deletion_preview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<FolderDeletionPreviewResponse>, AppError> {
    ensure_folder_owned(&state.pool, &claims.sub, &id).await?;

    let (files, subfolder_count, storage_object_count) =
        folder_files_for_deletion_preview(&state.pool, &claims.sub, &id).await?;
    let file_ids: Vec<String> = files.iter().map(|file| file.id.clone()).collect();

    Ok(Json(FolderDeletionPreviewResponse {
        file_count: files.len() as u32,
        subfolder_count,
        content_types: summarize_content_types(&files),
        file_ids,
        storage_object_count,
    }))
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

// Human: Paginated folder listing at the root or under a parent folder.
// Agent: READS listing::list_owned_folders; RETURNS share_public per row + has_more.
pub async fn list_folders(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<FolderListQuery>,
) -> Result<Json<FolderListResponse>, AppError> {
    if let Some(parent_id) = query.parent_id.as_deref() {
        ensure_folder_owned(&state.pool, &claims.sub, parent_id).await?;
    }

    let (limit, offset) = listing::normalize_page(query.limit, query.offset);
    let response = listing::list_owned_folders(
        &state.pool,
        &claims.sub,
        ListFoldersParams {
            parent_id: query.parent_id,
            limit,
            offset,
        },
    )
    .await?;

    Ok(Json(FolderListResponse {
        folders: response.folders,
        folder_count: response.folder_count,
        has_more: response.has_more,
    }))
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

// Human: Move a folder to the recycle bin, or permanently delete when ?permanent=true.
// Agent: DEFAULT soft-deletes subtree (folders.trash); permanent purges storage blobs per file.
pub async fn delete_folder(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<DeleteQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(String, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT name, deleted_at FROM folders WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (name, deleted_at) = row.ok_or(AppError::NotFound)?;

    if !query.permanent {
        if deleted_at.is_some() {
            return Ok(Json(serde_json::json!({ "ok": true })));
        }

        recycle_bin::soft_delete_owned_folder(&state.pool, &claims.sub, &id).await?;

        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "folders.trash",
            Some("folder"),
            Some(&id),
            Some(serde_json::json!({ "name": name })),
            &headers,
        )
        .await
        .ok();

        return Ok(Json(serde_json::json!({ "ok": true })));
    }

    let (files, subfolder_count) = if deleted_at.is_some() {
        let (file_ids, folder_ids) =
            recycle_bin::collect_trashed_folder_subtree(&state.pool, &claims.sub, &id).await?;
        let subfolder_count = folder_ids.len().saturating_sub(1) as u32;
        let files: Vec<FolderContentFile> = if file_ids.is_empty() {
            Vec::new()
        } else {
            let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                "SELECT id, mime_type FROM files WHERE user_id = $1 AND id = ANY($2)",
            )
            .bind(&claims.sub)
            .bind(&file_ids)
            .fetch_all(&state.pool)
            .await?;
            rows.into_iter()
                .map(|(id, mime_type)| FolderContentFile { id, mime_type })
                .collect()
        };
        (files, subfolder_count)
    } else {
        collect_folder_contents(&state.pool, &claims.sub, &id).await?
    };
    let content_types = summarize_content_types(&files);
    let file_count = files.len() as u32;
    let file_ids: Vec<String> = files.into_iter().map(|file| file.id).collect();

    let purged =
        permanent_delete_owned_files(&state, &state.pool, &claims.sub, &file_ids, None).await?;
    for row in &purged {
        audit::write_audit(
            &state.pool,
            Some(&claims.sub),
            "files.delete.permanent",
            Some("file"),
            Some(&row.id),
            Some(serde_json::json!({
                "name": row.name,
                "via": "folders.delete.permanent",
                "folder_id": id,
            })),
            &headers,
        )
        .await
        .ok();
    }

    sqlx::query("DELETE FROM folders WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "folders.delete.permanent",
        Some("folder"),
        Some(&id),
        Some(serde_json::json!({
            "name": name,
            "file_count": file_count,
            "subfolder_count": subfolder_count,
            "content_types": content_types,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}
