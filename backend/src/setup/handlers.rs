// Human: First-run setup endpoints — admin account, instance settings, storage node, database test.
// Agent: READS users COUNT for gating; WRITES users + app_settings + storage_nodes in TX; RETURNS AuthResponse on success once.

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    admin::storage_nodes,
    audit,
    auth::handlers::{create_token, hash_password, AuthResponse, UserDto},
    db,
    error::AppError,
    outbound_target,
    setup::redact,
    AppState,
};

// Human: Postgres advisory lock id — serializes concurrent POST /setup on empty databases (SEC-005).
// Agent: pg_advisory_xact_lock held for the setup transaction; RELEASED on commit/rollback.
const SETUP_ADVISORY_LOCK_ID: i64 = 0x4f57_4e4c_5900;

/// Human: Header the SPA and audit scripts send with setup mutation requests.
/// Agent: MATCHES SEC-005/SEC-012 bootstrap probe; compared to AppState.setup_token.
pub const SETUP_TOKEN_HEADER: &str = "X-Setup-Token";

// Human: Reject setup mutations unless the caller presents the configured bootstrap secret.
// Agent: READS X-Setup-Token header; RETURNS 403 when missing or wrong (checked before setup_complete gate).
fn require_setup_token(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    let provided = headers
        .get(SETUP_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if provided != state.setup_token {
        return Err(AppError::Forbidden(
            "valid setup token is required to complete instance setup".into(),
        ));
    }
    Ok(())
}

// Human: Bump when adding routes the SPA depends on (drive dashboard, admin console, etc.).
// Agent: EXPOSED via GET /api/v1/version; MISSING on older images → ops run check-api-deployment.sh.
pub const API_SURFACE: &str = "20260604-drive-admin";

#[derive(Debug, Serialize)]
pub struct ReleaseInfo {
    pub version: &'static str,
    pub git_sha: String,
    pub environment: String,
    /// Human: Lets operators confirm frontend/backend route parity without guessing from 404s.
    pub api_surface: &'static str,
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

#[derive(Debug, Deserialize)]
pub struct StorageEndpointBody {
    pub base_url: String,
}

#[derive(Debug, Serialize)]
pub struct DatabaseTestResponse {
    pub ok: bool,
    pub driver: String,
}

#[derive(Debug, Serialize)]
pub struct StorageTestResponse {
    pub ok: bool,
    pub latency_ms: Option<u128>,
    pub node_id: Option<String>,
    pub status: Option<String>,
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
    pub storage_node_id: Option<String>,
    pub storage_node_region_label: Option<String>,
    pub storage_node_base_url: Option<String>,
    pub storage_node_architecture: Option<String>,
    pub storage_node_target_capacity_value: Option<f64>,
    pub storage_node_target_capacity_unit: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SetupResponse {
    #[serde(flatten)]
    pub auth: AuthResponse,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub restart_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_database_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_object_storage_url: Option<String>,
}

// Human: Expose build metadata for the about screen and health dashboards.
// Agent: READS AppState git_sha + environment; NO DB; PUBLIC route.
pub async fn release_info(State(state): State<Arc<AppState>>) -> Json<ReleaseInfo> {
    Json(ReleaseInfo {
        version: env!("CARGO_PKG_VERSION"),
        git_sha: state.git_sha.clone(),
        environment: state.environment.clone(),
        api_surface: API_SURFACE,
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
    headers: HeaderMap,
) -> Result<Json<SetupDatabaseInfo>, AppError> {
    // Human: Pre-setup wizard only — bootstrap token required; password redacted (SEC-001).
    // Agent: require_setup_token + ensure_not_complete; RETURNS redacted database_url.
    require_setup_token(&headers, &state)?;
    ensure_not_complete(&state).await?;
    Ok(Json(SetupDatabaseInfo {
        driver: db::driver_from_url(&state.database_url)
            .unwrap_or("unknown")
            .to_string(),
        database_url: redact::redact_database_url(&state.database_url),
    }))
}

pub async fn setup_storage_info(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<StorageInfo>, AppError> {
    // Human: Pre-setup wizard only — bootstrap token gates infrastructure metadata (SEC-001).
    // Agent: require_setup_token + ensure_not_complete; BLOCKED with 409 after first admin exists.
    require_setup_token(&headers, &state)?;
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
    headers: HeaderMap,
    Json(body): Json<DatabaseUrlBody>,
) -> Result<Json<DatabaseTestResponse>, AppError> {
    require_setup_token(&headers, &state)?;
    ensure_not_complete(&state).await?;
    let url = body.database_url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("database_url is required".into()));
    }
    let driver = db::driver_from_url(url)
        .ok_or_else(|| AppError::BadRequest("unsupported database_url scheme".into()))?
        .to_string();
    outbound_target::validate_database_connection_url(url)?;
    db::test_connection(url).await.map_err(|_| {
        AppError::BadRequest(
            "could not connect to database; check host, credentials, and network".into(),
        )
    })?;
    let _ = &state;
    Ok(Json(DatabaseTestResponse { ok: true, driver }))
}

// Human: Verify Nebular /health before the wizard registers the first storage node.
// Agent: POST /setup/storage/test; READS base_url; NO DB writes.
pub async fn test_setup_storage(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<StorageEndpointBody>,
) -> Result<Json<StorageTestResponse>, AppError> {
    require_setup_token(&headers, &state)?;
    ensure_not_complete(&state).await?;
    let base_url = storage_nodes::normalize_base_url(&body.base_url)?;
    outbound_target::validate_http_outbound_base_url(&base_url)?;
    if state.setup_relaxes_storage_probe {
        return Ok(Json(StorageTestResponse {
            ok: true,
            latency_ms: None,
            node_id: None,
            status: Some("skipped".into()),
        }));
    }
    let probe = storage_nodes::probe_storage_endpoint(&base_url).await;
    if !probe.reachable {
        return Err(AppError::BadRequest(
            "could not reach object storage; check the endpoint URL and network".into(),
        ));
    }
    Ok(Json(StorageTestResponse {
        ok: true,
        latency_ms: probe.latency_ms,
        node_id: probe.node_id,
        status: probe.status,
    }))
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
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

// Human: Resolve setup storage node fields — wizard values override env defaults.
fn resolve_setup_storage_node(
    body: &SetupRequest,
    state: &AppState,
) -> Result<(String, String, String, Option<i64>), AppError> {
    let base_url = if let Some(raw) = body
        .storage_node_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        storage_nodes::normalize_base_url(raw)?
    } else {
        storage_nodes::normalize_base_url(&state.object_storage_url)?
    };

    let id = if let Some(raw) = body
        .storage_node_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        storage_nodes::normalize_node_id(raw)?
    } else {
        "node-primary".to_string()
    };

    let region_label = body
        .storage_node_region_label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(body.instance_name.trim())
        .to_string();

    let target_capacity_bytes = match (
        body.storage_node_target_capacity_value,
        body.storage_node_target_capacity_unit.as_deref(),
    ) {
        (Some(value), Some(unit)) => Some(storage_nodes::parse_target_capacity_bytes(value, unit)?),
        (None, None) => None,
        _ => {
            return Err(AppError::BadRequest(
                "target capacity requires both value and unit (MB, GB, or TB)".into(),
            ));
        }
    };

    Ok((id, region_label, base_url, target_capacity_bytes))
}

// Human: Atomic first admin + settings seed — only succeeds while the users table is empty.
// Agent: WRITES users + app_settings TX; AUDIT setup.complete; RETURNS JWT; HTTP 409 when already initialized.
pub async fn setup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SetupRequest>,
) -> Result<Json<SetupResponse>, AppError> {
    // Human: Bootstrap secret gates setup — browser Sec-Fetch-Site is not required here (Compose zero-config).
    // Agent: require_setup_token only; register/admin use browser_guard (Sec-Fetch-Site or matching Origin).
    require_setup_token(&headers, &state)?;
    let target_url = body
        .database_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(state.database_url.as_str());

    if db::driver_from_url(target_url).is_none() {
        return Err(AppError::BadRequest("unsupported database_url scheme".into()));
    }
    outbound_target::validate_database_connection_url(target_url)?;

    let (
        storage_node_id,
        storage_node_region,
        storage_base_url,
        storage_capacity_bytes,
    ) = resolve_setup_storage_node(&body, &state)?;

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

    if body.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    if !state.setup_relaxes_storage_probe {
        let storage_probe = storage_nodes::probe_storage_endpoint(&storage_base_url).await;
        if !storage_probe.reachable {
            return Err(AppError::BadRequest(
                "object storage endpoint is unreachable; test the connection before completing setup".into(),
            ));
        }
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
    let storage_matches_startup = urls_equivalent(&storage_base_url, &state.object_storage_url);

    let mut tx = setup_pool.begin().await?;

    // Human: Serialize first-admin creation — only one concurrent POST /setup may commit (SEC-005).
    // Agent: pg_advisory_xact_lock + COUNT in same TX; RETURNS 409 when another setup won the race.
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(SETUP_ADVISORY_LOCK_ID)
        .execute(&mut *tx)
        .await?;

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&mut *tx)
        .await?;
    if user_count > 0 {
        return Err(AppError::Conflict("setup already completed".into()));
    }

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
        ("object_storage_url", storage_base_url.as_str()),
        (
            "object_storage_public_url",
            state.object_storage_public_url.as_str(),
        ),
        ("storage_metadata_mode", state.storage_metadata_mode.as_str()),
    ];

    // Human: Upsert settings — migration 015 may seed storage_metadata_mode before first setup completes.
    // Agent: ON CONFLICT DO UPDATE; AVOIDS duplicate key on app_settings_pkey during POST /setup.
    for (key, value) in settings {
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    // Human: Persist the first storage node in the registry — replaces env-only bootstrap.
    // Agent: WRITES storage_nodes row; CALLED once after setup TX commits.
    storage_nodes::register_setup_storage_node(
        &setup_pool,
        &storage_node_id,
        &storage_node_region,
        &storage_base_url,
        storage_capacity_bytes,
    )
    .await?;

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
            "storage_node_id": storage_node_id,
            "storage_node_base_url": storage_base_url,
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
        None,
        0,
    )
    .map_err(AppError::Internal)?;

    let restart_required = !use_startup_pool || !storage_matches_startup;

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
        restart_required,
        configured_database_url: if use_startup_pool {
            None
        } else {
            Some(target_url.to_string())
        },
        configured_object_storage_url: if storage_matches_startup {
            None
        } else {
            Some(storage_base_url)
        },
    }))
}

