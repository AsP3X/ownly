// Human: File/folder access helpers — authorize or load rows with permission checks.
// Agent: WRAPS authz::authorize; REPLACES bare user_id=claims.sub checks in handlers.

use sqlx::PgPool;

use crate::{
    authz::{authorize, Permission, ResourceRef},
    error::AppError,
    files::folders::FolderDto,
};

// Human: Gate an action on a file by id — NotFound when missing, Forbidden when denied.
// Agent: READS files row; CALLS authorize Content* on File(id).
pub async fn ensure_file_access(
    pool: &PgPool,
    user_id: &str,
    file_id: &str,
    permission: Permission,
) -> Result<(), AppError> {
    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    authorize(
        pool,
        user_id,
        permission,
        ResourceRef::File(file_id.to_string()),
    )
    .await
}

// Human: Gate an action on a folder by id.
// Agent: READS folders row; CALLS authorize on Folder(id).
pub async fn ensure_folder_access(
    pool: &PgPool,
    user_id: &str,
    folder_id: &str,
    permission: Permission,
) -> Result<(), AppError> {
    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM folders WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(folder_id)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    authorize(
        pool,
        user_id,
        permission,
        ResourceRef::Folder(folder_id.to_string()),
    )
    .await
}

// Human: Upload target folder — root is owned-only unless instance grant (no folder id).
// Agent: WHEN Some(folder_id) ensure_folder_access write; root requires implicit owner context from caller.
pub async fn ensure_upload_folder_access(
    pool: &PgPool,
    user_id: &str,
    folder_id: Option<&str>,
) -> Result<(), AppError> {
    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    ensure_folder_access(pool, user_id, folder_id, Permission::ContentWrite).await
}

// Human: Collect folder ids where user has content.read via direct folder grant (allow, not deny).
// Agent: READS permission_grants for user+groups; EXPANDS each granted folder to all descendants.
pub async fn readable_folder_subtree_ids(
    pool: &PgPool,
    user_id: &str,
) -> Result<Vec<String>, AppError> {
    let group_ids = crate::authz::load_user_group_ids(pool, user_id).await?;
    let mut root_ids = Vec::new();

    let user_grants: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT resource_id FROM permission_grants \
         WHERE subject_type = 'user' AND subject_id = $1 \
           AND resource_type = 'folder' AND resource_id IS NOT NULL \
           AND permission IN ('content.read','content.write','content.delete','content.share','content.manage_acl') \
           AND effect = 'allow' AND (expires_at IS NULL OR expires_at > now())",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    root_ids.extend(user_grants.into_iter().map(|(id,)| id));

    for group_id in &group_ids {
        let grants: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT resource_id FROM permission_grants \
             WHERE subject_type = 'group' AND subject_id = $1 \
               AND resource_type = 'folder' AND resource_id IS NOT NULL \
               AND permission IN ('content.read','content.write','content.delete','content.share','content.manage_acl') \
               AND effect = 'allow' AND (expires_at IS NULL OR expires_at > now())",
        )
        .bind(group_id)
        .fetch_all(pool)
        .await?;
        root_ids.extend(grants.into_iter().map(|(id,)| id));
    }

    root_ids.sort();
    root_ids.dedup();

    let mut all = Vec::new();
    for root in root_ids {
        all.push(root.clone());
        collect_descendant_folder_ids(pool, &root, &mut all).await?;
    }
    all.sort();
    all.dedup();
    Ok(all)
}

async fn collect_descendant_folder_ids(
    pool: &PgPool,
    parent_id: &str,
    out: &mut Vec<String>,
) -> Result<(), AppError> {
    let mut queue = vec![parent_id.to_string()];
    while let Some(current) = queue.pop() {
        let children: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM folders WHERE parent_id = $1 AND deleted_at IS NULL",
        )
        .bind(&current)
        .fetch_all(pool)
        .await?;
        for (child,) in children {
            out.push(child.clone());
            queue.push(child);
        }
    }
    Ok(())
}

// Human: File ids with direct content.read grant (user or group).
// Agent: SUPPLEMENTS owned listing for grantee drive views.
pub async fn directly_granted_file_ids(pool: &PgPool, user_id: &str) -> Result<Vec<String>, AppError> {
    let group_ids = crate::authz::load_user_group_ids(pool, user_id).await?;
    let mut ids = Vec::new();

    let user_rows: Vec<(String,)> = sqlx::query_as(
        "SELECT resource_id FROM permission_grants \
         WHERE subject_type = 'user' AND subject_id = $1 \
           AND resource_type = 'file' AND resource_id IS NOT NULL AND effect = 'allow' \
           AND permission IN ('content.read','content.write','content.delete','content.share','content.manage_acl') \
           AND (expires_at IS NULL OR expires_at > now())",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    ids.extend(user_rows.into_iter().map(|(id,)| id));

    for gid in group_ids {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT resource_id FROM permission_grants \
             WHERE subject_type = 'group' AND subject_id = $1 \
               AND resource_type = 'file' AND resource_id IS NOT NULL AND effect = 'allow' \
               AND permission IN ('content.read','content.write','content.delete','content.share','content.manage_acl') \
               AND (expires_at IS NULL OR expires_at > now())",
        )
        .bind(&gid)
        .fetch_all(pool)
        .await?;
        ids.extend(rows.into_iter().map(|(id,)| id));
    }

    ids.sort();
    ids.dedup();
    Ok(ids)
}

// Human: Load folder metadata after access check (shared or owned).
// Agent: RETURNS FolderDto when content.read authorized.
pub async fn load_folder_if_readable(
    pool: &PgPool,
    user_id: &str,
    folder_id: &str,
) -> Result<FolderDto, AppError> {
    ensure_folder_access(pool, user_id, folder_id, Permission::ContentRead).await?;
    let folder: FolderDto = sqlx::query_as(
        "SELECT id, name, parent_id, created_at, updated_at FROM folders \
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(folder_id)
    .fetch_one(pool)
    .await
    .map_err(|_| AppError::NotFound)?;
    Ok(folder)
}

// Human: Verify the caller holds `permission` on every file id in the list.
// Agent: CALLS authorize per id; RETURNS Forbidden/NotFound on first failure.
pub async fn ensure_each_file_access(
    pool: &PgPool,
    user_id: &str,
    file_ids: &[String],
    permission: Permission,
) -> Result<(), AppError> {
    for file_id in file_ids {
        ensure_file_access(pool, user_id, file_id, permission).await?;
    }
    Ok(())
}

// Human: Resolve file rows by id after content.delete authorization (owner or grantee).
// Agent: READS files without user_id filter; ERRORS when any id missing or denied.
pub async fn load_files_for_delete(
    pool: &PgPool,
    actor_id: &str,
    file_ids: &[String],
) -> Result<Vec<(String, String, Option<i32>)>, AppError> {
    ensure_each_file_access(pool, actor_id, file_ids, Permission::ContentDelete).await?;

    let rows: Vec<(String, String, Option<i32>)> = sqlx::query_as(
        "SELECT id, name, segment_count FROM files WHERE id = ANY($1) ORDER BY name ASC",
    )
    .bind(file_ids)
    .fetch_all(pool)
    .await?;

    if rows.len() != file_ids.len() {
        return Err(AppError::NotFound);
    }

    Ok(rows)
}

// Human: Batch-fetch file list items the caller may read (owned or granted).
// Agent: FILTERS ids through authorize ContentRead; PRESERVES request order.
pub async fn batch_readable_files(
    pool: &PgPool,
    user_id: &str,
    ids: Vec<String>,
    minimal: bool,
) -> Result<Vec<crate::files::listing::FileListItem>, AppError> {
    use crate::files::listing::{file_list_select_columns, MAX_BATCH_IDS};
    use crate::files::recycle_bin::F_ACTIVE_FILES_SQL;

    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<String> = ids.into_iter().take(MAX_BATCH_IDS).collect();
    let mut allowed = Vec::new();
    for id in &ids {
        if authorize(
            pool,
            user_id,
            Permission::ContentRead,
            ResourceRef::File(id.clone()),
        )
        .await
        .is_ok()
        {
            allowed.push(id.clone());
        }
    }

    if allowed.is_empty() {
        return Ok(Vec::new());
    }

    let select_cols = file_list_select_columns(minimal);
    let list_sql = format!(
        "SELECT {select_cols} FROM files f WHERE {F_ACTIVE_FILES_SQL} AND f.id = ANY($1)"
    );
    let rows: Vec<crate::files::listing::FileListItem> = sqlx::query_as(&list_sql)
        .bind(&allowed)
        .fetch_all(pool)
        .await?;

    let by_id: std::collections::HashMap<String, crate::files::listing::FileListItem> =
        rows.into_iter().map(|row| (row.id.clone(), row)).collect();

    Ok(ids
        .into_iter()
        .filter_map(|id| by_id.get(&id).cloned())
        .collect())
}
