// Human: Grant row CRUD with validation and transactional audit writes.
// Agent: WRITES permission_grants; VALIDATES catalog + caller manage_acl or instance.permissions.manage.

use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;

use super::catalog::Permission;
use super::resolver::{authorize, authorize_instance, ResourceRef};

/// Human: One atomic grant row for API list/create responses.
/// Agent: SERIALIZED to GET/PUT /permissions and /admin/permissions.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct GrantDto {
    pub id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub permission: String,
    pub effect: String,
    pub granted_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertGrantRequest {
    pub subject_type: String,
    pub subject_id: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub permission: String,
    pub effect: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

fn parse_subject_type(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_lowercase().as_str() {
        "user" => Ok("user"),
        "group" => Ok("group"),
        _ => Err(AppError::BadRequest(
            "subject_type must be 'user' or 'group'".into(),
        )),
    }
}

fn parse_resource_type(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_lowercase().as_str() {
        "instance" => Ok("instance"),
        "folder" => Ok("folder"),
        "file" => Ok("file"),
        _ => Err(AppError::BadRequest(
            "resource_type must be 'instance', 'folder', or 'file'".into(),
        )),
    }
}

fn parse_effect(value: Option<&str>) -> Result<&'static str, AppError> {
    match value.unwrap_or("allow").trim().to_lowercase().as_str() {
        "allow" => Ok("allow"),
        "deny" => Ok("deny"),
        _ => Err(AppError::BadRequest("effect must be 'allow' or 'deny'".into())),
    }
}

async fn validate_subject_exists(
    pool: &PgPool,
    subject_type: &str,
    subject_id: &str,
) -> Result<(), AppError> {
    match subject_type {
        "user" => {
            let exists: Option<(i32,)> =
                sqlx::query_as("SELECT 1 FROM users WHERE id = $1")
                    .bind(subject_id)
                    .fetch_optional(pool)
                    .await?;
            if exists.is_none() {
                return Err(AppError::NotFound);
            }
        }
        "group" => {
            let exists: Option<(i32,)> =
                sqlx::query_as("SELECT 1 FROM groups WHERE id = $1")
                    .bind(subject_id)
                    .fetch_optional(pool)
                    .await?;
            if exists.is_none() {
                return Err(AppError::NotFound);
            }
        }
        _ => {}
    }
    Ok(())
}

async fn validate_resource_exists(
    pool: &PgPool,
    resource_type: &str,
    resource_id: Option<&str>,
) -> Result<(), AppError> {
    match resource_type {
        "instance" if resource_id.is_some() => {
            return Err(AppError::BadRequest(
                "instance grants must not include resource_id".into(),
            ));
        }
        "instance" => {}
        "folder" => {
            let id = resource_id.ok_or(AppError::BadRequest(
                "folder grants require resource_id".into(),
            ))?;
            let exists: Option<(i32,)> = sqlx::query_as(
                "SELECT 1 FROM folders WHERE id = $1 AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            if exists.is_none() {
                return Err(AppError::NotFound);
            }
        }
        "file" => {
            let id = resource_id.ok_or(AppError::BadRequest(
                "file grants require resource_id".into(),
            ))?;
            let exists: Option<(i32,)> = sqlx::query_as(
                "SELECT 1 FROM files WHERE id = $1 AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            if exists.is_none() {
                return Err(AppError::NotFound);
            }
        }
        _ => {}
    }
    Ok(())
}

// Human: Verify caller may mutate ACL on a resource or instance.
// Agent: content.manage_acl on resource OR instance.permissions.manage on instance.
pub async fn ensure_can_manage_grants(
    pool: &PgPool,
    caller_id: &str,
    resource_type: &str,
    resource_id: Option<&str>,
) -> Result<(), AppError> {
    if authorize_instance(pool, caller_id, Permission::InstancePermissionsManage)
        .await
        .is_ok()
    {
        return Ok(());
    }

    let resource = match resource_type {
        "instance" => ResourceRef::Instance,
        "folder" => ResourceRef::Folder(
            resource_id
                .ok_or(AppError::BadRequest("folder grants require resource_id".into()))?
                .to_string(),
        ),
        "file" => ResourceRef::File(
            resource_id
                .ok_or(AppError::BadRequest("file grants require resource_id".into()))?
                .to_string(),
        ),
        _ => {
            return Err(AppError::BadRequest("invalid resource_type".into()));
        }
    };

    authorize(pool, caller_id, Permission::ContentManageAcl, resource).await
}

// Human: List grants scoped to one resource (ACL panel).
// Agent: GET /permissions; FILTER permission_grants by resource_type + resource_id.
pub async fn list_grants_for_resource(
    pool: &PgPool,
    resource_type: &str,
    resource_id: Option<&str>,
) -> Result<Vec<GrantDto>, AppError> {
    let grants: Vec<GrantDto> = if resource_type == "instance" {
        sqlx::query_as(
            "SELECT id, subject_type::TEXT, subject_id, resource_type::TEXT, resource_id, \
             permission, effect::TEXT, granted_by, created_at, expires_at \
             FROM permission_grants \
             WHERE resource_type = 'instance' AND resource_id IS NULL \
             ORDER BY created_at ASC",
        )
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, subject_type::TEXT, subject_id, resource_type::TEXT, resource_id, \
             permission, effect::TEXT, granted_by, created_at, expires_at \
             FROM permission_grants \
             WHERE resource_type = $1::grant_resource_type AND resource_id = $2 \
             ORDER BY created_at ASC",
        )
        .bind(resource_type)
        .bind(resource_id)
        .fetch_all(pool)
        .await?
    };
    Ok(grants)
}

// Human: Upsert one grant row inside a transaction with audit.
// Agent: ON CONFLICT unique index updates effect; AUDIT permissions.grant or permissions.deny.
pub async fn upsert_grant(
    pool: &PgPool,
    caller_id: &str,
    headers: &HeaderMap,
    body: UpsertGrantRequest,
) -> Result<GrantDto, AppError> {
    let subject_type = parse_subject_type(&body.subject_type)?;
    let resource_type = parse_resource_type(&body.resource_type)?;
    let effect = parse_effect(body.effect.as_deref())?;
    let permission = Permission::parse(&body.permission)?;

    if resource_type == "instance" && body.resource_id.is_some() {
        return Err(AppError::BadRequest(
            "instance grants must not include resource_id".into(),
        ));
    }
    if resource_type != "instance" && body.resource_id.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::BadRequest("resource_id is required".into()));
    }

    validate_subject_exists(pool, subject_type, &body.subject_id).await?;
    validate_resource_exists(pool, resource_type, body.resource_id.as_deref()).await?;
    ensure_can_manage_grants(pool, caller_id, resource_type, body.resource_id.as_deref()).await?;

    let grant_id = Uuid::new_v4().to_string();
    let perm_str = permission.as_str();

    let grant: GrantDto = sqlx::query_as(
        "INSERT INTO permission_grants \
         (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by, expires_at) \
         VALUES ($1, $2::grant_subject_type, $3, $4::grant_resource_type, $5, $6, $7::grant_effect, $8, $9) \
         ON CONFLICT (subject_type, subject_id, resource_type, resource_id, permission) \
         DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by, \
                       expires_at = EXCLUDED.expires_at \
         RETURNING id, subject_type::TEXT, subject_id, resource_type::TEXT, resource_id, \
                   permission, effect::TEXT, granted_by, created_at, expires_at",
    )
    .bind(&grant_id)
    .bind(subject_type)
    .bind(&body.subject_id)
    .bind(resource_type)
    .bind(&body.resource_id)
    .bind(perm_str)
    .bind(effect)
    .bind(caller_id)
    .bind(body.expires_at)
    .fetch_one(pool)
    .await?;

    let action = if effect == "deny" {
        "permissions.deny"
    } else {
        "permissions.grant"
    };

    crate::audit::write_audit(
        pool,
        Some(caller_id),
        action,
        Some("permission_grant"),
        Some(&grant.id),
        Some(serde_json::json!({
            "subject_type": grant.subject_type,
            "subject_id": grant.subject_id,
            "resource_type": grant.resource_type,
            "resource_id": grant.resource_id,
            "permission": grant.permission,
            "effect": grant.effect,
        })),
        headers,
    )
    .await
    .ok();

    Ok(grant)
}

// Human: Delete one grant by id after caller authorization.
// Agent: DELETE permission_grants; AUDIT permissions.revoke.
pub async fn revoke_grant_by_id(
    pool: &PgPool,
    caller_id: &str,
    headers: &HeaderMap,
    grant_id: &str,
) -> Result<(), AppError> {
    let existing: Option<GrantDto> = sqlx::query_as(
        "SELECT id, subject_type::TEXT, subject_id, resource_type::TEXT, resource_id, \
         permission, effect::TEXT, granted_by, created_at, expires_at \
         FROM permission_grants WHERE id = $1",
    )
    .bind(grant_id)
    .fetch_optional(pool)
    .await?;

    let grant = existing.ok_or(AppError::NotFound)?;

    ensure_can_manage_grants(
        pool,
        caller_id,
        &grant.resource_type,
        grant.resource_id.as_deref(),
    )
    .await?;

    sqlx::query("DELETE FROM permission_grants WHERE id = $1")
        .bind(grant_id)
        .execute(pool)
        .await?;

    crate::audit::write_audit(
        pool,
        Some(caller_id),
        "permissions.revoke",
        Some("permission_grant"),
        Some(grant_id),
        Some(serde_json::json!({
            "subject_type": grant.subject_type,
            "subject_id": grant.subject_id,
            "resource_type": grant.resource_type,
            "resource_id": grant.resource_id,
            "permission": grant.permission,
            "effect": grant.effect,
        })),
        headers,
    )
    .await
    .ok();

    Ok(())
}

// Human: Add first setup user to seeded admin group (migration 022 creates group + grant).
// Agent: Prefer inline SQL in setup TX; kept for tests that bootstrap admin membership.
pub async fn seed_admin_group_for_user(
    pool: &PgPool,
    user_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO group_members (group_id, user_id) \
         SELECT id, $1 FROM groups WHERE slug = 'admin' \
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}

// Human: Keep users.role and admin group membership in sync (Phase 1 dual-read).
// Agent: INSERT/DELETE group_members for slug=admin when role changes.
pub async fn sync_user_admin_group_membership(
    pool: &PgPool,
    user_id: &str,
    role: &str,
) -> Result<(), AppError> {
    if role == "admin" {
        sqlx::query(
            "INSERT INTO group_members (group_id, user_id) \
             SELECT id, $1 FROM groups WHERE slug = 'admin' \
             ON CONFLICT DO NOTHING",
        )
        .bind(user_id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "DELETE FROM group_members \
             WHERE user_id = $1 AND group_id = (SELECT id FROM groups WHERE slug = 'admin')",
        )
        .bind(user_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// Human: Count enabled users in the admin group — last-admin guard.
// Agent: READS group_members JOIN users WHERE slug=admin AND enabled.
pub async fn count_enabled_admin_group_members(pool: &PgPool) -> Result<i64, AppError> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT FROM group_members gm \
         JOIN groups g ON g.id = gm.group_id \
         JOIN users u ON u.id = gm.user_id \
         WHERE g.slug = 'admin' AND u.enabled = true",
    )
    .fetch_one(pool)
    .await?;
    Ok(count)
}

// Agent: UPSERT allow content permission for grantee user on file/folder resource.
pub async fn grant_content_for_user_share(
    pool: &PgPool,
    owner_id: &str,
    subject_user_id: &str,
    resource_type: &str,
    resource_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let perm = Permission::parse(permission)?;
    if !Permission::content_assignable().contains(&perm) {
        return Err(AppError::BadRequest(
            "permission must be a content.* grant".into(),
        ));
    }
    let grant_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO permission_grants \
         (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by) \
         VALUES ($1, 'user', $2, $3::grant_resource_type, $4, $5, 'allow', $6) \
         ON CONFLICT (subject_type, subject_id, resource_type, resource_id, permission) \
         DO UPDATE SET effect = 'allow', granted_by = EXCLUDED.granted_by",
    )
    .bind(grant_id)
    .bind(subject_user_id)
    .bind(resource_type)
    .bind(resource_id)
    .bind(perm.as_str())
    .bind(owner_id)
    .execute(pool)
    .await?;
    Ok(())
}

// Human: Back-compat wrapper — grants content.read on user share invite.
pub async fn grant_content_read_for_user_share(
    pool: &PgPool,
    owner_id: &str,
    subject_user_id: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), AppError> {
    grant_content_for_user_share(
        pool,
        owner_id,
        subject_user_id,
        resource_type,
        resource_id,
        "content.read",
    )
    .await
}

// Human: Remove content.read grant when user share revoked (best-effort cleanup).
// Agent: DELETE matching user grant rows for resource.
pub async fn revoke_content_read_for_user_share(
    pool: &PgPool,
    subject_user_id: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM permission_grants \
         WHERE subject_type = 'user' AND subject_id = $1 \
           AND resource_type = $2::grant_resource_type AND resource_id = $3 \
           AND permission IN ('content.read','content.write','content.delete','content.share','content.manage_acl')",
    )
    .bind(subject_user_id)
    .bind(resource_type)
    .bind(resource_id)
    .execute(pool)
    .await?;
    Ok(())
}
