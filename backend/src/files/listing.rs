// Human: Paginated drive listings with share indicators and optional lightweight row shapes.
// Agent: READS files/folders + public_shares; RETURNS page metadata for the drive UI.

use sqlx::PgPool;

use crate::{
    error::AppError,
    files::recycle_bin::{F_ACTIVE_FILES_SQL, FO_ACTIVE_FOLDERS_SQL},
};

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
    pub audio_waveform_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_encode_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_encode_error: Option<String>,
    pub video_thumbnail_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_thumbnail_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_thumbnail_error: Option<String>,
    pub video_thumbnail_progress: i32,
    pub video_thumbnail_selected_index: i32,
    pub image_thumbnail_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_thumbnail_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_thumbnail_error: Option<String>,
    pub document_thumbnail_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_thumbnail_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_thumbnail_error: Option<String>,
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
    pub search: Option<String>,
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

// Human: Shared SELECT column list for file list/batch queries including audio waveform status.
// Agent: READS minimal flag; OMITS heavy error columns when minimal=true.
// Human: Build SELECT column list for file list/batch queries (full vs minimal DTO).
// Agent: USED by list/search/batch_accessible_files.
pub(crate) fn file_list_select_columns(minimal: bool) -> String {
    let hls_error_col = if minimal {
        "NULL::TEXT AS hls_encode_error"
    } else {
        "f.hls_encode_error"
    };
    let audio_error_col = if minimal {
        "NULL::TEXT AS audio_encode_error"
    } else {
        "f.audio_encode_error"
    };
    let thumbnail_error_col = if minimal {
        "NULL::TEXT AS video_thumbnail_error"
    } else {
        "f.video_thumbnail_error"
    };
    let image_thumbnail_error_col = if minimal {
        "NULL::TEXT AS image_thumbnail_error"
    } else {
        "f.image_thumbnail_error"
    };
    let document_thumbnail_error_col = if minimal {
        "NULL::TEXT AS document_thumbnail_error"
    } else {
        "f.document_thumbnail_error"
    };
    let duration_col = if minimal {
        "NULL::INT AS duration_seconds"
    } else {
        "f.duration_seconds"
    };

    format!(
        "f.id, f.name, f.mime_type, f.size_bytes, f.folder_id, f.created_at, f.updated_at, \
         f.hls_ready, f.hls_encode_status, {hls_error_col}, f.conversion_progress, {duration_col}, \
         f.audio_waveform_ready, f.audio_encode_status, {audio_error_col}, \
         f.video_thumbnail_ready, f.video_thumbnail_status, {thumbnail_error_col}, \
         f.video_thumbnail_progress, f.video_thumbnail_selected_index, \
         f.image_thumbnail_ready, f.image_thumbnail_status, {image_thumbnail_error_col}, \
         f.document_thumbnail_ready, f.document_thumbnail_status, {document_thumbnail_error_col}, \
         {SHARE_PUBLIC_FILE_EXPR}"
    )
}

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

    let select_cols = file_list_select_columns(minimal);

    let (files, file_count, total_bytes) = if search.is_empty() {
        let mut where_parts = vec![
            "f.user_id = $1".to_string(),
            F_ACTIVE_FILES_SQL.to_string(),
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
            F_ACTIVE_FILES_SQL.to_string(),
            "(LOWER(f.name) LIKE $2 OR LOWER(split_part(f.name, '.', -1)) LIKE $2)".to_string(),
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

    let select_cols = file_list_select_columns(minimal);

    let list_sql = format!(
        "SELECT {select_cols} FROM files f \
         WHERE f.user_id = $1 AND {F_ACTIVE_FILES_SQL} AND f.id = ANY($2)"
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
    let search = params
        .search
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();

    let select_cols = format!(
        "fo.id, fo.name, fo.parent_id, fo.created_at, fo.updated_at, {SHARE_PUBLIC_FOLDER_EXPR}"
    );

    let (folders, folder_count) = if search.is_empty() {
        let where_sql = format!(
            "fo.user_id = $1 AND {FO_ACTIVE_FOLDERS_SQL} \
             AND (($2::text IS NULL AND fo.parent_id IS NULL) OR fo.parent_id = $2)"
        );

        let folder_count: (i64,) = sqlx::query_as(&format!(
            "SELECT COALESCE(COUNT(*), 0) FROM folders fo WHERE {where_sql}"
        ))
        .bind(user_id)
        .bind(&params.parent_id)
        .fetch_one(pool)
        .await?;

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

        (folders, folder_count.0)
    } else {
        let pattern = format!("%{search}%");
        let where_sql = format!(
            "fo.user_id = $1 AND {FO_ACTIVE_FOLDERS_SQL} AND LOWER(fo.name) LIKE $2"
        );

        let folder_count: (i64,) = sqlx::query_as(&format!(
            "SELECT COALESCE(COUNT(*), 0) FROM folders fo WHERE {where_sql}"
        ))
        .bind(user_id)
        .bind(&pattern)
        .fetch_one(pool)
        .await?;

        let list_sql = format!(
            "SELECT {select_cols} FROM folders fo \
             WHERE {where_sql} \
             ORDER BY {ORDER_FOLDERS_BY_NATURAL_NAME} \
             LIMIT $3 OFFSET $4"
        );
        let folders: Vec<FolderListItem> = sqlx::query_as(&list_sql)
            .bind(user_id)
            .bind(&pattern)
            .bind(params.limit)
            .bind(params.offset)
            .fetch_all(pool)
            .await?;

        (folders, folder_count.0)
    };

    let has_more = params.offset + (folders.len() as i64) < folder_count;

    Ok(FolderListResponse {
        folders,
        folder_count,
        has_more,
    })
}

// Human: Owned files plus grant-accessible files in the same folder (atomic permissions).
// Agent: UNION list_owned_files with rows where folder is in readable subtree or file has direct grant.
pub async fn list_accessible_files(
    pool: &PgPool,
    user_id: &str,
    params: ListFilesParams,
) -> Result<FileListResponse, AppError> {
    let mut response = list_owned_files(pool, user_id, params.clone()).await?;

    let search = params
        .search
        .as_deref()
        .unwrap_or("")
        .trim();
    if !search.is_empty() {
        return Ok(response);
    }

    let readable_folders = crate::files::access::readable_folder_subtree_ids(pool, user_id).await?;
    let direct_files = crate::files::access::directly_granted_file_ids(pool, user_id).await?;
    if readable_folders.is_empty() && direct_files.is_empty() {
        return Ok(response);
    }

    let select_cols = file_list_select_columns(params.minimal);
    let type_clause = params
        .type_filter
        .as_deref()
        .and_then(mime_type_filter_sql);

    let mut extra_where = vec![
        format!("f.user_id <> $1 AND {F_ACTIVE_FILES_SQL}"),
        "(($2::text IS NULL AND f.folder_id IS NULL) OR f.folder_id = $2)".to_string(),
        "(f.folder_id = ANY($3) OR f.id = ANY($4))".to_string(),
    ];
    if let Some(clause) = type_clause {
        extra_where.push(clause.to_string());
    }
    let where_sql = extra_where.join(" AND ");

    let list_sql = format!(
        "SELECT {select_cols} FROM files f \
         WHERE {where_sql} \
         ORDER BY {ORDER_FILES_BY_NATURAL_NAME} \
         LIMIT $5 OFFSET $6"
    );

    let granted: Vec<FileListItem> = sqlx::query_as(&list_sql)
        .bind(user_id)
        .bind(&params.folder_id)
        .bind(&readable_folders)
        .bind(&direct_files)
        .bind(params.limit)
        .bind(params.offset)
        .fetch_all(pool)
        .await?;

    let mut seen: std::collections::HashSet<String> =
        response.files.iter().map(|f| f.id.clone()).collect();
    for row in granted {
        if seen.insert(row.id.clone()) {
            response.files.push(row);
        }
    }

    response.file_count = response.files.len() as i64;
    response.has_more = false;
    Ok(response)
}

// Human: Owned folders plus grant-readable child folders under an accessible parent.
// Agent: MERGES list_owned_folders with folders user can read via permission_grants.
pub async fn list_accessible_folders(
    pool: &PgPool,
    user_id: &str,
    params: ListFoldersParams,
) -> Result<FolderListResponse, AppError> {
    let mut response = list_owned_folders(pool, user_id, params.clone()).await?;

    let search = params
        .search
        .as_deref()
        .unwrap_or("")
        .trim();
    if !search.is_empty() {
        return Ok(response);
    }

    let readable_folders = crate::files::access::readable_folder_subtree_ids(pool, user_id).await?;
    if readable_folders.is_empty() {
        return Ok(response);
    }

    let select_cols = format!(
        "fo.id, fo.name, fo.parent_id, fo.created_at, fo.updated_at, {SHARE_PUBLIC_FOLDER_EXPR}"
    );
    let list_sql = format!(
        "SELECT {select_cols} FROM folders fo \
         WHERE fo.user_id <> $1 AND {FO_ACTIVE_FOLDERS_SQL} \
           AND (($2::text IS NULL AND fo.parent_id IS NULL) OR fo.parent_id = $2) \
           AND fo.id = ANY($3) \
         ORDER BY {ORDER_FOLDERS_BY_NATURAL_NAME} \
         LIMIT $4 OFFSET $5"
    );

    let granted: Vec<FolderListItem> = sqlx::query_as(&list_sql)
        .bind(user_id)
        .bind(&params.parent_id)
        .bind(&readable_folders)
        .bind(params.limit)
        .bind(params.offset)
        .fetch_all(pool)
        .await?;

    let mut seen: std::collections::HashSet<String> =
        response.folders.iter().map(|f| f.id.clone()).collect();
    for row in granted {
        if seen.insert(row.id.clone()) {
            response.folders.push(row);
        }
    }

    response.folder_count = response.folders.len() as i64;
    response.has_more = false;
    Ok(response)
}

// Human: One library row whose stored content hash matches a pending upload.
// Agent: SERIALIZED in check-upload-names response; folder_name from LEFT JOIN folders.
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct UploadNameDuplicateMatch {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub size_bytes: i64,
}

// Human: Incoming upload content hash mapped to every owned library row with the same digest.
// Agent: GROUPED from flat SQL rows; upload_name preserves client casing for display.
#[derive(Debug, serde::Serialize)]
pub struct UploadNameDuplicate {
    pub upload_name: String,
    pub upload_content_hash: String,
    pub existing: Vec<UploadNameDuplicateMatch>,
}

// Human: One proposed upload row sent from the browser before queueing bytes.
// Agent: READS name, size_bytes, and content_hash; USED for recycle-bin exact matching.
#[derive(Debug, Clone)]
pub struct UploadCheckCandidate {
    pub name: String,
    pub size_bytes: i64,
    pub content_hash: String,
}

// Human: Trashed library row that exactly matches a pending upload (name + byte size).
// Agent: SERIALIZED in check-upload-names response; includes restore eligibility.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadRecycleMatchItem {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub size_bytes: i64,
    pub deleted_at: chrono::DateTime<chrono::Utc>,
    pub can_restore: bool,
}

// Human: Pending upload mapped to the best recycle-bin row to restore instead of re-uploading.
// Agent: GROUPED per candidate; PREFERS most recently deleted row when several match.
#[derive(Debug, serde::Serialize)]
pub struct UploadRecycleMatch {
    pub upload_name: String,
    pub upload_size_bytes: i64,
    pub trashed: UploadRecycleMatchItem,
}

// Human: Dedupe and bound upload preflight candidates from the file picker.
// Agent: TRIMS names; DEDUPES by content_hash; CAPS at MAX_BATCH_IDS.
pub fn normalize_upload_check_candidates(
    files: Vec<UploadCheckCandidate>,
) -> Vec<UploadCheckCandidate> {
    let mut normalized = Vec::new();
    for file in files {
        let name = file.name.trim();
        if name.is_empty() {
            continue;
        }
        if !normalized
            .iter()
            .any(|existing: &UploadCheckCandidate| {
                existing.content_hash == file.content_hash
            })
        {
            normalized.push(UploadCheckCandidate {
                name: name.to_string(),
                size_bytes: file.size_bytes,
                content_hash: file.content_hash.clone(),
            });
        }
    }
    normalized.into_iter().take(MAX_BATCH_IDS).collect()
}

// Human: Find owned active files whose stored content hash matches a pending upload digest.
// Agent: READS files + folders globally (any folder_id); RETURNS grouped duplicates only.
pub async fn check_upload_content_hash_duplicates(
    pool: &PgPool,
    user_id: &str,
    candidates: &[UploadCheckCandidate],
) -> Result<Vec<UploadNameDuplicate>, AppError> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut unique_hashes: Vec<String> = Vec::new();
    for candidate in candidates {
        if candidate.content_hash.is_empty() {
            continue;
        }
        if !unique_hashes
            .iter()
            .any(|existing| existing == &candidate.content_hash)
        {
            unique_hashes.push(candidate.content_hash.clone());
        }
    }

    if unique_hashes.is_empty() {
        return Ok(Vec::new());
    }

    let hashes: Vec<String> = unique_hashes.into_iter().take(MAX_BATCH_IDS).collect();

    // Human: Static SQL avoids format placeholders leaking into Postgres when the predicate is table-qualified.
    // Agent: READS active files globally; active filter must stay aligned with recycle_bin::F_ACTIVE_FILES_SQL.
    const CHECK_UPLOAD_CONTENT_HASH_DUPLICATES_SQL: &str = "\
        SELECT f.id, f.name, f.folder_id, f.size_bytes, fo.name AS folder_name, f.content_hash \
        FROM files f \
        LEFT JOIN folders fo ON fo.id = f.folder_id AND fo.user_id = f.user_id \
        WHERE f.user_id = $1 AND f.deleted_at IS NULL AND f.content_hash = ANY($2::text[]) \
        ORDER BY natural_sort_key(f.name) ASC, lower(f.name) ASC, fo.name NULLS FIRST";
    #[derive(Debug, Clone, sqlx::FromRow)]
    struct UploadContentHashDuplicateMatch {
        id: String,
        name: String,
        folder_id: Option<String>,
        folder_name: Option<String>,
        size_bytes: i64,
        content_hash: String,
    }

    let rows: Vec<UploadContentHashDuplicateMatch> =
        sqlx::query_as(CHECK_UPLOAD_CONTENT_HASH_DUPLICATES_SQL)
            .bind(user_id)
            .bind(&hashes)
            .fetch_all(pool)
            .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut by_hash: std::collections::BTreeMap<String, Vec<UploadNameDuplicateMatch>> =
        std::collections::BTreeMap::new();
    for row in rows {
        by_hash
            .entry(row.content_hash.clone())
            .or_default()
            .push(UploadNameDuplicateMatch {
                id: row.id,
                name: row.name,
                folder_id: row.folder_id,
                folder_name: row.folder_name,
                size_bytes: row.size_bytes,
            });
    }

    let mut duplicates = Vec::new();
    for candidate in candidates {
        let Some(existing) = by_hash.get(&candidate.content_hash) else {
            continue;
        };
        duplicates.push(UploadNameDuplicate {
            upload_name: candidate.name.clone(),
            upload_content_hash: candidate.content_hash.clone(),
            existing: existing.clone(),
        });
    }

    Ok(duplicates)
}

// Human: Find recycle-bin rows that exactly match pending uploads by filename and byte size.
// Agent: READS deleted files + folder restore eligibility; PREFERS newest deleted_at per key.
pub async fn check_upload_recycle_matches(
    pool: &PgPool,
    user_id: &str,
    candidates: &[UploadCheckCandidate],
) -> Result<Vec<UploadRecycleMatch>, AppError> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let names: Vec<String> = candidates
        .iter()
        .map(|candidate| candidate.name.clone())
        .collect();

    #[derive(Debug, sqlx::FromRow)]
    struct RecycleCandidateRow {
        id: String,
        name: String,
        folder_id: Option<String>,
        folder_name: Option<String>,
        size_bytes: i64,
        deleted_at: chrono::DateTime<chrono::Utc>,
        can_restore: bool,
    }

    let list_sql = "SELECT f.id, f.name, f.folder_id, f.size_bytes, fo.name AS folder_name, f.deleted_at, \
         CASE \
           WHEN f.folder_id IS NULL THEN true \
           WHEN EXISTS ( \
             SELECT 1 FROM folders p \
             WHERE p.id = f.folder_id AND p.user_id = f.user_id AND p.deleted_at IS NULL \
           ) THEN true \
           ELSE false \
         END AS can_restore \
         FROM files f \
         LEFT JOIN folders fo ON fo.id = f.folder_id AND fo.user_id = f.user_id \
         WHERE f.user_id = $1 AND f.deleted_at IS NOT NULL AND f.name = ANY($2::text[]) \
         ORDER BY f.deleted_at DESC";

    let rows: Vec<RecycleCandidateRow> = sqlx::query_as(list_sql)
        .bind(user_id)
        .bind(&names)
        .fetch_all(pool)
        .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut best_by_key: std::collections::BTreeMap<(String, i64), RecycleCandidateRow> =
        std::collections::BTreeMap::new();
    for row in rows {
        let key = (row.name.clone(), row.size_bytes);
        best_by_key.entry(key).or_insert(row);
    }

    let mut matches = Vec::new();
    for candidate in candidates {
        let Some(row) = best_by_key.get(&(candidate.name.clone(), candidate.size_bytes)) else {
            continue;
        };
        matches.push(UploadRecycleMatch {
            upload_name: candidate.name.clone(),
            upload_size_bytes: candidate.size_bytes,
            trashed: UploadRecycleMatchItem {
                id: row.id.clone(),
                name: row.name.clone(),
                folder_id: row.folder_id.clone(),
                folder_name: row.folder_name.clone(),
                size_bytes: row.size_bytes,
                deleted_at: row.deleted_at,
                can_restore: row.can_restore,
            },
        });
    }

    Ok(matches)
}
