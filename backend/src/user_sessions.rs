// Human: Per-user session revocation backed by app_settings (admin console Active Sessions).
// Agent: READS/WRITES admin_revoked_sessions:*; JWT sid + ver + iat gate revoked logins.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::error::AppError;

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
    Ok(())
}

// Human: Revoke every login session except the newest audit row for this user.
// Agent: WRITES revoked ids for all older auth.login / auth.register rows.
pub async fn revoke_all_other_sessions(pool: &PgPool, user_id: &str) -> Result<(), AppError> {
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
    for (id, created_at) in rows {
        if revoked.iter().any(|revoked_id| revoked_id == &id) {
            continue;
        }
        if !kept_current {
            kept_current = true;
            kept_created_at = Some(created_at);
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
    Ok(())
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
