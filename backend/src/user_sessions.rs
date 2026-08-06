// Human: Per-user session revocation backed by app_settings (admin + self-service /me sessions).
// Agent: READS/WRITES admin_revoked_sessions:*; JWT sid + ver + iat gate revoked logins.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::error::AppError;

/// Human: One active sign-in row for admin Active Sessions and Settings → Authorized Sessions.
/// Agent: BUILT by list_active_sessions from audit_logs; SERIALIZED as JSON for both APIs.
#[derive(Debug, Clone, Serialize)]
pub struct SessionListRow {
    pub id: String,
    pub device_label: String,
    pub location_label: String,
    pub created_line: String,
    pub activity_line: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<SessionListRow>,
}

fn revoked_sessions_key(user_id: &str) -> String {
    format!("admin_revoked_sessions:{user_id}")
}

fn session_epoch_key(user_id: &str) -> String {
    format!("user_session_epoch:{user_id}")
}

fn session_min_iat_key(user_id: &str) -> String {
    format!("user_session_min_iat:{user_id}")
}

// Human: Load audit-log session ids the admin has revoked for this user.
// Agent: READS app_settings JSON array; RETURNS empty vec when unset.
pub async fn load_revoked_session_ids(pool: &PgPool, user_id: &str) -> Result<Vec<String>, AppError> {
    let key = revoked_sessions_key(user_id);
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(&key)
            .fetch_optional(pool)
            .await?;
    let Some((value,)) = row else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str::<Vec<String>>(&value).unwrap_or_default())
}

async fn store_revoked_session_ids(
    pool: &PgPool,
    user_id: &str,
    ids: &[String],
) -> Result<(), AppError> {
    let key = revoked_sessions_key(user_id);
    let payload = serde_json::to_string(ids).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(&key)
    .bind(&payload)
    .execute(pool)
    .await?;
    Ok(())
}

// Human: Monotonic session version — bumping invalidates all JWTs with an older `ver` claim.
// Agent: READS user_session_epoch:* from app_settings; RETURNS 0 when unset.
pub async fn load_session_epoch(pool: &PgPool, user_id: &str) -> Result<u64, AppError> {
    let key = session_epoch_key(user_id);
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(&key)
            .fetch_optional(pool)
            .await?;
    let Some((value,)) = row else {
        return Ok(0);
    };
    Ok(value.parse().unwrap_or(0))
}

// Human: Increment session epoch so every outstanding JWT for this user becomes invalid.
// Agent: WRITES user_session_epoch:*; USED when revoking the newest login audit row.
pub async fn bump_session_epoch(pool: &PgPool, user_id: &str) -> Result<u64, AppError> {
    let next = load_session_epoch(pool, user_id).await?.saturating_add(1);
    let key = session_epoch_key(user_id);
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(&key)
    .bind(next.to_string())
    .execute(pool)
    .await?;
    crate::auth::cache::invalidate_auth(user_id);
    Ok(next)
}

async fn load_min_valid_iat(pool: &PgPool, user_id: &str) -> Result<Option<i64>, AppError> {
    let key = session_min_iat_key(user_id);
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(&key)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(value,)| value.parse().ok()))
}

async fn store_min_valid_iat(pool: &PgPool, user_id: &str, min_iat: i64) -> Result<(), AppError> {
    let key = session_min_iat_key(user_id);
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(&key)
    .bind(min_iat.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

// Human: True when this audit id is the newest auth.login / auth.register row for the user.
// Agent: READS audit_logs ORDER BY created_at DESC LIMIT 1; COMPARES id.
async fn is_latest_login_session(pool: &PgPool, user_id: &str, session_id: &str) -> Result<bool, AppError> {
    let latest: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM audit_logs \
         WHERE user_id = $1 AND action IN ('auth.login', 'auth.register') \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(latest.map(|(id,)| id == session_id).unwrap_or(false))
}

// Human: Reject JWTs revoked by admin (sid list, epoch bump, or revoke-others min iat floor).
// Agent: READS app_settings; RETURNS false when ver/iat/sid fail any gate.
pub async fn is_token_session_valid(
    pool: &PgPool,
    user_id: &str,
    session_id: Option<&str>,
    session_version: u64,
    token_iat: i64,
) -> Result<bool, AppError> {
    let epoch = load_session_epoch(pool, user_id).await?;
    if session_version < epoch {
        return Ok(false);
    }

    if let Some(sid) = session_id {
        let revoked = load_revoked_session_ids(pool, user_id).await?;
        if revoked.iter().any(|id| id == sid) {
            return Ok(false);
        }
    } else if let Some(min_iat) = load_min_valid_iat(pool, user_id).await? {
        // Human: Legacy JWTs without sid still die after "revoke other sessions".
        if token_iat < min_iat {
            return Ok(false);
        }
    }

    Ok(true)
}

// Human: Revoke one login session — ties to JWT claim sid (audit log id from auth.login).
// Agent: WRITES revoked id list; RETURNS after persist.
pub async fn revoke_session_id(pool: &PgPool, user_id: &str, session_id: &str) -> Result<(), AppError> {
    let mut revoked = load_revoked_session_ids(pool, user_id).await?;
    if !revoked.iter().any(|id| id == session_id) {
        revoked.push(session_id.to_string());
        store_revoked_session_ids(pool, user_id, &revoked).await?;
    }
    if is_latest_login_session(pool, user_id, session_id).await? {
        bump_session_epoch(pool, user_id).await?;
    }
    crate::auth::cache::invalidate_auth(user_id);
    Ok(())
}

// Human: Revoke every login session except the newest audit row for this user.
// Agent: WRITES revoked ids for all older auth.login / auth.register rows.
pub async fn revoke_all_other_sessions(pool: &PgPool, user_id: &str) -> Result<(), AppError> {
    revoke_all_except_session(pool, user_id, None).await
}

// Human: Revoke all recent logins except one kept session (JWT sid) or the newest when keep is None.
// Agent: WRITES revoked ids + min_iat floor for legacy tokens without sid.
pub async fn revoke_all_except_session(
    pool: &PgPool,
    user_id: &str,
    keep_session_id: Option<&str>,
) -> Result<(), AppError> {
    let rows: Vec<(String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, created_at FROM audit_logs \
         WHERE user_id = $1 AND action IN ('auth.login', 'auth.register') \
         ORDER BY created_at DESC LIMIT 25",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut revoked = load_revoked_session_ids(pool, user_id).await?;
    let mut kept_current = false;
    let mut kept_created_at: Option<DateTime<Utc>> = None;

    // Prefer explicit keep id when present among rows; otherwise keep the newest non-revoked.
    let preferred_keep = keep_session_id.filter(|sid| {
        rows.iter().any(|(id, _)| id == *sid)
            && !revoked.iter().any(|revoked_id| revoked_id == *sid)
    });

    for (id, created_at) in rows {
        if revoked.iter().any(|revoked_id| revoked_id == &id) {
            continue;
        }
        let should_keep = match preferred_keep {
            Some(keep_id) => id == keep_id,
            None => !kept_current,
        };
        if should_keep && !kept_current {
            kept_current = true;
            kept_created_at = Some(created_at);
            continue;
        }
        if should_keep {
            continue;
        }
        if !revoked.iter().any(|revoked_id| revoked_id == &id) {
            revoked.push(id);
        }
    }
    store_revoked_session_ids(pool, user_id, &revoked).await?;
    if let Some(created_at) = kept_created_at {
        store_min_valid_iat(pool, user_id, created_at.timestamp()).await?;
    }
    crate::auth::cache::invalidate_auth(user_id);
    Ok(())
}

// Human: Confirm an audit-derived session id belongs to this user before self-service revoke.
// Agent: READS audit_logs; RETURNS true only for auth.login / auth.register rows of user_id.
pub async fn session_belongs_to_user(
    pool: &PgPool,
    user_id: &str,
    session_id: &str,
) -> Result<bool, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM audit_logs \
         WHERE id = $1 AND user_id = $2 AND action IN ('auth.login', 'auth.register')",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

// Human: List non-revoked login sessions for admin or self-service Settings UI.
// Agent: READS audit_logs + revoked set; MARKS is_current from JWT sid when provided.
pub async fn list_active_sessions(
    pool: &PgPool,
    user_id: &str,
    current_session_id: Option<&str>,
) -> Result<Vec<SessionListRow>, AppError> {
    let revoked = load_revoked_session_ids(pool, user_id).await?;
    let rows: Vec<(String, DateTime<Utc>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, created_at, ip, user_agent FROM audit_logs \
         WHERE user_id = $1 AND action IN ('auth.login', 'auth.register') \
         ORDER BY created_at DESC LIMIT 25",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut sessions = Vec::new();
    let mut marked_fallback_current = false;
    let has_sid_match = current_session_id
        .map(|sid| {
            rows.iter().any(|(id, _, _, _)| {
                id == sid && !revoked.iter().any(|revoked_id| revoked_id == id)
            })
        })
        .unwrap_or(false);

    for (id, created_at, ip, user_agent) in rows {
        if revoked.iter().any(|revoked_id| revoked_id == &id) {
            continue;
        }
        let ip_label = ip.unwrap_or_else(|| "Unknown".into());
        let is_current = if has_sid_match {
            current_session_id == Some(id.as_str())
        } else if !marked_fallback_current {
            marked_fallback_current = true;
            true
        } else {
            false
        };
        sessions.push(SessionListRow {
            id,
            device_label: session_device_label(user_agent.as_deref()),
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

    Ok(sessions)
}

pub fn session_device_label(user_agent: Option<&str>) -> String {
    let ua = user_agent.unwrap_or("Unknown client").to_lowercase();
    let device = if ua.contains("iphone") || ua.contains("ipad") {
        "iPhone / iPad"
    } else if ua.contains("android") {
        "Android"
    } else if ua.contains("windows") {
        "Windows 11 PC"
    } else if ua.contains("mac os") || ua.contains("macintosh") {
        "macOS"
    } else {
        "Web Client"
    };
    let client = if ua.contains("ownly") {
        "Ownly Mobile App"
    } else if ua.contains("chrome") {
        "Chrome Web Browser"
    } else if ua.contains("firefox") {
        "Firefox"
    } else if ua.contains("safari") {
        "Safari"
    } else {
        "Browser"
    };
    format!("{device} • {client}")
}

#[cfg(test)]
mod tests {
    use super::session_device_label;

    #[test]
    fn session_device_label_detects_chrome_windows() {
        let label = session_device_label(Some(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
        ));
        assert!(label.contains("Windows"));
        assert!(label.contains("Chrome"));
    }
}
