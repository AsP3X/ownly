// Human: Instance group directory — CRUD, membership, system group protection.
// Agent: /api/v1/admin/groups*; REQUIRES instance.groups.read/manage via authz.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::Claims,
    authz::{authorize_instance, Permission},
    error::AppError,
    AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GroupRow {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub member_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GroupMemberRow {
    pub user_id: String,
    pub email: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddGroupMemberRequest {
    pub user_id: String,
}

fn normalize_slug(slug: &str) -> Result<String, AppError> {
    let slug = slug.trim().to_lowercase();
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::BadRequest(
            "slug must be non-empty alphanumeric with - or _".into(),
        ));
    }
    Ok(slug)
}

// Human: List all groups with member counts for admin UI.
// Agent: GET /admin/groups; READS groups + COUNT group_members.
pub async fn list_groups(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsRead).await?;

    let groups: Vec<GroupRow> = sqlx::query_as(
        "SELECT g.id, g.slug, g.name, g.description, g.is_system, \
            COALESCE(COUNT(gm.user_id), 0)::BIGINT AS member_count, \
            g.created_at, g.updated_at \
         FROM groups g \
         LEFT JOIN group_members gm ON gm.group_id = g.id \
         GROUP BY g.id \
         ORDER BY g.is_system DESC, g.name ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "groups": groups })))
}

// Human: Create a non-system group.
// Agent: POST /admin/groups; AUDIT groups.create.
pub async fn create_group(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateGroupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsManage).await?;

    let slug = normalize_slug(&body.slug)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO groups (id, slug, name, description, is_system) VALUES ($1, $2, $3, $4, false)",
    )
    .bind(&id)
    .bind(&slug)
    .bind(name)
    .bind(body.description.as_deref().map(str::trim))
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("group slug already exists".into())
        }
        _ => AppError::Database(e),
    })?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "groups.create",
        Some("group"),
        Some(&id),
        Some(serde_json::json!({ "slug": slug, "name": name })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "id": id, "slug": slug })))
}

// Human: Update group name/description (not slug).
// Agent: PATCH /admin/groups/:id; BLOCKS is_system slug changes only via name/desc.
pub async fn update_group(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
    Json(body): Json<UpdateGroupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsManage).await?;

    if body.name.is_none() && body.description.is_none() {
        return Err(AppError::BadRequest("no fields to update".into()));
    }

    let existing: Option<(bool,)> =
        sqlx::query_as("SELECT is_system FROM groups WHERE id = $1")
            .bind(&group_id)
            .fetch_optional(&state.pool)
            .await?;
    if existing.is_none() {
        return Err(AppError::NotFound);
    }

    if let Some(name) = body.name.as_deref() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        sqlx::query("UPDATE groups SET name = $1, updated_at = now() WHERE id = $2")
            .bind(trimmed)
            .bind(&group_id)
            .execute(&state.pool)
            .await?;
    }

    if let Some(desc) = body.description.as_ref() {
        sqlx::query("UPDATE groups SET description = $1, updated_at = now() WHERE id = $2")
            .bind(desc.trim())
            .bind(&group_id)
            .execute(&state.pool)
            .await?;
    }

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "groups.update",
        Some("group"),
        Some(&group_id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Delete a custom group — system groups are protected.
// Agent: DELETE /admin/groups/:id; CASCADE group_members + grants referencing group subject.
pub async fn delete_group(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsManage).await?;

    let row: Option<(bool, String)> =
        sqlx::query_as("SELECT is_system, slug FROM groups WHERE id = $1")
            .bind(&group_id)
            .fetch_optional(&state.pool)
            .await?;
    let (is_system, slug) = row.ok_or(AppError::NotFound)?;
    if is_system {
        return Err(AppError::Forbidden("system groups cannot be deleted".into()));
    }

    sqlx::query("DELETE FROM groups WHERE id = $1")
        .bind(&group_id)
        .execute(&state.pool)
        .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "groups.delete",
        Some("group"),
        Some(&group_id),
        Some(serde_json::json!({ "slug": slug })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: List members of one group.
// Agent: GET /admin/groups/:id/members.
pub async fn list_group_members(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsRead).await?;

    let exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM groups WHERE id = $1")
        .bind(&group_id)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    let members: Vec<GroupMemberRow> = sqlx::query_as(
        "SELECT gm.user_id, u.email, gm.created_at \
         FROM group_members gm \
         JOIN users u ON u.id = gm.user_id \
         WHERE gm.group_id = $1 \
         ORDER BY u.email ASC",
    )
    .bind(&group_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "members": members })))
}

// Human: Add a user to a group (e.g. promote to admin by adding to admin group).
// Agent: POST /admin/groups/:id/members; AUDIT groups.member.add; BUMPS session epoch when admin group.
pub async fn add_group_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
    Json(body): Json<AddGroupMemberRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsManage).await?;

    let group: Option<(String,)> =
        sqlx::query_as("SELECT slug FROM groups WHERE id = $1")
            .bind(&group_id)
            .fetch_optional(&state.pool)
            .await?;
    let (slug,) = group.ok_or(AppError::NotFound)?;

    let user_exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM users WHERE id = $1")
        .bind(&body.user_id)
        .fetch_optional(&state.pool)
        .await?;
    if user_exists.is_none() {
        return Err(AppError::NotFound);
    }

    sqlx::query(
        "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(&group_id)
    .bind(&body.user_id)
    .execute(&state.pool)
    .await?;

    if slug == "admin" {
        crate::user_sessions::bump_session_epoch(&state.pool, &body.user_id).await?;
    }

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "groups.member.add",
        Some("group"),
        Some(&group_id),
        Some(serde_json::json!({ "user_id": body.user_id })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Remove a user from a group — guards last admin group member.
// Agent: DELETE /admin/groups/:id/members/:user_id; AUDIT groups.member.remove.
pub async fn remove_group_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path((group_id, user_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(&state.pool, &claims.sub, Permission::InstanceGroupsManage).await?;

    let group: Option<(String,)> =
        sqlx::query_as("SELECT slug FROM groups WHERE id = $1")
            .bind(&group_id)
            .fetch_optional(&state.pool)
            .await?;
    let (slug,) = group.ok_or(AppError::NotFound)?;

    if slug == "admin" {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*)::BIGINT FROM group_members gm \
             JOIN groups g ON g.id = gm.group_id WHERE g.slug = 'admin'",
        )
        .fetch_one(&state.pool)
        .await?;
        if count.0 <= 1 {
            return Err(AppError::Conflict(
                "cannot remove the last administrator group member".into(),
            ));
        }
        let is_member: (i64,) = sqlx::query_as(
            "SELECT COUNT(*)::BIGINT FROM group_members WHERE group_id = $1 AND user_id = $2",
        )
        .bind(&group_id)
        .bind(&user_id)
        .fetch_one(&state.pool)
        .await?;
        if is_member.0 > 0 && count.0 <= 1 {
            return Err(AppError::Conflict(
                "cannot remove the last administrator".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2")
        .bind(&group_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await?;

    if slug == "admin" {
        crate::user_sessions::bump_session_epoch(&state.pool, &user_id).await?;
    }

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "groups.member.remove",
        Some("group"),
        Some(&group_id),
        Some(serde_json::json!({ "user_id": user_id })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Admin-wide grant listing for permissions management panel.
// Agent: GET /admin/permissions; REQUIRES instance.permissions.manage.
pub async fn list_admin_permissions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(
        &state.pool,
        &claims.sub,
        Permission::InstancePermissionsManage,
    )
    .await?;

    let grants: Vec<crate::authz::GrantDto> = sqlx::query_as(
        "SELECT id, subject_type::TEXT, subject_id, resource_type::TEXT, resource_id, \
         permission, effect::TEXT, granted_by, created_at, expires_at \
         FROM permission_grants ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "grants": grants })))
}

// Human: Admin upsert grant (instance-scoped grants from console).
// Agent: PUT /admin/permissions; DELEGATES authz::upsert_grant.
pub async fn put_admin_permission(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<crate::authz::UpsertGrantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(
        &state.pool,
        &claims.sub,
        Permission::InstancePermissionsManage,
    )
    .await?;

    let grant = crate::authz::upsert_grant(&state.pool, &claims.sub, &headers, body).await?;
    Ok(Json(serde_json::json!({ "grant": grant })))
}

// Human: Admin revoke grant by id.
// Agent: DELETE /admin/permissions/:id.
pub async fn delete_admin_permission(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    authorize_instance(
        &state.pool,
        &claims.sub,
        Permission::InstancePermissionsManage,
    )
    .await?;

    crate::authz::revoke_grant_by_id(&state.pool, &claims.sub, &headers, &id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
