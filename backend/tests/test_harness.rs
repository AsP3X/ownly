// Human: Shared helpers for HTTP integration tests — database gating and app bootstrap.
// Agent: READS DATABASE_URL; PANICS in CI when unset; SKIPS locally when Postgres unavailable.

use ownly_backend::{config::Config, create_test_app_state, AppState};
use std::sync::Arc;

/// Human: True when integration tests must fail instead of silently skipping.
// Agent: READS CI or OWNLY_REQUIRE_DATABASE_URL env vars.
pub fn should_require_database() -> bool {
    std::env::var("CI").ok().as_deref() == Some("true")
        || std::env::var("OWNLY_REQUIRE_DATABASE_URL").ok().as_deref() == Some("1")
}

/// Human: Build test Config mirroring http_integration defaults.
// Agent: CALLED by TestHarness::state; USES fixed secrets safe for local/CI only.
pub fn test_config(database_url: &str) -> Config {
    Config {
        database_url: database_url.to_string(),
        jwt_secret: "test-jwt-secret-at-least-32-chars-long!!".to_string(),
        setup_token: "test-setup-token-at-least-32-chars!!".to_string(),
        bind_addr: "127.0.0.1:0".to_string(),
        storage_mode: "proxy".to_string(),
        object_storage_url: "http://localhost:9000".to_string(),
        object_storage_public_url: "http://localhost:9000".to_string(),
        object_storage_bucket: "media".to_string(),
        signing_secret: "test-signing-secret-not-default-value".to_string(),
        object_storage_jwt_secret: "test-nos-jwt-secret-not-default-value!!".to_string(),
        url_expiry_seconds: 3600,
        ownly_environment: "development".to_string(),
        git_sha: None,
        auth_login_rpm: 15,
        auth_register_rpm: 5,
        upload_rpm: 30,
        cors_allowed_origins: String::new(),
        max_upload_bytes: 1024 * 1024,
        hls_segment_rpm: 480,
        job_worker_count: 2,
        max_concurrent_transcodes_per_user: 2,
        job_stale_minutes: 15,
        job_heartbeat_seconds: 30,
        job_recovery_poll_seconds: 60,
        hls_hardware_encode: "off".into(),
        hls_vaapi_device: "/dev/dri/renderD128".into(),
        hls_video_crf: 20,
        hls_video_quality: 22,
        hls_full_transcode_quality: 26,
        hls_large_maxrate: "5M".into(),
        hls_large_bufsize: "10M".into(),
        storage_metadata_mode: "nebular".into(),
        storage_put_max_concurrent: 2,
        object_storage_request_timeout_secs: 900,
        trust_proxy_headers: false,
        share_password_rpm: 8,
    }
}

pub struct TestHarness;

impl TestHarness {
    /// Human: Load AppState for an integration test or skip/panic based on environment.
    // Agent: RETURNS None when DATABASE_URL unset locally; PANICS in CI on missing DB.
    pub async fn state(test_name: &str) -> Option<Arc<AppState>> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) if !url.is_empty() => url,
            _ => {
                if should_require_database() {
                    panic!("{test_name}: DATABASE_URL is required but unset");
                }
                eprintln!("skipping {test_name}: DATABASE_URL unset");
                return None;
            }
        };

        let cfg = test_config(&database_url);
        match create_test_app_state(&cfg).await {
            Ok(state) => Some(state),
            Err(error) => {
                if should_require_database() {
                    panic!("{test_name}: create_test_app_state failed: {error}");
                }
                eprintln!("skipping {test_name}: {error}");
                None
            }
        }
    }
}
