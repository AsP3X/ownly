// Human: Paginated drive listings with share indicators and optional lightweight row shapes.
// Agent: READS files/folders + public_shares; RETURNS page metadata for the drive UI.

use sqlx::PgPool;

use crate::error::AppError;

pub const DEFAULT_LIST_LIMIT: i64 = 200;
pub const MAX_LIST_LIMIT: i64 = 500;
pub const MAX_BATCH_IDS: usize = 100;

// Human: Drive row including HLS transcode fields and whether a public link exists.
// Agent: SERIALIZED to /files list + batch responses; share_public from LEFT JOIN public_shares.
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct FileListItem {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub hls_ready: bool,
    pub hls_encode_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hls_encode_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<i32>,
    pub conversion_progress: i32,
    pub share_public: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct FileListResponse {
    pub files: Vec<FileListItem>,
    pub total_bytes: i64,
    pub file_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
pub struct ListFilesParams {
    pub folder_id: Option<String>,
    pub search: Option<String>,
    pub limit: i64,
    pub offset: i64,
    pub minimal: bool,
    pub type_filter: Option<String>,
}

// Human: Folder row for paginated /folders listings with public-link indicator.
// Agent: SERIALIZED to /folders; share_public from EXISTS on public_shares.
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct FolderListItem {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub share_public: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct FolderListResponse {
    pub folders: Vec<FolderListItem>,
    pub folder_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
pub struct ListFoldersParams {
    pub parent_id: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

// Human: Clamp client limit/offset to safe server bounds.
// Agent: DEFAULT_LIST_LIMIT when missing; MAX_LIST_LIMIT cap; non-negative offset.
pub fn normalize_page(limit: Option<i64>, offset: Option<i64>) -> (i64, i64) {
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    let offset = offset.unwrap_or(0).max(0);
    (limit, offset)
}

// Human: SQL fragment matching frontend fileMatchesTypeFilter buckets.
// Agent: APPENDED to list WHERE clauses when type_filter query param is set.
fn mime_type_filter_sql(type_filter: &str) -> Option<&'static str> {
    match type_filter {
        "documents" => Some(
            "(mime_type ILIKE 'text/%' OR mime_type ILIKE '%pdf%' OR mime_type ILIKE '%word%' \
             OR mime_type ILIKE '%document%' OR mime_type ILIKE '%json%' OR mime_type ILIKE '%xml%')",
        ),
        "spreadsheets" => Some(
            "(mime_type ILIKE '%sheet%' OR mime_type ILIKE '%excel%' OR mime_type ILIKE '%csv%')",
        ),
        "presentations" => {
            Some("(mime_type ILIKE '%presentation%' OR mime_type ILIKE '%powerpoint%')")
        }
        "images" => Some("(mime_type ILIKE 'image/%')"),
        "video" => Some("(mime_type ILIKE 'video/%')"),
        "audio" => Some("(mime_type ILIKE 'audio/%')"),
        _ => None,
    }
}

const SHARE_PUBLIC_FILE_EXPR: &str = "EXISTS (
    SELECT 1 FROM public_shares ps
    WHERE ps.user_id = f.user_id
      AND ps.resource_type = 'file'
      AND ps.resource_id = f.id
      AND ps.revoked_at IS NULL
) AS share_public";

const SHARE_PUBLIC_FOLDER_EXPR: &str = "EXISTS (
    SELECT 1 FROM public_shares ps
    WHERE ps.user_id = fo.user_id
      AND ps.resource_type = 'folder'
      AND ps.resource_id = fo.id
      AND ps.revoked_at IS NULL
) AS share_public";

// Human: Default drive browser sort — case-insensitive A–Z with natural numeric segments.
// Agent: USES natural_sort_key() from migration 008; MUST match frontend sortFilesByName.
const ORDER_FILES_BY_NATURAL_NAME: &str = "natural_sort_key(f.name) ASC, lower(f.name) ASC";
const ORDER_FOLDERS_BY_NATURAL_NAME: &str = "natural_sort_key(fo.name) ASC, lower(fo.name) ASC";

// Human: List one page of owned files for a folder, search, or library-wide query.
// Agent: READS files + public_shares EXISTS; COMPUTES count/sum/has_more in SQL.
pub async fn list_owned_files(
    pool: &PgPool,
    user_id: &str,
    params: ListFilesParams,
) -> Result<FileListResponse, AppError> {
    let search = params
        .search
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let minimal = params.minimal;
    let type_clause = params
        .type_filter
        .as_deref()
        .and_then(mime_type_filter_sql);

    let hls_error_col = if minimal {
        "NULL::TEXT AS hls_encode_error"
    } else {
        "f.hls_encode_error"
    };
    let duration_col = if minimal {
        "NULL::INT AS duration_seconds"
    } else {
        "f.duration_seconds"
    };

    let select_cols = format!(
        "f.id, f.name, f.mime_type, f.size_bytes, f.folder_id, f.created_at, f.updated_at, \
         f.hls_ready, f.hls_encode_status, {hls_error_col}, f.conversion_progress, {duration_col}, \
         {SHARE_PUBLIC_FILE_EXPR}"
    );

    let (files, file_count, total_bytes) = if search.is_empty() {
        let mut where_parts = vec![
            "f.user_id = $1".to_string(),
            "(($2::text IS NULL AND f.folder_id IS NULL) OR f.folder_id = $2)".to_string(),
        ];
        if let Some(clause) = type_clause {
            where_parts.push(clause.to_string());
        }
        let where_sql = where_parts.join(" AND ");

        let count_sql = format!(
            "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(f.size_bytes), 0)::BIGINT \
             FROM files f WHERE {where_sql}"
        );
        let (file_count, total_bytes): (i64, i64) = sqlx::query_as(&count_sql)
            .bind(user_id)
            .bind(&params.folder_id)
            .fetch_one(pool)
            .await?;

        let list_sql = format!(
            "SELECT {select_cols} FROM files f \
             WHERE {where_sql} \
             ORDER BY {ORDER_FILES_BY_NATURAL_NAME} \
             LIMIT $3 OFFSET $4"
        );
        let files: Vec<FileListItem> = sqlx::query_as(&list_sql)
            .bind(user_id)
            .bind(&params.folder_id)
            .bind(params.limit)
            .bind(params.offset)
            .fetch_all(pool)
            .await?;

        (files, file_count, total_bytes)
    } else {
        let pattern = format!("%{search}%");
        let mut where_parts = vec![
            "f.user_id = $1".to_string(),
            "LOWER(f.name) LIKE $2".to_string(),
        ];
        if let Some(clause) = type_clause {
            where_parts.push(clause.to_string());
        }
        let where_sql = where_parts.join(" AND ");

        let count_sql = format!(
            "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(f.size_bytes), 0)::BIGINT \
             FROM files f WHERE {where_sql}"
        );
        let (file_count, total_bytes): (i64, i64) = sqlx::query_as(&count_sql)
            .bind(user_id)
            .bind(&pattern)
            .fetch_one(pool)
            .await?;

        let list_sql = format!(
            "SELECT {select_cols} FROM files f \
             WHERE {where_sql} \
             ORDER BY {ORDER_FILES_BY_NATURAL_NAME} \
             LIMIT $3 OFFSET $4"
        );
        let files: Vec<FileListItem> = sqlx::query_as(&list_sql)
            .bind(user_id)
            .bind(&pattern)
            .bind(params.limit)
            .bind(params.offset)
            .fetch_all(pool)
            .await?;

        (files, file_count, total_bytes)
    };

    let has_more = params.offset + (files.len() as i64) < file_count;

    Ok(FileListResponse {
        files,
        total_bytes,
        file_count,
        has_more,
    })
}

// Human: Resolve a bounded set of owned files by id (Home recent/favourites).
// Agent: READS files WHERE id = ANY($2); SKIPS unknown ids; PRESERVES request order.
pub async fn batch_owned_files(
    pool: &PgPool,
    user_id: &str,
    ids: Vec<String>,
    minimal: bool,
) -> Result<Vec<FileListItem>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<String> = ids.into_iter().take(MAX_BATCH_IDS).collect();

    let hls_error_col = if minimal {
        "NULL::TEXT AS hls_encode_error"
    } else {
        "f.hls_encode_error"
    };
    let duration_col = if minimal {
        "NULL::INT AS duration_seconds"
    } else {
        "f.duration_seconds"
    };

    let select_cols = format!(
        "f.id, f.name, f.mime_type, f.size_bytes, f.folder_id, f.created_at, f.updated_at, \
         f.hls_ready, f.hls_encode_status, {hls_error_col}, f.conversion_progress, {duration_col}, \
         {SHARE_PUBLIC_FILE_EXPR}"
    );

    let list_sql = format!(
        "SELECT {select_cols} FROM files f \
         WHERE f.user_id = $1 AND f.id = ANY($2)"
    );
    let rows: Vec<FileListItem> = sqlx::query_as(&list_sql)
        .bind(user_id)
        .bind(&ids)
        .fetch_all(pool)
        .await?;

    let by_id: std::collections::HashMap<String, FileListItem> =
        rows.into_iter().map(|row| (row.id.clone(), row)).collect();

    Ok(ids
        .into_iter()
        .filter_map(|id| by_id.get(&id).cloned())
        .collect())
}

// Human: List one page of folders at the root or under a parent folder.
// Agent: READS folders + share EXISTS; RETURNS folder_count and has_more.
pub async fn list_owned_folders(
    pool: &PgPool,
    user_id: &str,
    params: ListFoldersParams,
) -> Result<FolderListResponse, AppError> {
    let where_sql = "fo.user_id = $1 AND (($2::text IS NULL AND fo.parent_id IS NULL) OR fo.parent_id = $2)";

    let folder_count: (i64,) = sqlx::query_as(&format!(
        "SELECT COALESCE(COUNT(*), 0) FROM folders fo WHERE {where_sql}"
    ))
    .bind(user_id)
    .bind(&params.parent_id)
    .fetch_one(pool)
    .await?;

    let select_cols = format!(
        "fo.id, fo.name, fo.parent_id, fo.created_at, fo.updated_at, {SHARE_PUBLIC_FOLDER_EXPR}"
    );
    let list_sql = format!(
        "SELECT {select_cols} FROM folders fo \
         WHERE {where_sql} \
         ORDER BY {ORDER_FOLDERS_BY_NATURAL_NAME} \
         LIMIT $3 OFFSET $4"
    );
    let folders: Vec<FolderListItem> = sqlx::query_as(&list_sql)
        .bind(user_id)
        .bind(&params.parent_id)
        .bind(params.limit)
        .bind(params.offset)
        .fetch_all(pool)
        .await?;

    let folder_count = folder_count.0;
    let has_more = params.offset + (folders.len() as i64) < folder_count;

    Ok(FolderListResponse {
        folders,
        folder_count,
        has_more,
    })
}
