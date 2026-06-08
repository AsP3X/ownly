// Human: Effective permission evaluation — deny wins, folder inheritance, owner default.
// Agent: READS permission_grants + group_members + resource_user_shares; CALLED by authorize().

use sqlx::PgPool;

use crate::error::AppError;

use super::catalog::Permission;

/// Human: Resource target for authorization checks.
/// Agent: Instance | Folder(id) | File(id) — maps to grant_resource_type rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceRef {
    Instance,
    Folder(String),
    File(String),
}

impl ResourceRef {
    pub fn resource_type(&self) -> &'static str {
        match self {
            Self::Instance => "instance",
            Self::Folder(_) => "folder",
            Self::File(_) => "file",
        }
    }

    pub fn resource_id(&self) -> Option<&str> {
        match self {
            Self::Instance => None,
            Self::Folder(id) | Self::File(id) => Some(id.as_str()),
        }
    }
}

/// Human: Resolver outcome before owner fallback.
/// Agent: Allow | Deny | Absent (no matching grant).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    Allow,
    Deny,
    Absent,
}

#[derive(Debug, Clone)]
struct GrantRow {
    permission: String,
    effect: String,
}

// Human: Load group ids for a user — used on every permission check.
// Agent: READS group_members; RETURNS Vec<group_id>.
pub async fn load_user_group_ids(pool: &PgPool, user_id: &str) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT group_id FROM group_members WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

// Human: JWT/UI admin flag — member of seeded admin group.
// Agent: READS group_members JOIN groups WHERE slug=admin.
pub async fn user_is_admin_group_member(pool: &PgPool, user_id: &str) -> Result<bool, AppError> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT FROM group_members gm \
         JOIN groups g ON g.id = gm.group_id \
         WHERE gm.user_id = $1 AND g.slug = 'admin'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(count.0 > 0)
}

// Human: Derive JWT role string from admin group membership (Phase 1 compat).
// Agent: RETURNS admin when in admin group else pro/standard/user from users.role.
pub async fn effective_jwt_role(pool: &PgPool, user_id: &str, db_role: &str) -> Result<String, AppError> {
    if user_is_admin_group_member(pool, user_id).await? {
        return Ok("admin".into());
    }
    Ok(db_role.to_string())
}

// Human: Walk folder parent_id chain from leaf to root (inclusive).
// Agent: READS folders; STOPS at missing row; MAX 64 depth guard.
pub async fn folder_ancestor_chain(
    pool: &PgPool,
    folder_id: &str,
) -> Result<Vec<String>, AppError> {
    let mut chain = Vec::new();
    let mut current = Some(folder_id.to_string());
    for _ in 0..64 {
        let Some(id) = current else {
            break;
        };
        chain.push(id.clone());
        let parent: Option<(Option<String>,)> =
            sqlx::query_as("SELECT parent_id FROM folders WHERE id = $1 AND deleted_at IS NULL")
                .bind(&id)
                .fetch_optional(pool)
                .await?;
        current = match parent {
            Some((parent_id,)) => parent_id,
            None => None,
        };
    }
    Ok(chain)
}

async fn file_owner_and_folder(
    pool: &PgPool,
    file_id: &str,
) -> Result<Option<(String, Option<String>)>, AppError> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT user_id, folder_id FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

async fn folder_owner(pool: &PgPool, folder_id: &str) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM folders WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(folder_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

// Human: Legacy user-share row grants implicit content.read (backward compat with resource_user_shares).
// Agent: READS resource_user_shares WHERE grantee_user_id; MATCHES file or folder scope.
async fn has_legacy_user_share_read(
    pool: &PgPool,
    user_id: &str,
    resource: &ResourceRef,
) -> Result<bool, AppError> {
    match resource {
        ResourceRef::File(file_id) => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*)::BIGINT FROM resource_user_shares \
                 WHERE grantee_user_id = $1 AND resource_type = 'file' AND resource_id = $2",
            )
            .bind(user_id)
            .bind(file_id)
            .fetch_one(pool)
            .await?;
            Ok(count.0 > 0)
        }
        ResourceRef::Folder(folder_id) => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*)::BIGINT FROM resource_user_shares \
                 WHERE grantee_user_id = $1 AND resource_type = 'folder' AND resource_id = $2",
            )
            .bind(user_id)
            .bind(folder_id)
            .fetch_one(pool)
            .await?;
            Ok(count.0 > 0)
        }
        ResourceRef::Instance => Ok(false),
    }
}

async fn load_applicable_grants(
    pool: &PgPool,
    user_id: &str,
    group_ids: &[String],
    resource: &ResourceRef,
) -> Result<Vec<GrantRow>, AppError> {
    let mut resource_keys: Vec<(String, Option<String>)> = vec![("instance".into(), None)];

    match resource {
        ResourceRef::Instance => {}
        ResourceRef::Folder(folder_id) => {
            resource_keys.push(("folder".into(), Some(folder_id.clone())));
            for ancestor in folder_ancestor_chain(pool, folder_id).await? {
                resource_keys.push(("folder".into(), Some(ancestor)));
            }
        }
        ResourceRef::File(file_id) => {
            resource_keys.push(("file".into(), Some(file_id.clone())));
            if let Some((_owner, Some(fid))) = file_owner_and_folder(pool, file_id).await? {
                for ancestor in folder_ancestor_chain(pool, &fid).await? {
                    resource_keys.push(("folder".into(), Some(ancestor)));
                }
            }
        }
    }

    // Human: Deduplicate folder ids in chain (file path may repeat).
    // Agent: UNIQUE resource_keys before query.
    resource_keys.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    resource_keys.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);

    let mut grants = Vec::new();

    // User direct grants
    for (rtype, rid) in &resource_keys {
        let rows = fetch_grants_for_subject(pool, "user", user_id, rtype, rid.as_deref()).await?;
        grants.extend(rows);
    }

    // Group grants
    for group_id in group_ids {
        for (rtype, rid) in &resource_keys {
            let rows =
                fetch_grants_for_subject(pool, "group", group_id, rtype, rid.as_deref()).await?;
            grants.extend(rows);
        }
    }

    Ok(grants)
}

async fn fetch_grants_for_subject(
    pool: &PgPool,
    subject_type: &str,
    subject_id: &str,
    resource_type: &str,
    resource_id: Option<&str>,
) -> Result<Vec<GrantRow>, AppError> {
    let rows: Vec<(String, String)> = if resource_type == "instance" {
        sqlx::query_as(
            "SELECT permission, effect::TEXT \
             FROM permission_grants \
             WHERE subject_type = $1::grant_subject_type AND subject_id = $2 \
               AND resource_type = 'instance' AND resource_id IS NULL \
               AND (expires_at IS NULL OR expires_at > now())",
        )
        .bind(subject_type)
        .bind(subject_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT permission, effect::TEXT \
             FROM permission_grants \
             WHERE subject_type = $1::grant_subject_type AND subject_id = $2 \
               AND resource_type = $3::grant_resource_type AND resource_id = $4 \
               AND (expires_at IS NULL OR expires_at > now())",
        )
        .bind(subject_type)
        .bind(subject_id)
        .bind(resource_type)
        .bind(resource_id)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|(permission, effect)| GrantRow { permission, effect })
        .collect())
}

fn grant_matches_permission(grant_permission: &str, required: Permission) -> bool {
    Permission::parse(grant_permission)
        .map(|granted| Permission::satisfies(required, granted))
        .unwrap_or(false)
}

// Human: Resolve allow/deny/absent for one permission on one resource (no owner fallback).
// Agent: DENY wins over ALLOW among applicable grants.
pub async fn resolve_effect(
    pool: &PgPool,
    user_id: &str,
    permission: Permission,
    resource: ResourceRef,
) -> Result<Effect, AppError> {
    let group_ids = load_user_group_ids(pool, user_id).await?;
    let grants = load_applicable_grants(pool, user_id, &group_ids, &resource).await?;

    let mut has_allow = false;
    for grant in &grants {
        if !grant_matches_permission(&grant.permission, permission) {
            continue;
        }
        if grant.effect == "deny" {
            return Ok(Effect::Deny);
        }
        if grant.effect == "allow" {
            has_allow = true;
        }
    }

    if has_allow {
        return Ok(Effect::Allow);
    }

    Ok(Effect::Absent)
}

async fn is_resource_owner(
    pool: &PgPool,
    user_id: &str,
    resource: &ResourceRef,
) -> Result<bool, AppError> {
    match resource {
        ResourceRef::Instance => Ok(false),
        ResourceRef::Folder(folder_id) => {
            Ok(folder_owner(pool, folder_id).await?.as_deref() == Some(user_id))
        }
        ResourceRef::File(file_id) => Ok(
            file_owner_and_folder(pool, file_id)
                .await?
                .map(|(owner, _)| owner == user_id)
                .unwrap_or(false),
        ),
    }
}

// Human: Authorize one atomic permission — deny wins, then allow grant, then owner, then legacy share read.
// Agent: RETURNS Ok(()) or Forbidden; CALLED at start of file/folder/admin handlers.
pub async fn authorize(
    pool: &PgPool,
    user_id: &str,
    permission: Permission,
    resource: ResourceRef,
) -> Result<(), AppError> {
    match resolve_effect(pool, user_id, permission, resource.clone()).await? {
        Effect::Deny => {
            return Err(AppError::Forbidden(
                "you do not have permission for this action".into(),
            ));
        }
        Effect::Allow => return Ok(()),
        Effect::Absent => {}
    }

    if is_resource_owner(pool, user_id, &resource).await? {
        return Ok(());
    }

    // Legacy user shares grant read-only access to files/folders.
    if permission == Permission::ContentRead
        && has_legacy_user_share_read(pool, user_id, &resource).await?
    {
        return Ok(());
    }

    Err(AppError::Forbidden(
        "you do not have permission for this action".into(),
    ))
}

// Human: Check instance-level permission (admin group instance.admin satisfies all).
// Agent: WRAPPER around authorize(Instance) for admin route gates.
pub async fn authorize_instance(
    pool: &PgPool,
    user_id: &str,
    permission: Permission,
) -> Result<(), AppError> {
    authorize(pool, user_id, permission, ResourceRef::Instance).await
}

// Human: True when user holds the permission on the instance (for /me/permissions).
// Agent: resolve_effect Allow without owner fallback path.
pub async fn has_instance_permission(
    pool: &PgPool,
    user_id: &str,
    permission: Permission,
) -> Result<bool, AppError> {
    match resolve_effect(pool, user_id, permission, ResourceRef::Instance).await? {
        Effect::Allow => Ok(true),
        Effect::Deny => Ok(false),
        Effect::Absent => Ok(false),
    }
}

// Human: List instance permissions the caller effectively holds (for frontend gating).
// Agent: SCANS catalog instance permissions; INCLUDES those resolved Allow.
pub async fn list_effective_instance_permissions(
    pool: &PgPool,
    user_id: &str,
) -> Result<Vec<String>, AppError> {
    let mut out = Vec::new();
    for perm in Permission::all_instance() {
        if has_instance_permission(pool, user_id, *perm).await? {
            out.push(perm.as_str().to_string());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use crate::authz::catalog::Permission;

    #[test]
    fn content_write_implies_read() {
        assert!(Permission::satisfies(
            Permission::ContentRead,
            Permission::ContentWrite
        ));
    }
}
