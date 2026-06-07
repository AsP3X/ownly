// Human: Admin user directory — list, invite, update roles/activation, and remove accounts.
// Agent: HTTP /api/v1/admin/users*; READS users/files/audit_logs; WRITES users; AUDIT admin.users.*.

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
    auth::handlers::{hash_password, Claims, UserDto},
    error::AppError,
    user_sessions,
    AppState,
};

const ALLOWED_ROLES: &[&str] = &["admin", "pro", "standard", "user"];

type AdminUserListRow = (
    String,
    String,
    String,
    bool,
    i64,
    i64,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    DateTime<Utc>,
);

// Human: Reject non-admin JWTs before any admin console mutation or listing.
// Agent: READS Claims.role; RETURNS Forbidden when role != admin.
pub fn require_admin(claims: &Claims) -> Result<(), AppError> {
    if claims.role == "admin" {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "administrator access is required".into(),
        ))
    }
}

fn normalize_role(role: &str) -> Result<String, AppError> {
    let role = role.trim().to_lowercase();
    if role == "user" {
        return Ok("pro".into());
    }
    if ALLOWED_ROLES.contains(&role.as_str()) {
        Ok(role)
    } else {
        Err(AppError::BadRequest(
            "role must be 'admin', 'pro', or 'standard'".into(),
        ))
    }
}

#[derive(Debug, Serialize)]
pub struct AdminUserRow {
    pub id: String,
    pub email: String,
    pub role: String,
    pub enabled: bool,
    pub storage_bytes: i64,
    pub file_count: i64,
    pub last_active_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AdminUsersSummary {
    pub total: i64,
    pub enabled_count: i64,
    pub admin_count: i64,
    pub activation_rate_percent: f64,
}

#[derive(Debug, Serialize)]
pub struct AdminUsersInstanceMeta {
    pub default_quota_bytes: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminUsersListResponse {
    pub users: Vec<AdminUserRow>,
    pub summary: AdminUsersSummary,
    pub instance: AdminUsersInstanceMeta,
}

#[derive(Debug, Serialize)]
pub struct AdminRoleRow {
    pub id: String,
    pub label: String,
    pub member_count: i64,
    pub permissions: String,
    pub role_type: String,
}

#[derive(Debug, Serialize)]
pub struct AdminRolesResponse {
    pub roles: Vec<AdminRoleRow>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAdminUserRequest {
    pub email: String,
    pub password: String,
    pub role: String,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAdminUserRequest {
    pub role: Option<String>,
    pub enabled: Option<bool>,
    pub password: Option<String>,
}

// Human: Load every account with storage totals and latest audit activity for the directory table.
// Agent: GET /api/v1/admin/users; READS users LEFT JOIN files; GROUP BY user; AUDIT exempt (read-only list).
pub async fn list_users(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminUsersListResponse>, AppError> {
    require_admin(&claims)?;

    let rows: Vec<AdminUserListRow> = sqlx::query_as(
        "SELECT u.id, u.email, u.role, u.enabled, \
            COALESCE(SUM(CASE WHEN f.deleted_at IS NULL THEN f.size_bytes ELSE 0 END), 0)::BIGINT AS storage_bytes, \
            COALESCE(SUM(CASE WHEN f.deleted_at IS NULL THEN 1 ELSE 0 END), 0)::BIGINT AS file_count, \
            la.last_active_at, u.created_at, u.updated_at \
         FROM users u \
         LEFT JOIN files f ON f.user_id = u.id \
         LEFT JOIN ( \
            SELECT user_id, MAX(created_at) AS last_active_at \
            FROM audit_logs \
            WHERE user_id IS NOT NULL \
            GROUP BY user_id \
         ) la ON la.user_id = u.id \
         GROUP BY u.id, u.email, u.role, u.enabled, la.last_active_at, u.created_at, u.updated_at \
         ORDER BY u.created_at ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut enabled_count = 0_i64;
    let mut admin_count = 0_i64;
    let users: Vec<AdminUserRow> = rows
        .into_iter()
        .map(
            |(
                id,
                email,
                role,
                enabled,
                storage_bytes,
                file_count,
                last_active_at,
                created_at,
                updated_at,
            )| {
                if enabled {
                    enabled_count += 1;
                }
                if role == "admin" {
                    admin_count += 1;
                }
                AdminUserRow {
                    id,
                    email,
                    role,
                    enabled,
                    storage_bytes,
                    file_count,
                    last_active_at,
                    created_at,
                    updated_at,
                }
            },
        )
        .collect();

    let total = users.len() as i64;
    let activation_rate_percent = if total == 0 {
        100.0
    } else {
        (enabled_count as f64 / total as f64) * 100.0
    };

    let quota_gb: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'default_storage_quota_gb'")
            .fetch_optional(&state.pool)
            .await?;
    let default_quota_bytes = quota_gb
        .and_then(|(value,)| value.parse::<i64>().ok())
        .unwrap_or(50)
        .saturating_mul(1024 * 1024 * 1024);

    Ok(Json(AdminUsersListResponse {
        users,
        summary: AdminUsersSummary {
            total,
            enabled_count,
            admin_count,
            activation_rate_percent,
        },
        instance: AdminUsersInstanceMeta {
            default_quota_bytes,
        },
    }))
}

// Human: Role catalog with live member counts for the Security Roles tab.
// Agent: GET /api/v1/admin/users/roles; READS users GROUP BY role; AUDIT exempt (read-only).
pub async fn list_roles(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminRolesResponse>, AppError> {
    require_admin(&claims)?;

    let counts: Vec<(String, i64)> =
        sqlx::query_as("SELECT role, COUNT(*)::BIGINT FROM users GROUP BY role ORDER BY role")
            .fetch_all(&state.pool)
            .await?;

    let count_for = |role_id: &str| -> i64 {
        counts
            .iter()
            .filter(|(role, _)| {
                role == role_id || (role_id == "pro" && (role == "user" || role == "pro"))
            })
            .map(|(_, count)| *count)
            .sum()
    };

    let catalog = [
        (
            "admin",
            "Administrator",
            "instance.admin, users.manage, settings.write",
        ),
        (
            "pro",
            "Pro User",
            "content.read, content.write, shares.create",
        ),
        (
            "standard",
            "Standard User",
            "content.read, shares.read",
        ),
    ];

    let roles = catalog
        .iter()
        .map(|(role_id, label, permissions)| AdminRoleRow {
            id: (*role_id).to_string(),
            label: (*label).to_string(),
            member_count: count_for(role_id),
            permissions: (*permissions).to_string(),
            role_type: "system".to_string(),
        })
        .collect();

    Ok(Json(AdminRolesResponse { roles }))
}

async fn count_enabled_admins(pool: &sqlx::PgPool) -> Result<i64, AppError> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::BIGINT FROM users WHERE role = 'admin' AND enabled = true")
            .fetch_one(pool)
            .await?;
    Ok(count)
}

// Human: Create a new local account (admin invite) with optional activation gate.
// Agent: POST /api/v1/admin/users; WRITES users; AUDIT admin.users.create.
pub async fn create_user(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateAdminUserRequest>,
) -> Result<Json<UserDto>, AppError> {
    require_admin(&claims)?;
    // Human: Admin JWT + role gate is sufficient — no Sec-Fetch/Origin check (remote Compose / proxies).
    // Agent: SKIPS browser_guard; register still enforces it; AUDIT admin.users.create unchanged.

    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::BadRequest("invalid email address".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    let role = normalize_role(&body.role)?;
    let enabled = body.enabled.unwrap_or(true);

    let password_hash =
        hash_password(&body.password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let user_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&role)
    .bind(enabled)
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("email already exists".into())
        }
        _ => AppError::Database(e),
    })?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.users.create",
        Some("user"),
        Some(&user_id),
        Some(serde_json::json!({ "email": email, "role": role, "enabled": enabled })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(UserDto {
        id: user_id,
        email,
        role,
        enabled,
    }))
}

// Human: Update role, activation, or password for an existing account.
// Agent: PATCH /api/v1/admin/users/:id; WRITES users; AUDIT admin.users.update; guards last admin.
pub async fn update_user(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(body): Json<UpdateAdminUserRequest>,
) -> Result<Json<UserDto>, AppError> {
    require_admin(&claims)?;

    if body.role.is_none() && body.enabled.is_none() && body.password.is_none() {
        return Err(AppError::BadRequest("no fields to update".into()));
    }

    let existing: Option<(String, String, bool)> =
        sqlx::query_as("SELECT email, role, enabled FROM users WHERE id = $1")
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await?;

    let (_email, current_role, current_enabled) = existing.ok_or(AppError::NotFound)?;

    let new_role = if let Some(role) = body.role.as_deref() {
        Some(normalize_role(role)?)
    } else {
        None
    };

    let new_enabled = body.enabled;
    let target_role = new_role.as_deref().unwrap_or(&current_role);
    let target_enabled = new_enabled.unwrap_or(current_enabled);

    if target_role != "admin" || !target_enabled {
        let would_remain_admin = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*)::BIGINT FROM users \
             WHERE role = 'admin' AND enabled = true AND id <> $1",
        )
        .bind(&user_id)
        .fetch_one(&state.pool)
        .await?
        .0;
        let this_stays_admin = target_role == "admin" && target_enabled;
        if !this_stays_admin && would_remain_admin == 0 {
            return Err(AppError::Forbidden(
                "cannot remove or deactivate the last active administrator".into(),
            ));
        }
    }

    if let Some(role) = &new_role {
        sqlx::query("UPDATE users SET role = $1, updated_at = now() WHERE id = $2")
            .bind(role)
            .bind(&user_id)
            .execute(&state.pool)
            .await?;
    }

    if let Some(enabled) = new_enabled {
        if user_id == claims.sub && !enabled {
            return Err(AppError::Forbidden(
                "cannot deactivate your own administrator account".into(),
            ));
        }
        sqlx::query("UPDATE users SET enabled = $1, updated_at = now() WHERE id = $2")
            .bind(enabled)
            .bind(&user_id)
            .execute(&state.pool)
            .await?;
    }

    let password_reset = body
        .password
        .as_ref()
        .filter(|password| !password.is_empty())
        .is_some();

    if let Some(password) = body.password {
        if password.len() < 8 {
            return Err(AppError::BadRequest(
                "password must be at least 8 characters".into(),
            ));
        }
        let password_hash =
            hash_password(&password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
            .bind(&password_hash)
            .bind(&user_id)
            .execute(&state.pool)
            .await?;
    }

    let role_changed = new_role
        .as_ref()
        .is_some_and(|role| role != &current_role);
    if role_changed || password_reset {
        // Human: Invalidate outstanding JWTs when privileges or credentials change (SEC-002).
        // Agent: bump_session_epoch; auth_middleware also reloads role from DB on every request.
        crate::user_sessions::bump_session_epoch(&state.pool, &user_id).await?;
    }

    let updated: (String, String, bool) =
        sqlx::query_as("SELECT email, role, enabled FROM users WHERE id = $1")
            .bind(&user_id)
            .fetch_one(&state.pool)
            .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.users.update",
        Some("user"),
        Some(&user_id),
        Some(serde_json::json!({
            "role": updated.1,
            "enabled": updated.2,
            "password_reset": password_reset,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(UserDto {
        id: user_id,
        email: updated.0,
        role: updated.1,
        enabled: updated.2,
    }))
}

// Human: Permanently delete a user and cascade-owned content via FK rules.
// Agent: DELETE /api/v1/admin/users/:id; WRITES users DELETE; AUDIT admin.users.delete; blocks self/last admin.
pub async fn delete_user(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(&claims)?;

    if user_id == claims.sub {
        return Err(AppError::Forbidden(
            "cannot delete your own administrator account".into(),
        ));
    }

    let row: Option<(String, String, bool)> =
        sqlx::query_as("SELECT email, role, enabled FROM users WHERE id = $1")
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await?;

    let (email, role, enabled) = row.ok_or(AppError::NotFound)?;

    if role == "admin" && enabled {
        let remaining = count_enabled_admins(&state.pool).await?;
        if remaining <= 1 {
            return Err(AppError::Forbidden(
                "cannot delete the last active administrator".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.users.delete",
        Some("user"),
        Some(&user_id),
        Some(serde_json::json!({ "email": email })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Serialize)]
pub struct AdminUserSessionRow {
    pub id: String,
    pub device_label: String,
    pub location_label: String,
    pub created_line: String,
    pub activity_line: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
pub struct AdminUserSessionsResponse {
    pub sessions: Vec<AdminUserSessionRow>,
}

// Human: List recent sign-in sessions derived from audit logs (admin console Active Sessions dialog).
// Agent: GET /admin/users/:id/sessions; READS audit_logs + app_settings revocations; AUDIT exempt.
pub async fn list_user_sessions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<String>,
) -> Result<Json<AdminUserSessionsResponse>, AppError> {
    require_admin(&claims)?;

    let exists: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE id = $1")
        .bind(&user_id)
        .fetch_optional(&state.pool)
        .await?;
    exists.ok_or(AppError::NotFound)?;

    let revoked = user_sessions::load_revoked_session_ids(&state.pool, &user_id).await?;
    let rows: Vec<(String, DateTime<Utc>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, created_at, ip, user_agent FROM audit_logs \
         WHERE user_id = $1 AND action IN ('auth.login', 'auth.register') \
         ORDER BY created_at DESC LIMIT 25",
    )
    .bind(&user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut sessions = Vec::new();
    let mut marked_current = false;
    for (id, created_at, ip, user_agent) in rows {
        if revoked.iter().any(|revoked_id| revoked_id == &id) {
            continue;
        }
        let ip_label = ip.unwrap_or_else(|| "Unknown".into());
        let is_current = !marked_current;
        if is_current {
            marked_current = true;
        }
        sessions.push(AdminUserSessionRow {
            id,
            device_label: user_sessions::session_device_label(user_agent.as_deref()),
            location_label: format!("Location: unknown • IP: {ip_label}"),
            created_line: format!("Token Created: {}", created_at.format("%b %d, %Y")),
            activity_line: if is_current {
                "Last active now".into()
            } else {
                format!("Last active {}", created_at.format("%b %d, %Y"))
            },
            is_current,
        });
    }

    Ok(Json(AdminUserSessionsResponse { sessions }))
}

// Human: Mark one audit-derived session row as revoked in app_settings (admin UI hide + audit).
// Agent: POST /admin/users/:id/sessions/:session_id/revoke; WRITES app_settings; AUDIT admin.sessions.revoke.
pub async fn revoke_user_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path((user_id, session_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(&claims)?;

    user_sessions::revoke_session_id(&state.pool, &user_id, &session_id).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.sessions.revoke",
        Some("user"),
        Some(&user_id),
        Some(serde_json::json!({ "session_id": session_id })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Revoke every session except the most recent visible login for this user.
// Agent: POST /admin/users/:id/sessions/revoke-others; WRITES app_settings; AUDIT admin.sessions.revoke_others.
pub async fn revoke_other_sessions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(&claims)?;

    user_sessions::revoke_all_other_sessions(&state.pool, &user_id).await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.sessions.revoke_others",
        Some("user"),
        Some(&user_id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}
