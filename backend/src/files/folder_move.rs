// Human: Move folders within the hierarchy — cycle detection, sibling name checks, audit.
// Agent: CALLED from patch_folder; UPDATES folders.parent_id; REQUIRES ContentWrite grant.

use axum::http::HeaderMap;

use crate::{audit, error::AppError, files::folders::FolderDto};

use super::rename::{ensure_unique_folder_name, fetch_folder_dto};

// Human: Walk ancestors of candidate_id — true when ancestor_id appears on the path to root.
// Agent: READS folders.parent_id chain; USED to block moving a folder into its own subtree.
pub async fn folder_is_ancestor_of(
    pool: &sqlx::PgPool,
    user_id: &str,
    ancestor_id: &str,
    candidate_id: &str,
) -> Result<bool, AppError> {
    if ancestor_id == candidate_id {
        return Ok(true);
    }
    let mut current = Some(candidate_id.to_string());
    while let Some(id) = current {
        if id == ancestor_id {
            return Ok(true);
        }
        let parent: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT parent_id FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(&id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
        let Some((parent_id,)) = parent else {
            break;
        };
        current = parent_id;
    }
    Ok(false)
}

// Human: Reparent a folder to the drive root or another folder the user can write.
// Agent: VALIDATES cycle + sibling name collision; UPDATES parent_id; AUDIT folders.move.
pub async fn move_folder_in_place(
    pool: &sqlx::PgPool,
    headers: &HeaderMap,
    user_id: &str,
    folder_id: &str,
    target_parent_id: Option<String>,
) -> Result<FolderDto, AppError> {
    let current: Option<(Option<String>, String)> = sqlx::query_as(
        "SELECT parent_id, name FROM folders WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let (current_parent_id, name) = current.ok_or(AppError::NotFound)?;

    if current_parent_id.as_deref() == target_parent_id.as_deref() {
        return Err(AppError::BadRequest(
            "folder is already in this location".into(),
        ));
    }

    if let Some(ref parent_id) = target_parent_id {
        if parent_id == folder_id {
            return Err(AppError::BadRequest(
                "a folder cannot be moved into itself".into(),
            ));
        }
        if folder_is_ancestor_of(pool, user_id, folder_id, parent_id).await? {
            return Err(AppError::BadRequest(
                "a folder cannot be moved into its own subfolder".into(),
            ));
        }
        crate::files::access::ensure_folder_access(
            pool,
            user_id,
            parent_id,
            crate::authz::Permission::ContentWrite,
        )
        .await?;
    }

    ensure_unique_folder_name(pool, user_id, &target_parent_id, &name, folder_id).await?;

    sqlx::query(
        "UPDATE folders SET parent_id = $1, updated_at = NOW() \
         WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL",
    )
    .bind(&target_parent_id)
    .bind(folder_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    audit::write_audit(
        pool,
        Some(user_id),
        "folders.move",
        Some("folder"),
        Some(folder_id),
        Some(serde_json::json!({
            "name": name,
            "from_parent_id": current_parent_id,
            "to_parent_id": target_parent_id,
        })),
        headers,
    )
    .await
    .ok();

    fetch_folder_dto(pool, folder_id, user_id).await
}
