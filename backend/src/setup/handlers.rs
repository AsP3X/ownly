// Human: First-run setup endpoints — admin account, instance settings, storage bucket, database test.
// Agent: READS users COUNT for gating; WRITES users + app_settings in TX; RETURNS AuthResponse on success once.

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::{create_token, hash_password, AuthResponse, UserDto},
    db,
    error::AppError,
    AppState,
};

#[derive(Debug, Serialize)]
pub struct ReleaseInfo {
    pub version: &'static str,
    pub git_sha: String,
    pub environment: String,
}

#[derive(Debug, Serialize)]
pub struct SetupStatus {
    pub setup_complete: bool,
}

#[derive(Debug, Serialize)]
pub struct SetupDatabaseInfo {
    pub driver: String,
    pub database_url: String,
}

#[derive(Debug, Deserialize)]
pub struct DatabaseUrlBody {
    pub database_url: String,
}

#[derive(Debug, Serialize)]
pub struct DatabaseTestResponse {
    pub ok: bool,
    pub driver: String,
}

#[derive(Debug, Serialize)]
pub struct StorageInfo {
    pub object_storage_url: String,
    pub object_storage_public_url: String,
    pub object_storage_bucket: String,
    pub storage_mode: String,
}

#[derive(Debug, Deserialize)]
pub struct SetupRequest {
    pub email: String,
    pub password: String,
    pub instance_name: String,
    pub allow_public_registration: bool,
    #[serde(default)]
    pub require_account_activation: bool,
    pub object_storage_bucket: Option<String>,
    pub default_storage_quota_gb: Option<u32>,
    pub database_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SetupResponse {
    #[serde(flatten)]
    pub auth: AuthResponse,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub restart_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_database_url: Option<String>,
}

// Human: Expose build metadata for the about screen and health dashboards.
// Agent: READS AppState git_sha + environment; NO DB; PUBLIC route.
pub async fn release_info(State(state): State<Arc<AppState>>) -> Json<ReleaseInfo> {
    Json(ReleaseInfo {
        version: env!("CARGO_PKG_VERSION"),
        git_sha: state.git_sha.clone(),
        environment: state.environment.clone(),
    })
}

// Human: Tell the SPA whether onboarding is still required before exposing login routes.
// Agent: READS COUNT(*) FROM users; RETURNS setup_complete bool; PUBLIC route.
pub async fn setup_status(State(state): State<Arc<AppState>>) -> Result<Json<SetupStatus>, AppError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(SetupStatus {
        setup_complete: count > 0,
    }))
}

pub async fn setup_database_info(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SetupDatabaseInfo>, AppError> {
    ensure_not_complete(&state).await?;
    Ok(Json(SetupDatabaseInfo {
        driver: db::driver_from_url(&state.database_url)
            .unwrap_or("unknown")
            .to_string(),
        database_url: state.database_url.clone(),
    }))
}

pub async fn setup_storage_info(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StorageInfo>, AppError> {
    ensure_not_complete(&state).await?;
    Ok(Json(StorageInfo {
        object_storage_url: state.object_storage_url.clone(),
        object_storage_public_url: state.object_storage_public_url.clone(),
        object_storage_bucket: state.object_storage_bucket.clone(),
        storage_mode: state.storage_mode.clone(),
    }))
}

pub async fn test_setup_database(
    State(state): State<Arc<AppState>>,
    Json(body): Json<DatabaseUrlBody>,
) -> Result<Json<DatabaseTestResponse>, AppError> {
    ensure_not_complete(&state).await?;
    let url = body.database_url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("database_url is required".into()));
    }
    let driver = db::driver_from_url(url)
        .ok_or_else(|| AppError::BadRequest("unsupported database_url scheme".into()))?
        .to_string();
    db::test_connection(url).await.map_err(|_| {
        AppError::BadRequest(
            "could not connect to database; check host, credentials, and network".into(),
        )
    })?;
    let _ = &state;
    Ok(Json(DatabaseTestResponse { ok: true, driver }))
}

async fn ensure_not_complete(state: &AppState) -> Result<(), AppError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await?;
    if count > 0 {
        return Err(AppError::Conflict("setup already completed".into()));
    }
    Ok(())
}

fn urls_equivalent(a: &str, b: &str) -> bool {
    a.trim() == b.trim()
}

// Human: Atomic first admin + settings seed — only succeeds while the users table is empty.
// Agent: WRITES users + app_settings TX; AUDIT setup.complete; RETURNS JWT; HTTP 409 when already initialized.
pub async fn setup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SetupRequest>,
) -> Result<Json<SetupResponse>, AppError> {
    let target_url = body
        .database_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(state.database_url.as_str());

    if db::driver_from_url(target_url).is_none() {
        return Err(AppError::BadRequest("unsupported database_url scheme".into()));
    }

    let use_startup_pool = urls_equivalent(target_url, &state.database_url);
    let setup_pool = if use_startup_pool {
        state.pool.clone()
    } else {
        db::init_pool(target_url).await.map_err(|_| {
            AppError::BadRequest(
                "could not connect to configured database; test the connection first".into(),
            )
        })?
    };

    ensure_not_complete_pool(&setup_pool).await?;

    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    let password_hash =
        hash_password(&body.password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let user_id = Uuid::new_v4().to_string();
    let bucket = body
        .object_storage_bucket
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(state.object_storage_bucket.as_str());
    let quota_gb = body.default_storage_quota_gb.unwrap_or(50).max(1);

    let mut tx = setup_pool.begin().await?;

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&user_id)
    .bind(body.email.trim().to_lowercase())
    .bind(&password_hash)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("email already exists".into())
        }
        _ => AppError::Database(e),
    })?;

    let settings = [
        ("instance_name", body.instance_name.trim()),
        (
            "allow_public_registration",
            if body.allow_public_registration {
                "true"
            } else {
                "false"
            },
        ),
        (
            "require_account_activation",
            if body.require_account_activation {
                "true"
            } else {
                "false"
            },
        ),
        ("database_url", target_url),
        ("object_storage_bucket", bucket),
        ("default_storage_quota_gb", &quota_gb.to_string()),
        ("storage_mode", state.storage_mode.as_str()),
        ("object_storage_url", state.object_storage_url.as_str()),
        (
            "object_storage_public_url",
            state.object_storage_public_url.as_str(),
        ),
    ];

    for (key, value) in settings {
        sqlx::query("INSERT INTO app_settings (key, value) VALUES ($1, $2)")
            .bind(key)
            .bind(value)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    audit::write_audit(
        &setup_pool,
        Some(&user_id),
        "setup.complete",
        Some("instance"),
        Some(&user_id),
        Some(serde_json::json!({
            "instance_name": body.instance_name.trim(),
            "object_storage_bucket": bucket,
            "default_storage_quota_gb": quota_gb,
        })),
        &headers,
    )
    .await
    .ok();

    let token = create_token(
        user_id.clone(),
        body.email.trim().to_lowercase(),
        "admin".into(),
        &state.jwt_secret,
    )
    .map_err(AppError::Internal)?;

    Ok(Json(SetupResponse {
        auth: AuthResponse {
            token: Some(token),
            pending_activation: false,
            user: UserDto {
                id: user_id,
                email: body.email.trim().to_lowercase(),
                role: "admin".into(),
                enabled: true,
            },
        },
        restart_required: !use_startup_pool,
        configured_database_url: if use_startup_pool {
            None
        } else {
            Some(target_url.to_string())
        },
    }))
}

async fn ensure_not_complete_pool(pool: &sqlx::PgPool) -> Result<(), AppError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Err(AppError::Conflict("setup already completed".into()));
    }
    Ok(())
}
