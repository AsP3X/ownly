// Human: Reject committed defaults and short secrets before the API accepts traffic or signs JWTs.
// Agent: READS Config secret fields; RETURNS Err on weak/short values; CALLED from create_app_state and run.

use crate::config::{
    Config, COMPOSE_DEV_JWT_SECRET, COMPOSE_DEV_OBJECT_STORAGE_JWT_SECRET, COMPOSE_DEV_SETUP_TOKEN,
    COMPOSE_DEV_SIGNING_SECRET,
};

pub const MIN_SECRET_LEN: usize = 32;

// Human: Committed docker-compose.yml literals — allowed in development, forbidden in production.
// Agent: MATCHED when OWNLY_ENVIRONMENT=production; REJECTS at validate_startup_secrets.
const COMPOSE_DEV_SECRETS: &[&str] = &[
    COMPOSE_DEV_SETUP_TOKEN,
    COMPOSE_DEV_JWT_SECRET,
    COMPOSE_DEV_SIGNING_SECRET,
    COMPOSE_DEV_OBJECT_STORAGE_JWT_SECRET,
];

const KNOWN_WEAK_SECRETS: &[&str] = &[
    "change-me-in-production",
    "change-me-in-production-jwt-secret",
    "dev-jwt-secret-change-me",
    "dev-nos-jwt-secret-change-me",
    "dev-nos-signing-secret-change-me",
    "ownly-master-key",
];

// Human: True when the value is empty, an init placeholder, or a known weak default from code or compose.
// Agent: TRIMS input; MATCHES KNOWN_WEAK_SECRETS or GENERATE_ME; NO side effects.
pub fn is_weak_secret(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || trimmed == "GENERATE_ME" || KNOWN_WEAK_SECRETS.contains(&trimmed)
}

// Human: Operator-facing hint without echoing the secret value.
// Agent: RETURNS static reason when is_weak_secret; used in validate_field error text.
fn weak_secret_reason(env_name: &str, value: &str) -> Option<&'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Some(
            "empty — recreate backend with `docker compose up -d --force-recreate backend` (Compose must inject SETUP_TOKEN)",
        );
    }
    if trimmed == "GENERATE_ME" {
        return Some("still GENERATE_ME — run `docker compose --profile init run --rm init-env`");
    }
    if KNOWN_WEAK_SECRETS.contains(&trimmed) {
        if trimmed == "change-me-in-production" && env_name == "SETUP_TOKEN" {
            return Some(
                "missing from container — run `git pull`, then `docker compose up -d --build --force-recreate backend frontend`; \
                 check `docker compose config | grep SETUP_TOKEN` shows the compose literal, not empty",
            );
        }
        return Some(
            "known weak default (e.g. change-me-in-production) — replace with `openssl rand -hex 32`",
        );
    }
    None
}

// Human: True when the value equals a committed Compose dev secret literal.
// Agent: USED only when OWNLY_ENVIRONMENT=production to block public-repo defaults.
fn is_compose_dev_secret(value: &str) -> bool {
    COMPOSE_DEV_SECRETS.contains(&value.trim())
}

// Human: Production profile must not accept development-only secret literals.
// Agent: READS ownly_environment case-insensitively; MATCHES "production".
pub(crate) fn is_production_environment(env: &str) -> bool {
    env.trim().eq_ignore_ascii_case("production")
}

// Human: Production requires explicit browser origins — permissive CORS is dev-only (SEC-027).
// Agent: CALLED from validate_startup_secrets when OWNLY_ENVIRONMENT=production.
fn validate_production_cors(cors_allowed_origins: &str) -> anyhow::Result<()> {
    let trimmed = cors_allowed_origins.trim();
    if trimmed.is_empty() {
        anyhow::bail!(
            "CORS_ALLOWED_ORIGINS is required when OWNLY_ENVIRONMENT=production. \
             Set comma-separated origins (e.g. https://app.example.com) — permissive CORS is not allowed in production."
        );
    }
    let origins: Vec<&str> = trimmed
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if origins.is_empty() {
        anyhow::bail!(
            "CORS_ALLOWED_ORIGINS must include at least one origin when OWNLY_ENVIRONMENT=production."
        );
    }
    for origin in origins {
        if origin.parse::<axum::http::HeaderValue>().is_err() {
            anyhow::bail!(
                "CORS_ALLOWED_ORIGINS contains invalid origin '{origin}'. \
                 Use full origins such as https://app.example.com (no trailing path)."
            );
        }
    }
    Ok(())
}

// Human: Fail fast with a field name so operators know which env var to fix.
// Agent: CALLS is_weak_secret + length check; BAILS with anyhow message naming env var.
fn validate_field(env_name: &str, value: &str, production: bool) -> anyhow::Result<()> {
    if production && is_compose_dev_secret(value) {
        anyhow::bail!(
            "{env_name} rejected at startup: committed Docker Compose development secret is not allowed when OWNLY_ENVIRONMENT=production. \
             Generate unique values with `openssl rand -hex 32` and rotate JWT_SECRET, SETUP_TOKEN, SIGNING_SECRET, and OBJECT_STORAGE_JWT_SECRET."
        );
    }
    if is_weak_secret(value) {
        let hint = weak_secret_reason(env_name, value).unwrap_or("invalid placeholder or default");
        anyhow::bail!(
            "{env_name} rejected at startup: {hint}. \
             Need at least {MIN_SECRET_LEN} random characters. \
             On the server: `sh scripts/verify-compose-secrets.sh` then `docker compose up -d --build --force-recreate backend frontend`."
        );
    }
    if value.len() < MIN_SECRET_LEN {
        anyhow::bail!(
            "{env_name} must be at least {MIN_SECRET_LEN} characters (got {}).",
            value.len()
        );
    }
    Ok(())
}

// Human: Gate startup so weak JWT/signing/NOS secrets cannot serve requests.
// Agent: VALIDATES jwt_secret, signing_secret, object_storage_jwt_secret on Config.
pub fn validate_startup_secrets(config: &Config) -> anyhow::Result<()> {
    let production = is_production_environment(&config.ownly_environment);
    validate_field("JWT_SECRET", &config.jwt_secret, production)?;
    validate_field("SETUP_TOKEN", &config.setup_token, production)?;
    validate_field("SIGNING_SECRET", &config.signing_secret, production)?;
    validate_field(
        "OBJECT_STORAGE_JWT_SECRET",
        &config.object_storage_jwt_secret,
        production,
    )?;
    if production {
        validate_production_cors(&config.cors_allowed_origins)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_weak_defaults() {
        for weak in KNOWN_WEAK_SECRETS {
            assert!(is_weak_secret(weak), "expected weak: {weak}");
        }
        assert!(is_weak_secret("GENERATE_ME"));
    }

    #[test]
    fn compose_dev_secrets_allowed_in_development() {
        for secret in COMPOSE_DEV_SECRETS {
            assert!(
                !is_weak_secret(secret),
                "dev secret should pass weak check: {secret}"
            );
            assert!(secret.len() >= MIN_SECRET_LEN);
            assert!(is_compose_dev_secret(secret));
        }
    }

    #[test]
    fn compose_dev_secrets_rejected_in_production() {
        let mut config = crate::config::Config {
            database_url: "postgres://u:p@localhost/db".into(),
            jwt_secret: COMPOSE_DEV_JWT_SECRET.into(),
            setup_token: COMPOSE_DEV_SETUP_TOKEN.into(),
            signing_secret: COMPOSE_DEV_SIGNING_SECRET.into(),
            object_storage_jwt_secret: COMPOSE_DEV_OBJECT_STORAGE_JWT_SECRET.into(),
            bind_addr: "127.0.0.1:3000".into(),
            storage_mode: "proxy".into(),
            object_storage_url: "http://localhost:9000".into(),
            object_storage_public_url: "http://localhost:9000".into(),
            object_storage_bucket: "media".into(),
            url_expiry_seconds: 3600,
            ownly_environment: "production".into(),
            git_sha: None,
            auth_login_rpm: 15,
            auth_register_rpm: 5,
            upload_rpm: 30,
            cors_allowed_origins: String::new(),
            max_upload_bytes: 1024,
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
        };
        assert!(validate_startup_secrets(&config).is_err());
        config.jwt_secret = "operator-generated-jwt-secret-with-32-chars-min!!".into();
        config.setup_token = "operator-generated-setup-token-with-32-chars!!".into();
        config.signing_secret = "operator-generated-signing-secret-32-chars!!".into();
        config.object_storage_jwt_secret =
            "operator-generated-nos-jwt-secret-32-chars-min!!".into();
        config.cors_allowed_origins = "https://app.example.com".into();
        assert!(validate_startup_secrets(&config).is_ok());
    }

    #[test]
    fn production_requires_cors_origins() {
        let mut config = crate::config::Config {
            database_url: "postgres://u:p@localhost/db".into(),
            jwt_secret: "operator-generated-jwt-secret-with-32-chars-min!!".into(),
            setup_token: "operator-generated-setup-token-with-32-chars!!".into(),
            signing_secret: "operator-generated-signing-secret-32-chars!!".into(),
            object_storage_jwt_secret: "operator-generated-nos-jwt-secret-32-chars-min!!".into(),
            bind_addr: "127.0.0.1:3000".into(),
            storage_mode: "proxy".into(),
            object_storage_url: "http://localhost:9000".into(),
            object_storage_public_url: "http://localhost:9000".into(),
            object_storage_bucket: "media".into(),
            url_expiry_seconds: 3600,
            ownly_environment: "production".into(),
            git_sha: None,
            auth_login_rpm: 15,
            auth_register_rpm: 5,
            upload_rpm: 30,
            cors_allowed_origins: String::new(),
            max_upload_bytes: 1024,
            hls_segment_rpm: 480,
            job_worker_count: 2,
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
        };
        assert!(validate_startup_secrets(&config).is_err());
        config.cors_allowed_origins = "https://app.example.com".into();
        assert!(validate_startup_secrets(&config).is_ok());
    }

    #[test]
    fn weak_reason_for_placeholder() {
        assert!(weak_secret_reason("SETUP_TOKEN", "GENERATE_ME").is_some());
        assert!(weak_secret_reason("SETUP_TOKEN", "change-me-in-production").is_some());
        assert!(weak_secret_reason("SETUP_TOKEN", "").is_some());
        let good = "a".repeat(40);
        assert!(weak_secret_reason("SETUP_TOKEN", &good).is_none());
    }
}
