// Human: Application entrypoint wiring — Axum router, shared state, middleware, and startup.
// Agent: EXPORTS create_router/create_app_state; COMPOSES auth/setup/files routes; READS Config env.

use axum::{
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method, Request},
    middleware,
    routing::{delete, get, patch, post},
    Router,
};
use std::sync::Arc;
use std::time::Duration;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use tracing::{info, Level};

pub mod audit;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod files;
pub mod health;
pub mod rate_limit;
pub mod redact;
pub mod request_tracking;
pub mod secrets;
pub mod setup;
pub mod storage;

use config::Config;
use sqlx::PgPool;
use storage::{memory::MemoryStorage, nebula::NebulaStorage, Storage};

// Human: Shared dependencies injected into every handler — database, storage, secrets, and rate limiters.
// Agent: CLONED into Axum State; READ by handlers via State<Arc<AppState>>.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub storage: Arc<dyn Storage>,
    pub jwt_secret: String,
    pub signing_secret: String,
    pub url_expiry_seconds: u64,
    pub environment: String,
    pub git_sha: String,
    pub database_url: String,
    pub object_storage_url: String,
    pub object_storage_public_url: String,
    pub object_storage_bucket: String,
    pub storage_mode: String,
    pub storage_configured: bool,
    pub auth_login_rl: Arc<rate_limit::PerKeyRateLimiter>,
    pub auth_register_rl: Arc<rate_limit::PerKeyRateLimiter>,
    pub upload_rl: Arc<rate_limit::PerKeyRateLimiter>,
    pub cors_allowed_origins: String,
    pub max_upload_bytes: u64,
}

// Human: Restrict browser origins in production while staying permissive when unset for local dev.
// Agent: READS comma-separated CORS_ALLOWED_ORIGINS; RETURNS permissive CorsLayer when empty.
fn build_cors_layer(cors_allowed_origins: &str) -> CorsLayer {
    let trimmed = cors_allowed_origins.trim();
    if trimmed.is_empty() {
        return CorsLayer::permissive();
    }
    let origins: Vec<HeaderValue> = trimmed
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    if origins.is_empty() {
        return CorsLayer::permissive();
    }
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            request_tracking::REQUEST_ID_HEADER.clone(),
        ])
}

// Human: Build rate limiters and AppState once storage and database pool are ready.
// Agent: READS Config; WRITES AppState; USES supplied Storage implementation (Nebular or memory).
async fn build_app_state(config: &Config, storage: Arc<dyn Storage>) -> anyhow::Result<Arc<AppState>> {
    secrets::validate_startup_secrets(config)?;
    let pool = db::init_pool(&config.database_url).await?;
    info!("Database connected and migrations applied");

    let storage_configured = config.storage_mode == "proxy";
    let environment = config.mediavault_environment.clone();
    let git_sha = config
        .git_sha
        .clone()
        .or_else(|| std::env::var("GIT_SHA").ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let window = Duration::from_secs(60);
    Ok(Arc::new(AppState {
        pool,
        storage,
        jwt_secret: config.jwt_secret.clone(),
        signing_secret: config.signing_secret.clone(),
        url_expiry_seconds: config.url_expiry_seconds,
        environment,
        git_sha,
        database_url: config.database_url.clone(),
        object_storage_url: config.object_storage_url.clone(),
        object_storage_public_url: config.object_storage_public_url.clone(),
        object_storage_bucket: config.object_storage_bucket.clone(),
        storage_mode: config.storage_mode.clone(),
        storage_configured,
        auth_login_rl: Arc::new(rate_limit::PerKeyRateLimiter::new(
            config.auth_login_rpm.max(1) as usize,
            window,
        )),
        auth_register_rl: Arc::new(rate_limit::PerKeyRateLimiter::new(
            config.auth_register_rpm.max(1) as usize,
            window,
        )),
        upload_rl: Arc::new(rate_limit::PerKeyRateLimiter::new(
            config.upload_rpm.max(1) as usize,
            window,
        )),
        cors_allowed_origins: config.cors_allowed_origins.clone(),
        max_upload_bytes: config.max_upload_bytes,
    }))
}

// Human: Production startup path — connect Postgres, verify Nebular OS, then assemble AppState.
// Agent: CALLS NebulaStorage health GET; BAILS if proxy mode storage unreachable.
pub async fn create_app_state(config: &Config) -> anyhow::Result<Arc<AppState>> {
    let storage: Arc<dyn Storage> = if config.storage_mode == "proxy" {
        let nebula = NebulaStorage::new(
            config.object_storage_url.clone(),
            config.object_storage_public_url.clone(),
            config.object_storage_bucket.clone(),
            &config.object_storage_jwt_secret,
            &config.signing_secret,
        )?;
        let health_url = format!("{}/health", config.object_storage_url.trim_end_matches('/'));
        match reqwest::get(&health_url).await {
            Ok(resp) if resp.status().is_success() => info!("Nebular OS health check passed"),
            Ok(resp) => anyhow::bail!("Nebular OS health check failed with status {}", resp.status()),
            Err(e) => anyhow::bail!("Nebular OS health check failed: {e} at {health_url}"),
        }
        Arc::new(nebula)
    } else {
        anyhow::bail!("only proxy storage mode is supported in this release");
    };

    build_app_state(config, storage).await
}

// Human: Test harness entry — same AppState as production but with in-memory storage (no Nebular dependency).
// Agent: USES MemoryStorage; CALLED from integration tests; SKIPS object storage health probe.
pub async fn create_test_app_state(config: &Config) -> anyhow::Result<Arc<AppState>> {
    build_app_state(config, Arc::new(MemoryStorage::new())).await
}

// Human: Structured tracing span per HTTP request using x-request-id for log correlation.
// Agent: READS x-request-id header or literal "missing"; LOGS method + uri + request_id.
fn make_request_span(request: &Request<axum::body::Body>) -> tracing::Span {
    let request_id = request
        .headers()
        .get(&request_tracking::REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("missing");
    tracing::span!(
        Level::INFO,
        "request",
        request_id = %request_id,
        method = %request.method(),
        uri = %request.uri(),
    )
}

// Human: Mount public and authenticated `/api/v1` routes with CORS, tracing, and request id middleware.
// Agent: MERGES route groups; APPLIES auth_middleware on protected subtree; RETURNS Router<AppState>.
pub fn create_router(state: Arc<AppState>) -> Router {
    let cors_layer = build_cors_layer(&state.cors_allowed_origins);
    let max_upload = state.max_upload_bytes as usize;

    let public_routes = Router::new()
        .route("/api/v1/version", get(setup::handlers::release_info))
        .route("/api/v1/health/ready", get(health::readiness))
        .route("/api/v1/setup/status", get(setup::handlers::setup_status))
        .route("/api/v1/setup/database", get(setup::handlers::setup_database_info))
        .route("/api/v1/setup/storage", get(setup::handlers::setup_storage_info))
        .route(
            "/api/v1/setup/database/test",
            post(setup::handlers::test_setup_database),
        )
        .route("/api/v1/setup", post(setup::handlers::setup))
        .route("/api/v1/auth/register", post(auth::handlers::register))
        .route("/api/v1/auth/login", post(auth::handlers::login))
        .route(
            "/api/v1/settings/registration",
            get(auth::handlers::public_registration_setting),
        );

    let protected_routes = Router::new()
        .route("/api/v1/me", get(auth::handlers::me))
        .route("/api/v1/files", get(files::handlers::list_files))
        .route(
            "/api/v1/files/upload",
            post(files::handlers::upload_file).layer(DefaultBodyLimit::max(max_upload)),
        )
        .route("/api/v1/files/{id}/download", get(files::handlers::download_file))
        .route("/api/v1/files/{id}/download-url", get(files::handlers::download_url))
        .route(
            "/api/v1/files/{id}",
            patch(files::handlers::move_file).delete(files::handlers::delete_file),
        )
        .route("/api/v1/folders", get(files::folders::list_folders).post(files::folders::create_folder))
        .route("/api/v1/folders/{id}", delete(files::folders::delete_folder))
        .route("/api/v1/dashboard", get(files::handlers::dashboard_summary))
        .layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(middleware::from_fn(request_tracking::request_id_middleware))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<_>| {
                make_request_span(request)
            }),
        )
        .layer(cors_layer)
        .with_state(state)
}

// Human: Load config, build state, bind TCP, and serve until shutdown.
// Agent: CALLS create_app_state + create_router; LISTENS on BIND_ADDR env.
pub async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=debug".into()),
        )
        .init();

    let config = Config::from_env()?;
    let state = create_app_state(&config).await?;
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr).await?;
    info!("MediaVault API listening on {}", config.bind_addr);
    axum::serve(listener, app).await?;
    Ok(())
}
