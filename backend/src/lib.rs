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

pub mod admin;
pub mod audit;
pub mod auth;
pub mod audio;
pub mod image;
pub mod video;
pub mod browser_guard;
pub mod config;
pub mod outbound_target;
pub mod crypto;
pub mod db;
pub mod error;
pub mod files;
pub mod hls;
pub mod health;
pub mod jobs;
pub mod quota;
pub mod stream_ticket;
pub mod rate_limit;
pub mod redact;
pub mod request_tracking;
pub mod secrets;
pub mod setup;
pub mod shares;
pub mod storage;
pub mod user_sessions;

use config::Config;
use sqlx::PgPool;
use storage::{
    gated::GatedStorage,
    memory::MemoryStorage,
    put_gate::StoragePutGate,
    router::{RouterConfig, RouterStorage},
    Storage,
};

// Human: Shared dependencies injected into every handler — database, storage, secrets, and rate limiters.
// Agent: CLONED into Axum State; READ by handlers via State<Arc<AppState>>.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub storage: Arc<dyn Storage>,
    pub jwt_secret: String,
    /// Human: Shared bootstrap secret for first-run setup POST routes (header X-Setup-Token).
    /// Agent: READ by setup handlers; SET from Config.setup_token at startup.
    pub setup_token: String,
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
    /// Human: Integration tests use MemoryStorage — setup must not require live Nebular /health.
    /// Agent: TRUE in create_test_app_state; setup/test_setup_storage skip probe when set.
    pub setup_relaxes_storage_probe: bool,
    pub auth_login_rl: Arc<rate_limit::PerKeyRateLimiter>,
    pub auth_register_rl: Arc<rate_limit::PerKeyRateLimiter>,
    pub upload_rl: Arc<rate_limit::PerKeyRateLimiter>,
    pub hls_segment_rl: Arc<rate_limit::PerKeyRateLimiter>,
    /// Human: Throttle wrong x-share-password guesses on public share routes (SEC-009).
    /// Agent: KEYED by share token + client IP in resolve_public_share.
    pub share_password_rl: Arc<rate_limit::PerKeyRateLimiter>,
    /// Human: Whether X-Forwarded-For / X-Real-IP may define the rate-limit client IP.
    /// Agent: FALSE by default; TRUE when TRUST_PROXY_HEADERS is set behind nginx.
    pub trust_proxy_headers: bool,
    pub hls_key_store: hls::key_store::KeyStore,
    pub folder_download_jobs: files::zip_job::FolderDownloadRegistry,
    pub delete_jobs: files::delete_job::DeleteJobRegistry,
    pub cors_allowed_origins: String,
    pub max_upload_bytes: u64,
    pub hls_hardware: hls::hardware::HlsHardwareEncode,
    /// Human: `nebular` or `ownly` — where object index metadata is authoritative.
    pub storage_metadata_mode: String,
    /// Human: Serialize ffmpeg sidecar generation per storage_key on cache miss.
    /// Agent: READ by gif_preview::open_gif_preview_stream; WRITES per-key Mutex map.
    pub gif_preview_transcode_locks: Arc<files::gif_preview::GifPreviewTranscodeLocks>,
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
            Method::HEAD,
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
            axum::http::HeaderName::from_static("x-setup-token"),
        ])
}

// Human: Build rate limiters and AppState once storage and database pool are ready.
// Agent: READS Config; WRITES AppState; USES supplied Storage implementation (Nebular or memory).
async fn build_app_state(
    config: &Config,
    storage_override: Option<Arc<dyn Storage>>,
    setup_relaxes_storage_probe: bool,
) -> anyhow::Result<Arc<AppState>> {
    secrets::validate_startup_secrets(config)?;
    let pool = db::init_pool(&config.database_url).await?;
    info!("Database connected and migrations applied");

    let storage: Arc<dyn Storage> = if let Some(storage) = storage_override {
        storage
    } else {
        let object_storage_signing = std::env::var("NOS_SIGNING_SECRET")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| config.signing_secret.clone());
        let router = Arc::new(RouterStorage::new(
            pool.clone(),
            RouterConfig {
                primary_base_url: config.object_storage_url.clone(),
                public_base_url: config.object_storage_public_url.clone(),
                bucket: config.object_storage_bucket.clone(),
                jwt_secret: config.object_storage_jwt_secret.clone(),
                signing_secret: object_storage_signing,
            },
        )?) as Arc<dyn Storage>;
        let put_gate = StoragePutGate::new(config.storage_put_max_concurrent as usize);
        info!(
            storage_put_max_concurrent = put_gate.max_concurrent(),
            "Object storage PUT concurrency gate enabled"
        );
        Arc::new(GatedStorage::new(router, put_gate))
    };

    let storage_configured = config.storage_mode == "proxy";
    let environment = config.ownly_environment.clone();
    let git_sha = config
        .git_sha
        .clone()
        .or_else(|| std::env::var("GIT_SHA").ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let window = Duration::from_secs(60);
    let mut hls_hardware = hls::hardware::HlsHardwareEncode::from_config(config);
    hls_hardware.detect_and_log().await;

    Ok(Arc::new(AppState {
        pool: pool.clone(),
        storage,
        jwt_secret: config.jwt_secret.clone(),
        setup_token: config.setup_token.clone(),
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
        setup_relaxes_storage_probe,
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
        hls_segment_rl: Arc::new(rate_limit::PerKeyRateLimiter::new(
            config.hls_segment_rpm.max(1) as usize,
            window,
        )),
        share_password_rl: Arc::new(rate_limit::PerKeyRateLimiter::new(
            config.share_password_rpm.max(1) as usize,
            window,
        )),
        trust_proxy_headers: config.trust_proxy_headers || rate_limit::trust_proxy_from_env(),
        hls_key_store: hls::key_store::KeyStore::new(pool.clone(), config.signing_secret.clone()),
        folder_download_jobs: files::zip_job::FolderDownloadRegistry::new(),
        delete_jobs: files::delete_job::DeleteJobRegistry::new(),
        cors_allowed_origins: config.cors_allowed_origins.clone(),
        max_upload_bytes: config.max_upload_bytes,
        hls_hardware,
        storage_metadata_mode: config.storage_metadata_mode.clone(),
        gif_preview_transcode_locks: Arc::new(files::gif_preview::GifPreviewTranscodeLocks::new()),
    }))
}

// Human: Nebular OS may bind only after startup recompression; retry before failing API boot.
// Agent: HTTP GET /health; RETRIES up to 60s; BAILS if still unreachable in proxy mode.
async fn wait_for_nebular_health(base_url: &str) -> anyhow::Result<()> {
    let health_url = format!("{}/health", base_url.trim_end_matches('/'));
    const MAX_ATTEMPTS: u32 = 60;
    const RETRY_INTERVAL: Duration = Duration::from_secs(1);
    let client = reqwest::Client::new();

    for attempt in 1..=MAX_ATTEMPTS {
        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("Nebular OS health check passed");
                return Ok(());
            }
            Ok(resp) => tracing::warn!(
                status = %resp.status(),
                attempt,
                %health_url,
                "Nebular OS health check returned non-success; retrying"
            ),
            Err(e) => tracing::warn!(
                error = %e,
                attempt,
                %health_url,
                "Nebular OS health check request failed; retrying"
            ),
        }
        if attempt < MAX_ATTEMPTS {
            tokio::time::sleep(RETRY_INTERVAL).await;
        }
    }

    anyhow::bail!(
        "Nebular OS health check failed after {MAX_ATTEMPTS} attempts at {health_url}"
    )
}

// Human: Production startup path — connect Postgres, verify Nebular OS, then assemble AppState.
// Agent: CALLS wait_for_nebular_health; BAILS if proxy mode storage unreachable.
pub async fn create_app_state(config: &Config) -> anyhow::Result<Arc<AppState>> {
    if config.storage_mode != "proxy" {
        anyhow::bail!("only proxy storage mode is supported in this release");
    }
    wait_for_nebular_health(&config.object_storage_url).await?;
    build_app_state(config, None, false).await
}

// Human: Test harness entry — same AppState as production but with in-memory storage (no Nebular dependency).
// Agent: USES MemoryStorage; CALLED from integration tests; SKIPS object storage health probe.
pub async fn create_test_app_state(config: &Config) -> anyhow::Result<Arc<AppState>> {
    // Human: Integration tests use localhost Postgres — allow private outbound targets in harness only.
    // Agent: SET OWNLY_ALLOW_PRIVATE_OUTBOUND=1 before build_app_state; SEC-008/010 still gated by setup token.
    std::env::set_var("OWNLY_ALLOW_PRIVATE_OUTBOUND", "1");
    build_app_state(config, Some(Arc::new(MemoryStorage::new())), true).await
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
        .route(
            "/api/v1/setup/storage/test",
            post(setup::handlers::test_setup_storage),
        )
        .route("/api/v1/setup", post(setup::handlers::setup))
        .route("/api/v1/auth/register", post(auth::handlers::register))
        .route("/api/v1/auth/login", post(auth::handlers::login))
        .route(
            "/api/v1/settings/registration",
            get(auth::handlers::public_registration_setting),
        )
        .route(
            "/api/v1/files/{id}/stream",
            get(hls::handlers::stream_file),
        )
        .route(
            "/api/v1/files/{id}/preview-animation",
            get(files::gif_preview::stream_gif_preview_animation)
                .head(files::gif_preview::stream_gif_preview_animation),
        )
        .route(
            "/api/v1/files/{id}/hls/manifest.m3u8",
            get(hls::handlers::get_hls_manifest),
        )
        .route(
            "/api/v1/files/{id}/hls/key",
            get(hls::handlers::get_hls_key),
        )
        .route(
            "/api/v1/files/{id}/hls/init",
            get(hls::handlers::get_hls_init),
        )
        .route(
            "/api/v1/files/{id}/hls/segments/{segment}",
            get(hls::handlers::get_hls_segment),
        )
        .route(
            "/api/v1/public/shares/{token}",
            get(shares::handlers::public_share_overview),
        )
        .route(
            "/api/v1/public/shares/{token}/contents",
            get(shares::handlers::public_share_contents),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}",
            get(shares::handlers::public_share_file),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/preview-animation-url",
            get(shares::handlers::public_share_preview_animation_url),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/preview-animation",
            get(shares::handlers::public_share_preview_animation)
                .head(shares::handlers::public_share_preview_animation),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/download",
            get(shares::handlers::public_share_download),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/stream-url",
            get(shares::handlers::public_share_stream_url),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/waveform",
            get(shares::handlers::public_share_waveform),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/playlist",
            get(shares::handlers::public_share_playlist),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/key",
            get(shares::handlers::public_share_key),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/init",
            get(shares::handlers::public_share_init),
        )
        .route(
            "/api/v1/public/shares/{token}/files/{file_id}/segments/{segment}",
            get(shares::handlers::public_share_segment),
        )
        .route(
            "/api/v1/public/shares/{token}/all-files",
            get(shares::handlers::public_share_all_files),
        )
        .route(
            "/api/v1/public/shares/{token}/download-archive",
            post(shares::handlers::public_share_download_archive),
        )
        .route(
            "/api/v1/public/shares/{token}/download-archive/{job_id}",
            get(shares::handlers::public_share_download_archive_status),
        )
        .route(
            "/api/v1/public/shares/{token}/download-archive/{job_id}/archive",
            get(shares::handlers::public_share_download_archive_stream),
        );

    let protected_routes = Router::new()
        .route("/api/v1/me", get(auth::handlers::me))
        .route("/api/v1/me/profile", get(auth::handlers::profile))
        .route(
            "/api/v1/me/password",
            axum::routing::patch(auth::handlers::change_password),
        )
        .route("/api/v1/files", get(files::handlers::list_files))
        .route("/api/v1/files/batch", post(files::handlers::batch_files))
        .route(
            "/api/v1/files/check-upload-names",
            post(files::handlers::check_upload_names),
        )
        .route(
            "/api/v1/files/deletion-preview",
            post(files::delete_job::bulk_deletion_preview),
        )
        .route(
            "/api/v1/files/delete",
            post(files::delete_job::post_delete_job),
        )
        .route(
            "/api/v1/files/delete/{job_id}",
            get(files::delete_job::get_delete_job_status)
                .delete(files::delete_job::cancel_delete_job),
        )
        .route(
            "/api/v1/files/download",
            post(files::bulk_download::post_bulk_download),
        )
        .route(
            "/api/v1/files/download/{job_id}",
            get(files::bulk_download::get_bulk_download_status)
                .delete(files::bulk_download::delete_bulk_download_job),
        )
        .route(
            "/api/v1/files/download/{job_id}/archive",
            get(files::bulk_download::get_bulk_download_archive),
        )
        .route("/api/v1/files/{id}", get(files::handlers::get_file))
        .route(
            "/api/v1/files/{id}/deletion-preview",
            get(files::delete_job::file_deletion_preview),
        )
        .route(
            "/api/v1/files/upload",
            post(files::handlers::upload_file).layer(DefaultBodyLimit::max(max_upload)),
        )
        .route(
            "/api/v1/files/{id}/cancel-ingest",
            post(files::handlers::cancel_video_ingest),
        )
        .route(
            "/api/v1/files/{id}/stream-url",
            get(hls::handlers::get_stream_url),
        )
        .route(
            "/api/v1/files/{id}/playlist",
            get(hls::handlers::get_playlist),
        )
        .route("/api/v1/files/{id}/key", get(hls::handlers::get_key))
        .route("/api/v1/files/{id}/init", get(hls::handlers::get_init))
        .route(
            "/api/v1/files/{id}/segments/{segment}",
            get(hls::handlers::get_segment),
        )
        .route(
            "/api/v1/files/{id}/export",
            get(hls::handlers::get_export).post(hls::handlers::post_export),
        )
        .route("/api/v1/files/{id}/download", get(files::handlers::download_file))
        .route("/api/v1/files/{id}/download-url", get(files::handlers::download_url))
        .route(
            "/api/v1/files/{id}/preview-url",
            get(files::handlers::preview_url),
        )
        .route(
            "/api/v1/files/{id}/preview-animation-url",
            get(files::gif_preview::preview_animation_url),
        )
        .route(
            "/api/v1/files/{id}/waveform",
            get(crate::audio::handlers::get_waveform),
        )
        .route(
            "/api/v1/files/{id}/thumbnails",
            get(crate::video::handlers::get_thumbnails),
        )
        .route(
            "/api/v1/files/{id}/thumbnails/regenerate",
            post(crate::video::handlers::regenerate_thumbnails),
        )
        .route(
            "/api/v1/files/{id}/thumbnail",
            get(crate::video::handlers::get_selected_thumbnail)
                .patch(crate::video::handlers::select_thumbnail),
        )
        .route(
            "/api/v1/files/{id}/thumbnails/{index}",
            get(crate::video::handlers::get_thumbnail_option),
        )
        .route(
            "/api/v1/files/{id}/grid-thumbnail",
            get(crate::image::handlers::get_grid_thumbnail),
        )
        .route("/api/v1/files/{id}/copy", post(files::handlers::copy_file))
        .route(
            "/api/v1/files/{id}",
            patch(files::handlers::move_file).delete(files::handlers::delete_file),
        )
        .route("/api/v1/folders", get(files::folders::list_folders).post(files::folders::create_folder))
        .route(
            "/api/v1/folders/{id}/download",
            get(files::folder_download::get_folder_download_status)
                .post(files::folder_download::post_folder_download)
                .delete(files::folder_download::delete_folder_download_job),
        )
        .route(
            "/api/v1/folders/{id}/download/archive",
            get(files::folder_download::get_folder_download_archive),
        )
        .route(
            "/api/v1/folders/{id}/deletion-preview",
            get(files::folders::folder_deletion_preview),
        )
        .route("/api/v1/folders/{id}", delete(files::folders::delete_folder))
        .route("/api/v1/dashboard", get(files::handlers::dashboard_summary))
        .route(
            "/api/v1/recycle-bin",
            get(files::recycle_bin::list_recycle_bin).delete(files::recycle_bin::empty_recycle_bin),
        )
        .route(
            "/api/v1/recycle-bin/deletion-preview",
            get(files::recycle_bin::recycle_bin_deletion_preview),
        )
        .route(
            "/api/v1/recycle-bin/delete",
            post(files::recycle_bin::post_recycle_bin_delete_job),
        )
        .route(
            "/api/v1/recycle-bin/restore",
            post(files::recycle_bin::restore_recycle_bin_items),
        )
        .route("/api/v1/shares", post(shares::handlers::create_share).get(shares::handlers::lookup_share))
        .route(
            "/api/v1/shares/save-from-public",
            post(shares::handlers::save_from_public_share),
        )
        .route("/api/v1/shares/status", post(shares::handlers::share_status_bulk))
        .route("/api/v1/shares/resource", get(shares::handlers::resource_shares))
        .route("/api/v1/shares/with-me", get(shares::handlers::list_shared_with_me))
        .route(
            "/api/v1/shares/with-me/{id}",
            delete(shares::handlers::leave_shared_with_me),
        )
        .route("/api/v1/shares/by-me", get(shares::handlers::list_shared_by_me))
        .route(
            "/api/v1/shares/granted/files/{id}/download",
            get(shares::handlers::download_granted_file),
        )
        .route("/api/v1/shares/user", post(shares::handlers::create_user_share))
        .route("/api/v1/shares/user/{id}", delete(shares::handlers::revoke_user_share))
        .route(
            "/api/v1/shares/{id}",
            patch(shares::handlers::update_share).delete(shares::handlers::revoke_share),
        )
        .route("/api/v1/jobs", get(jobs::handlers::list_jobs))
        .route(
            "/api/v1/jobs/{id}",
            get(jobs::handlers::get_job).delete(jobs::handlers::delete_job),
        )
        .route(
            "/api/v1/admin/overview",
            get(admin::console::overview),
        )
        .route(
            "/api/v1/admin/audit-logs",
            get(admin::console::list_audit_logs),
        )
        .route(
            "/api/v1/admin/storage",
            get(admin::storage_nodes::list_storage_nodes),
        )
        .route(
            "/api/v1/admin/storage/nodes",
            post(admin::storage_nodes::create_storage_node),
        )
        .route(
            "/api/v1/admin/storage/nodes/{id}",
            patch(admin::storage_nodes::update_storage_node),
        )
        .route(
            "/api/v1/admin/storage/nodes/{id}/detail",
            get(admin::storage_nodes::get_storage_node_detail),
        )
        .route(
            "/api/v1/admin/settings",
            get(admin::console::get_settings).patch(admin::console::patch_settings),
        )
        .route(
            "/api/v1/admin/security",
            get(admin::console::security_overview),
        )
        .route(
            "/api/v1/admin/users/roles",
            get(admin::handlers::list_roles),
        )
        .route(
            "/api/v1/admin/users",
            get(admin::handlers::list_users).post(admin::handlers::create_user),
        )
        .route(
            "/api/v1/admin/users/{id}/sessions",
            get(admin::handlers::list_user_sessions),
        )
        .route(
            "/api/v1/admin/users/{id}/sessions/revoke-others",
            post(admin::handlers::revoke_other_sessions),
        )
        .route(
            "/api/v1/admin/users/{id}/sessions/{session_id}/revoke",
            post(admin::handlers::revoke_user_session),
        )
        .route(
            "/api/v1/admin/users/{id}",
            patch(admin::handlers::update_user).delete(admin::handlers::delete_user),
        )
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
// Human: Guarantee a writable OS temp directory before video upload/HLS/export scratch files are created.
// Agent: READS TMPDIR or /tmp via std::env::temp_dir; CALLS create_dir_all at startup.
fn ensure_temp_dir() -> anyhow::Result<()> {
    let temp_dir = std::env::temp_dir();
    std::fs::create_dir_all(&temp_dir).map_err(|e| {
        anyhow::anyhow!("create temp dir {}: {e}", temp_dir.display())
    })?;
    info!(temp_dir = %temp_dir.display(), "temp directory ready for upload scratch files");
    Ok(())
}

pub async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=debug".into()),
        )
        .init();

    let config = Config::from_env()?;
    ensure_temp_dir()?;
    let state = create_app_state(&config).await?;
    jobs::start_worker_pool(state.clone(), jobs::JobWorkerSettings::from(&config));
    files::recycle_bin::start_recycle_bin_purger(state.clone());
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr).await?;
    info!("Ownly API listening on {}", config.bind_addr);
    axum::serve(listener, app).await?;
    Ok(())
}
